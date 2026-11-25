#!/usr/bin/env python3
"""Add Google Vietnam SERP evidence to contextual-conflict review rows.

The live mode searches the most specific anchor in each conflict group as:

    <anchor> site:canva.com/vi_vn/

Browser-verified evidence can be supplied with ``--cached-evidence``. Otherwise
the script uses the shared DataForSEO Google organic client as a fallback. The
first result is a priority only after retired-target and page-family checks.
The script never edits a Google Doc or mutates the internal-link bank.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit, urlunsplit


DEFAULT_LOCATION = 2704
DEFAULT_LANGUAGE = "vi"
DEFAULT_DEPTH = 20

SEMANTIC_STOP_WORDS = {
    "cach",
    "cac",
    "canva",
    "dep",
    "free",
    "ke",
    "lam",
    "mau",
    "mien",
    "online",
    "phi",
    "tao",
    "thiet",
    "viet",
}

NON_LINKABLE_PREFIXES = (
    "/vi_vn/help/",
    "/vi_vn/login/",
    "/vi_vn/creators/",
)

SERP_COLUMNS = [
    "serp_query",
    "serp_checked_at",
    "serp_rank_organic",
    "serp_rank_absolute",
    "serp_target_family",
    "serp_family_eligible",
    "serp_semantic_eligible",
    "serp_target_in_bank",
    "serp_google_priority_url",
    "serp_google_priority_rank",
    "serp_bank_priority_url",
    "serp_bank_priority_rank",
    "serp_row_status",
    "serp_group_choice",
    "serp_group_note",
]


def normalized_key(value: str) -> str:
    return unicodedata.normalize("NFC", str(value or "").strip()).casefold()


def accentless(value: str) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    plain = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return plain.replace("đ", "d").replace("Đ", "D").casefold()


def canonical_url(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return raw
    if not parsed.netloc:
        return raw
    host = parsed.netloc.casefold()
    if host == "canva.com":
        host = "www.canva.com"
    path = parsed.path or "/"
    if host == "www.canva.com" and not path.endswith("/"):
        path += "/"
    return urlunsplit((parsed.scheme.casefold() or "https", host, path, "", ""))


def classify_anchor_intent(anchor: str) -> str:
    words = accentless(anchor).strip().split()
    if words[:1] == ["mau"] or words[:2] == ["cac", "mau"]:
        return "template"
    if words[:1] in (["tao"], ["thiet"]):
        if words[0] == "tao" or words[:2] == ["thiet", "ke"]:
            return "create"
    if words[:2] == ["cach", "tao"] or words[:3] == ["cach", "thiet", "ke"]:
        return "create"
    return "neutral"


def classify_target_family(url: str, page_type: str = "") -> str:
    type_key = accentless(page_type)
    path = urlsplit(canonical_url(url)).path.casefold()
    if "template" in type_key or "/mau/" in path:
        return "template"
    if type_key == "create" or "/thiet-ke/" in path:
        return "create"
    return "other"


def family_eligible(anchor_intent: str, target_family: str) -> bool:
    if anchor_intent == "template":
        return target_family == "template"
    if anchor_intent == "create":
        return target_family == "create"
    return True


def semantic_tokens(value: str) -> set[str]:
    cleaned = "".join(char if char.isalnum() else " " for char in accentless(value))
    return {word for word in cleaned.split() if word and word not in SEMANTIC_STOP_WORDS}


def semantic_eligible(anchor: str, url: str, title: str = "", description: str = "") -> bool:
    anchor_tokens = semantic_tokens(anchor)
    if not anchor_tokens:
        return False
    target_tokens = semantic_tokens(f"{urlsplit(canonical_url(url)).path} {title} {description}")
    overlap = anchor_tokens & target_tokens
    return bool(overlap) and len(overlap) / len(anchor_tokens) >= 0.5


def structurally_linkable(url: str, in_bank: bool) -> bool:
    if in_bank:
        return True
    path = urlsplit(canonical_url(url)).path.casefold()
    return path != "/vi_vn/" and not path.startswith(NON_LINKABLE_PREFIXES)


SKILL_DIR = Path(__file__).resolve().parent.parent


def _dataforseo_skill_dir() -> Path:
    override = os.environ.get("DATAFORSEO_SKILL_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    roots = [
        Path.cwd() / ".agents" / "skills",
        Path.cwd() / ".claude" / "skills",
        Path.home() / ".agents" / "skills",
        Path.home() / ".claude" / "skills",
        Path.home() / ".codex" / "skills",
    ]
    for root in roots:
        if (root / "dataforseo" / "dataforseo").is_dir():
            return (root / "dataforseo").resolve()
    repo_plugin = Path.cwd() / "plugins" / "dataforseo" / "skills" / "dataforseo"
    if (repo_plugin / "dataforseo").is_dir():
        return repo_plugin.resolve()
    cache_patterns = (
        ".codex/plugins/cache/*/dataforseo/*/skills/dataforseo",
        ".claude/plugins/cache/*/dataforseo/*/skills/dataforseo",
    )
    matches = [
        candidate.resolve()
        for pattern in cache_patterns
        for candidate in Path.home().glob(pattern)
        if (candidate / "dataforseo").is_dir()
    ]
    if matches:
        return max(matches, key=lambda path: path.stat().st_mtime)
    raise RuntimeError(
        "The DataForSEO fallback requires the dataforseo plugin from this marketplace."
    )


def _load_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def _load_bank(path: Path) -> dict[str, dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {
        canonical_url(item.get("url", "")): item
        for item in payload.get("candidates", [])
        if item.get("url")
    }


def _load_retired(path: Path) -> set[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {
        canonical_url(item.get("url", ""))
        for item in payload.get("targets", [])
        if item.get("status") == "retired" and item.get("url")
    }


def _query_anchors(rows: Iterable[dict[str, str]]) -> tuple[list[str], dict[str, str]]:
    by_group: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        anchor = row.get("anchor", "").strip()
        if anchor:
            by_group[row.get("conflict_id", "")].append(anchor)
    group_query_anchor: dict[str, str] = {}
    for group, anchors in by_group.items():
        group_query_anchor[group] = max(
            anchors,
            key=lambda value: (len(value.split()), len(value), value.casefold()),
        )
    anchors: dict[str, str] = {}
    for anchor in group_query_anchor.values():
        anchors.setdefault(normalized_key(anchor), anchor)
    return list(anchors.values()), group_query_anchor


def _extract_canva_results(
    response: dict[str, Any],
    anchor: str,
    bank: dict[str, dict[str, Any]],
    retired: set[str],
) -> list[dict[str, Any]]:
    tasks = response.get("tasks") or []
    successful = [task for task in tasks if 20000 <= int(task.get("status_code", 0) or 0) < 30000]
    if not successful:
        messages = [f"[{task.get('status_code')}] {task.get('status_message', '')}" for task in tasks]
        raise RuntimeError("Google SERP task failed: " + "; ".join(messages))
    result = (successful[0].get("result") or [{}])[0]
    organic_rank = 0
    found: list[dict[str, Any]] = []
    for item in result.get("items") or []:
        if item.get("type") != "organic":
            continue
        organic_rank += 1
        url = canonical_url(item.get("url", ""))
        parsed = urlsplit(url)
        if parsed.netloc != "www.canva.com" or not parsed.path.startswith("/vi_vn/"):
            continue
        bank_item = bank.get(url, {})
        family = classify_target_family(url, bank_item.get("page_type_label") or bank_item.get("page_type") or "")
        found.append(
            {
                "rank_organic": organic_rank,
                "rank_absolute": item.get("rank_absolute", ""),
                "url": url,
                "title": item.get("title", ""),
                "description": item.get("description", ""),
                "target_family": family,
                "in_bank": url in bank,
                "retired": url in retired,
                "semantic_eligible": semantic_eligible(
                    anchor,
                    url,
                    item.get("title", ""),
                    item.get("description", ""),
                ),
                "structurally_linkable": structurally_linkable(url, url in bank),
            }
        )
    return found


def choose_priorities(
    anchor: str,
    results: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    intent = classify_anchor_intent(anchor)
    eligible = [
        result
        for result in results
        if not result.get("retired")
        and result.get("semantic_eligible")
        and result.get("structurally_linkable")
        and family_eligible(intent, result.get("target_family", "other"))
    ]
    google_priority = eligible[0] if eligible else None
    bank_priority = next((result for result in eligible if result.get("in_bank")), None)
    return google_priority, bank_priority


def _collect_live(
    anchors: list[str],
    bank: dict[str, dict[str, Any]],
    retired: set[str],
    location: int,
    language: str,
    depth: int,
    concurrency: int,
) -> tuple[dict[str, dict[str, Any]], float]:
    dataforseo_skill = _dataforseo_skill_dir()
    sys.path.insert(0, str(dataforseo_skill))
    from dataforseo.client import DataForSEOClient  # pylint: disable=import-outside-toplevel

    client = DataForSEOClient()
    payloads = [
        [
            {
                "keyword": f"{anchor} site:canva.com/vi_vn/",
                "location_code": location,
                "language_code": language,
                "depth": depth,
                "device": "desktop",
            }
        ]
        for anchor in anchors
    ]
    responses = client.post_each(
        "/v3/serp/google/organic/live/advanced",
        payloads,
        concurrency=concurrency,
    )
    evidence: dict[str, dict[str, Any]] = {}
    total_cost = 0.0
    for anchor, response in zip(anchors, responses, strict=True):
        total_cost += float(response.get("cost") or 0)
        results = _extract_canva_results(response, anchor, bank, retired)
        google_priority, bank_priority = choose_priorities(anchor, results)
        evidence[normalized_key(anchor)] = {
            "anchor": anchor,
            "anchor_intent": classify_anchor_intent(anchor),
            "query": f"{anchor} site:canva.com/vi_vn/",
            "results": results,
            "google_priority": google_priority,
            "bank_priority": bank_priority,
        }
    return evidence, total_cost


def _load_fixture(
    path: Path,
    anchors: list[str],
    bank: dict[str, dict[str, Any]],
    retired: set[str],
) -> tuple[dict[str, dict[str, Any]], float]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    fixture_queries = payload.get("queries", payload)
    browser_verified = "google chrome" in str(payload.get("source", "")).casefold()
    evidence: dict[str, dict[str, Any]] = {}
    for anchor in anchors:
        raw = fixture_queries.get(normalized_key(anchor), fixture_queries.get(anchor, {}))
        results = []
        for index, item in enumerate(raw.get("results", []), start=1):
            url = canonical_url(item.get("url", ""))
            bank_item = bank.get(url, {})
            title = item.get("title") or bank_item.get("title") or ""
            results.append(
                {
                    "rank_organic": item.get("rank_organic", index),
                    "rank_absolute": item.get("rank_absolute", item.get("rank_organic", index)),
                    "url": url,
                    "title": title,
                    "description": item.get("description", ""),
                    "target_family": classify_target_family(
                        url,
                        bank_item.get("page_type_label") or bank_item.get("page_type") or "",
                    ),
                    "in_bank": url in bank,
                    "retired": url in retired,
                    "semantic_eligible": browser_verified or semantic_eligible(
                        anchor, url, title, item.get("description", "")
                    ),
                    "structurally_linkable": structurally_linkable(url, url in bank),
                }
            )
        results.sort(key=lambda item: int(item.get("rank_organic") or 9999))
        google_priority, bank_priority = choose_priorities(anchor, results)
        evidence[normalized_key(anchor)] = {
            "anchor": anchor,
            "anchor_intent": classify_anchor_intent(anchor),
            "query": f"{anchor} site:canva.com/vi_vn/",
            "results": results,
            "google_priority": google_priority,
            "bank_priority": bank_priority,
        }
    return evidence, float(payload.get("cost_usd", 0) or 0)


def _rank_value(result: dict[str, Any] | None) -> str:
    return str(result.get("rank_organic", "")) if result else ""


def _annotate_rows(
    rows: list[dict[str, str]],
    evidence: dict[str, dict[str, Any]],
    bank: dict[str, dict[str, Any]],
    checked_at: str,
    group_query_anchor: dict[str, str],
) -> list[dict[str, str]]:
    annotated: list[dict[str, str]] = []
    for source in rows:
        row = dict(source)
        query_anchor = group_query_anchor.get(row.get("conflict_id", ""), row.get("anchor", ""))
        anchor_evidence = evidence.get(normalized_key(query_anchor), {})
        results = anchor_evidence.get("results", [])
        result_by_url = {result.get("url", ""): result for result in results}
        target_url = canonical_url(row.get("target_url", ""))
        target_result = result_by_url.get(target_url)
        google_priority = anchor_evidence.get("google_priority")
        bank_priority = anchor_evidence.get("bank_priority")
        intent = classify_anchor_intent(query_anchor)
        bank_item = bank.get(target_url, {})
        target_family = row.get("target_family") or classify_target_family(
            target_url,
            row.get("target_type") or bank_item.get("page_type_label") or bank_item.get("page_type") or "",
        )
        eligible = family_eligible(intent, target_family)
        if not eligible:
            row_status = "wrong_page_family"
        elif target_result is None:
            row_status = "not_found_in_google_results"
        elif target_result.get("retired"):
            row_status = "retired"
        elif not target_result.get("semantic_eligible"):
            row_status = "google_result_failed_topic_check"
        elif google_priority and target_url == google_priority.get("url"):
            row_status = "google_first_eligible"
        elif bank_priority and target_url == bank_priority.get("url"):
            row_status = "first_eligible_in_bank"
        else:
            row_status = "lower_google_priority"
        row.update(
            {
                "serp_query": anchor_evidence.get("query", ""),
                "serp_checked_at": checked_at,
                "serp_rank_organic": _rank_value(target_result),
                "serp_rank_absolute": str(target_result.get("rank_absolute", "")) if target_result else "",
                "serp_target_family": target_result.get("target_family", target_family) if target_result else target_family,
                "serp_family_eligible": "yes" if eligible else "no",
                "serp_semantic_eligible": "yes" if target_result and target_result.get("semantic_eligible") else "no",
                "serp_target_in_bank": "yes" if target_url in bank else "no",
                "serp_google_priority_url": google_priority.get("url", "") if google_priority else "",
                "serp_google_priority_rank": _rank_value(google_priority),
                "serp_bank_priority_url": bank_priority.get("url", "") if bank_priority else "",
                "serp_bank_priority_rank": _rank_value(bank_priority),
                "serp_row_status": row_status,
                "serp_group_choice": "",
                "serp_group_note": "",
            }
        )
        annotated.append(row)

    by_group: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in annotated:
        by_group[row.get("conflict_id", "")].append(row)
    for group_rows in by_group.values():
        _assign_group_choice(group_rows)
    return annotated


def _assign_group_choice(rows: list[dict[str, str]]) -> None:
    if rows and all("anchor_repeats_source_topic" in row.get("penalties", "") for row in rows):
        for row in rows:
            row["serp_group_choice"] = "skip"
            row["serp_group_note"] = "source-topic safety rule overrides SERP priority"
        return

    source_urls = {canonical_url(row.get("source_page_url", "")) for row in rows}
    google_priority_urls = {
        canonical_url(row.get("serp_google_priority_url", ""))
        for row in rows
        if row.get("serp_google_priority_url")
    }
    if google_priority_urls and google_priority_urls.issubset(source_urls):
        for row in rows:
            row["serp_group_choice"] = "skip"
            row["serp_group_note"] = "first eligible Google result is the source page; do not self-link"
        return

    first_missing = next(
        (
            row
            for row in rows
            if row.get("serp_google_priority_url")
            and row.get("serp_google_priority_url") != row.get("serp_bank_priority_url")
        ),
        None,
    )
    if first_missing:
        note = f"first eligible Google result is outside the active bank: {first_missing['serp_google_priority_url']}"
        for row in rows:
            row["serp_group_choice"] = "hold"
            row["serp_group_note"] = note
        return

    candidates = [
        row
        for row in rows
        if row.get("serp_row_status") == "google_first_eligible"
        and row.get("decision") == "accept"
        and "anchor_repeats_source_topic" not in row.get("penalties", "")
        and canonical_url(row.get("target_url", "")) != canonical_url(row.get("source_page_url", ""))
    ]
    if candidates:
        def candidate_sort(row: dict[str, str]) -> tuple[int, int, int]:
            rank = int(row.get("serp_rank_organic") or 9999)
            score = int(float(row.get("score") or 0))
            anchor_words = len(row.get("anchor", "").split())
            return rank, -anchor_words, -score

        chosen = sorted(candidates, key=candidate_sort)[0]
        query_keyword = chosen.get("serp_query", "").removesuffix(" site:canva.com/vi_vn/")
        for row in rows:
            row["serp_group_choice"] = "use" if row is chosen else "skip"
            row["serp_group_note"] = (
                f"first eligible Google result for {query_keyword!r} at organic rank "
                f"{chosen['serp_rank_organic']}"
            )
        return

    has_priority = any(row.get("serp_google_priority_url") for row in rows)
    priority_is_review_only = any(
        row.get("serp_row_status") == "google_first_eligible" and row.get("decision") != "accept"
        for row in rows
    )
    if priority_is_review_only:
        note = "Google priority matches only a non-accepted contextual candidate; skip it in the application plan"
    else:
        note = "Google priority URL is not represented by an eligible conflict row" if has_priority else "no eligible Canva Vietnam organic result found"
    for row in rows:
        row["serp_group_choice"] = "review"
        row["serp_group_note"] = note


def _write_csv(path: Path, columns: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--conflicts", required=True, type=Path)
    parser.add_argument("--out-json", required=True, type=Path)
    parser.add_argument("--out-csv", required=True, type=Path)
    evidence_group = parser.add_mutually_exclusive_group()
    evidence_group.add_argument("--fixture-json", type=Path, help="Use saved test results instead of calling Google")
    evidence_group.add_argument("--cached-evidence", type=Path, help="Reprocess an earlier live evidence file without new API calls")
    parser.add_argument("--location", type=int, default=DEFAULT_LOCATION)
    parser.add_argument("--language", default=DEFAULT_LANGUAGE)
    parser.add_argument("--depth", type=int, default=DEFAULT_DEPTH)
    parser.add_argument("--concurrency", type=int, default=1)
    args = parser.parse_args()

    bank_path = SKILL_DIR / "runtime/data/candidates.json"
    retired_path = SKILL_DIR / "runtime/data/retired-targets.json"
    columns, rows = _load_csv(args.conflicts.resolve())
    anchors, group_query_anchor = _query_anchors(rows)
    bank = _load_bank(bank_path)
    retired = _load_retired(retired_path)
    checked_at = datetime.now(timezone.utc).isoformat()

    if args.cached_evidence:
        cached_payload = json.loads(args.cached_evidence.resolve().read_text(encoding="utf-8"))
        evidence, cost = _load_fixture(args.cached_evidence.resolve(), anchors, bank, retired)
        source = f"{cached_payload.get('source', 'saved evidence')} (cached)"
        checked_at = cached_payload.get("checked_at", checked_at)
    elif args.fixture_json:
        evidence, cost = _load_fixture(args.fixture_json.resolve(), anchors, bank, retired)
        source = "fixture"
    else:
        evidence, cost = _collect_live(
            anchors,
            bank,
            retired,
            args.location,
            args.language,
            args.depth,
            max(1, args.concurrency),
        )
        source = "DataForSEO Google organic live advanced"

    annotated = _annotate_rows(rows, evidence, bank, checked_at, group_query_anchor)
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    serializable_queries = {item["anchor"]: item for item in evidence.values()}
    payload = {
        "schema_version": 1,
        "source": source,
        "checked_at": checked_at,
        "location_code": args.location,
        "language_code": args.language,
        "depth": args.depth,
        "query_rule": "<most specific overlapping anchor> site:canva.com/vi_vn/",
        "priority_rule": "first non-retired, page-family-eligible Canva Vietnam organic result",
        "cost_usd": round(cost, 6),
        "query_count": len(anchors),
        "queries": serializable_queries,
    }
    args.out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _write_csv(args.out_csv.resolve(), columns + SERP_COLUMNS, annotated)
    groups = {row.get("conflict_id", "") for row in annotated}
    choices = defaultdict(int)
    for group in groups:
        group_rows = [row for row in annotated if row.get("conflict_id", "") == group]
        values = {row["serp_group_choice"] for row in group_rows}
        group_choice = "use" if "use" in values else next(iter(values))
        choices[group_choice] += 1
    print(
        json.dumps(
            {
                "queries": len(anchors),
                "groups": len(groups),
                "rows": len(annotated),
                "group_choices": dict(choices),
                "cost_usd": round(cost, 6),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
