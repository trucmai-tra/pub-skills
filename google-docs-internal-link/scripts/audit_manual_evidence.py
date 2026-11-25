#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


RUNTIME_DIR = Path(__file__).resolve().parent.parent / "runtime"
DEFAULT_CANDIDATES = RUNTIME_DIR / "data/candidates.json"
DEFAULT_RETIRED_TARGETS = RUNTIME_DIR / "data/retired-targets.json"


def canonicalize_url(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    parsed = urlsplit(raw)
    if parsed.hostname != "www.canva.com" or not parsed.path.startswith("/vi_vn/"):
        return ""
    path = f"{parsed.path.rstrip('/')}/"
    return urlunsplit(("https", "www.canva.com", path, "", ""))


def normalize_anchor(value: str) -> str:
    text = unicodedata.normalize("NFD", str(value or "").lower())
    text = "".join(char for char in text if unicodedata.category(char) != "Mn").replace("đ", "d")
    return re.sub(r"\s+", " ", text).strip()


def word_count(value: str) -> int:
    return len(re.findall(r"\w+", str(value or ""), flags=re.UNICODE))


def manual_links(manifest: dict) -> list[dict]:
    links = []
    for document in manifest.get("documents", []):
        for link in document.get("current_links", []):
            if link.get("evidence_label") != "reviewer_added":
                continue
            links.append(
                {
                    **link,
                    "row": document.get("row"),
                    "source_url": canonicalize_url(document.get("source_url", "")),
                }
            )
    return links


def audit(manifest: dict, candidates_path: Path, retired_targets_path: Path) -> dict:
    if manifest.get("contract") != "canva.internal-link-calibration.v1":
        raise ValueError("Expected canva.internal-link-calibration.v1 input")
    links = manual_links(manifest)
    candidate_payload = json.loads(candidates_path.read_text(encoding="utf-8"))
    candidate_by_url = {
        canonicalize_url(candidate.get("url", "")): candidate
        for candidate in candidate_payload.get("candidates", [])
    }
    retired_payload = json.loads(retired_targets_path.read_text(encoding="utf-8"))
    retired_urls = {
        canonicalize_url(target.get("url", ""))
        for target in retired_payload.get("targets", [])
        if target.get("status") == "retired"
    }

    candidate_target_runs = 0
    candidate_exact_anchor_runs = 0
    retired_target_runs: Counter[str] = Counter()
    missing_candidate_targets: Counter[str] = Counter()
    for link in links:
        target_url = canonicalize_url(link.get("target_url", ""))
        if target_url in retired_urls:
            retired_target_runs[target_url] += 1
            continue
        candidate = candidate_by_url.get(target_url)
        if not candidate:
            missing_candidate_targets[target_url] += 1
            continue
        candidate_target_runs += 1
        known_anchors = {normalize_anchor(item.get("text", "")) for item in candidate.get("anchors", [])}
        if normalize_anchor(link.get("anchor", "")) in known_anchors:
            candidate_exact_anchor_runs += 1

    source_target_pairs = {
        (link["source_url"], canonicalize_url(link.get("target_url", "")))
        for link in links
    }
    pair_sources: defaultdict[tuple[str, str], set[str]] = defaultdict(set)
    pair_rows: defaultdict[tuple[str, str], set[int]] = defaultdict(set)
    pair_display = {}
    for link in links:
        key = (normalize_anchor(link.get("anchor", "")), canonicalize_url(link.get("target_url", "")))
        pair_sources[key].add(link["source_url"])
        pair_rows[key].add(link.get("row"))
        pair_display[key] = link.get("anchor", "")
    repeated_pairs = [
        {
            "anchor": pair_display[key],
            "target_url": key[1],
            "source_count": len(sources),
            "rows": sorted(row for row in pair_rows[key] if isinstance(row, int)),
        }
        for key, sources in pair_sources.items()
        if len(sources) >= 2
    ]
    repeated_pairs.sort(key=lambda item: (-item["source_count"], normalize_anchor(item["anchor"])))

    distribution = Counter(word_count(link.get("anchor", "")) for link in links)
    return {
        "schema_version": 1,
        "contract": "canva.internal-link-calibration-audit.v1",
        "source_manifest_contract": manifest.get("contract"),
        "summary": {
            "documents": len(manifest.get("documents", [])),
            "baseline_use_links": manifest.get("summary", {}).get("baseline_use_links"),
            "current_link_runs": manifest.get("summary", {}).get("current_link_runs"),
            "manual_added_runs": len(links),
            "held_for_review_runs": sum(link.get("learning_status") == "hold" for link in links),
            "eligible_manual_runs": sum(link.get("learning_status") != "hold" for link in links),
            "manual_distinct_source_targets": len(source_target_pairs),
            "anchor_word_count_distribution": dict(sorted(distribution.items())),
        },
        "candidate_pool": {
            "generated_at": candidate_payload.get("generated_at"),
            "candidate_count": len(candidate_payload.get("candidates", [])),
            "target_coverage_runs": candidate_target_runs,
            "exact_anchor_coverage_runs": candidate_exact_anchor_runs,
            "retired_target_runs": sum(retired_target_runs.values()),
            "retired_targets": dict(sorted(retired_target_runs.items())),
            "missing_target_runs": sum(missing_candidate_targets.values()),
            "missing_targets": dict(sorted(missing_candidate_targets.items())),
        },
        "repeated_exact_pairs_across_documents": repeated_pairs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit user-added links against the canonical candidate pool.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES)
    parser.add_argument("--retired-targets", type=Path, default=DEFAULT_RETIRED_TARGETS)
    args = parser.parse_args()
    result = audit(
        json.loads(args.input.read_text(encoding="utf-8")),
        args.candidates.resolve(),
        args.retired_targets.resolve(),
    )
    output = f"{json.dumps(result, ensure_ascii=False, indent=2)}\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output, encoding="utf-8")
    print(output, end="")


if __name__ == "__main__":
    main()
