#!/usr/bin/env python3
"""Read-only comparison of a verified automatic run with revised Docs.

Both compact post-verification snapshots and native connector Docs are accepted.
Authorship comes from the run baseline plus the reviewer's explicit revision statement.
"""
import argparse
import json
from collections import Counter
from pathlib import Path
import unicodedata
from urllib.parse import urlsplit, urlunsplit


def canonical_url(value):
    p = urlsplit(value or "")
    return urlunsplit(("https", p.netloc.lower(), p.path.rstrip("/") + "/", "", "")) if p.netloc else ""


def pair(link):
    # Keep accents. "phong" is not evidence for "phông".
    anchor = unicodedata.normalize("NFC", link["anchor"]).casefold()
    return " ".join(anchor.split()), canonical_url(link["target_url"])


def walk(elements):
    for item in elements:
        if "paragraph" in item:
            p = item["paragraph"]
            runs = p.get("elements", [])
            yield {
                "text": "".join(r.get("textRun", {}).get("content", "") for r in runs),
                "style": p.get("paragraphStyle", {}).get("namedStyleType", "NORMAL_TEXT"),
                "links": [dict(startIndex=r.get("startIndex"), endIndex=r.get("endIndex"),
                               text=r["textRun"].get("content", ""), style=r["textRun"]["textStyle"])
                          for r in runs if r.get("textRun", {}).get("textStyle", {}).get("link", {}).get("url")],
            }
        for row in item.get("table", {}).get("tableRows", []):
            for cell in row.get("tableCells", []):
                yield from walk(cell.get("content", []))


def paragraphs(snapshot):
    if "paragraphs" in snapshot:
        return snapshot["paragraphs"]
    tabs = snapshot.get("tabs", [])
    if len(tabs) != 1:
        raise ValueError("Select exactly one tab explicitly before comparison")
    return list(walk(tabs[0].get("body", {}).get("content", [])))


def publishable(snapshot):
    ps = paragraphs(snapshot)
    starts = [i for i, p in enumerate(ps) if p["text"].strip() == "Final page copy"]
    ends = [i for i, p in enumerate(ps) if p["text"].strip() == "Links added for review"]
    if len(starts) != 1 or len(ends) > 1 or (ends and ends[0] <= starts[0]):
        raise ValueError("Ambiguous publishable-body or generated-footer boundary")
    if ends and (ps[ends[0]]["style"] != "HEADING_2" or any(
        p["style"].startswith("HEADING") for p in ps[ends[0] + 1:]
    )):
        raise ValueError("Review footer must be the final Heading 2 section")
    return ps[starts[0] + 1:ends[0] if ends else len(ps)]


def extract_links(ps):
    result = []
    for i, p in enumerate(ps):
        merged = []
        for raw in p.get("links", []):
            link = {**raw, "target_url": raw.get("url") or raw.get("style", {}).get("link", {}).get("url", "")}
            if (merged and link.get("startIndex") is not None
                    and merged[-1].get("endIndex") == link["startIndex"]
                    and canonical_url(merged[-1]["target_url"]) == canonical_url(link["target_url"])):
                merged[-1]["text"] += link["text"]
                merged[-1]["endIndex"] = link.get("endIndex")
            else:
                merged.append(link)
        for link in merged:
            if not link["text"].strip():
                continue
            result.append({"anchor": link["text"].strip(), "target_url": canonical_url(link["target_url"]),
                           "paragraph": p["text"].strip(), "paragraph_index": i,
                           "paragraph_style": p["style"]})
    return result


def compare(before, current, automatic_links):
    old_ps, new_ps = publishable(before), publishable(current)
    old, new = extract_links(old_ps), extract_links(new_ps)
    old_pairs, new_pairs = {pair(l) for l in old}, {pair(l) for l in new}
    auto_pairs = {pair(l) for l in automatic_links}
    old_by_anchor = {}
    for link in old:
        old_by_anchor.setdefault(pair(link)[0], []).append(link)
    for link in new:
        k = pair(link)
        if k in old_pairs:
            link["evidence_label"] = "retained_automatic" if k in auto_pairs else "retained_preexisting"
            link["change"] = "retained"
        else:
            link["evidence_label"] = "reviewer_added"
            replacements = [l for l in old_by_anchor.get(k[0], []) if pair(l) not in new_pairs]
            link["change"] = "retargeted" if replacements else "added"
            link["previous_targets"] = sorted({l["target_url"] for l in replacements})
        link["provenance"] = "post_run_snapshot_diff"
    # Pair-level disappearance only: moving a link is not a negative example.
    current_texts = {p["text"].strip() for p in new_ps}
    removed = [{**l, "change": "removed", "removal_confirmed": l["paragraph"] in current_texts,
                "reason": "unchanged_paragraph" if l["paragraph"] in current_texts else "copy_changed_or_deleted"}
               for l in old if pair(l) not in new_pairs]
    return {"current_links": new, "removed_links": removed,
            "body_text_unchanged": "".join(p["text"] for p in old_ps) == "".join(p["text"] for p in new_ps)}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline-run", required=True, type=Path)
    ap.add_argument("--current-dir", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--reviewer-confirmed-revisions", action="store_true", required=True)
    args = ap.parse_args()
    audit = json.loads((args.baseline_run / "audit.json").read_text())
    docs = []
    for entry in audit["documents"]:
        row = entry["row"]
        before = json.loads((args.baseline_run / f"row-{row}-post-verification.json").read_text())
        current = json.loads((args.current_dir / f"row-{row}-current.json").read_text())
        source = json.loads((args.baseline_run / f"row-{row}-source.json").read_text())
        if before["document_id"] != current["documentId"]:
            raise ValueError(f"Row {row}: mismatched document IDs")
        automatic = [l for l in entry["items"] if l["status"] == "applied"]
        docs.append({"row": row, "document_url": entry["document_url"], "source_url": source["page_url"],
                     "source_slug": source["page_url"].rstrip("/").rsplit("/", 1)[-1],
                     "baseline_revision": before["revisionId"], "current_revision": current["revisionId"],
                     **compare(before, current, automatic)})
    counts = Counter(l["evidence_label"] for d in docs for l in d["current_links"])
    result = {"contract": "canva.internal-link-calibration.v1", "calibration_mode": "revision_diff",
              "baseline_run": str(args.baseline_run), "authorship_statement": "The reviewer confirmed they revised this batch",
              "summary": {"documents": len(docs), "current_link_runs": sum(counts.values()), **counts,
                          "removed_pairs": sum(len(d["removed_links"]) for d in docs)}, "documents": docs}
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result["summary"], indent=2))


if __name__ == "__main__":
    main()
