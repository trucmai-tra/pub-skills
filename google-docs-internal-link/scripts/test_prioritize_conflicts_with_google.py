#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).with_name("prioritize_conflicts_with_google.py")
SPEC = importlib.util.spec_from_file_location("serp_priority", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


assert MODULE.classify_anchor_intent("mẫu CV xin việc") == "template"
assert MODULE.classify_anchor_intent("các mẫu logo") == "template"
assert MODULE.classify_anchor_intent("Tạo CV") == "create"
assert MODULE.classify_anchor_intent("thiết kế logo") == "create"
assert MODULE.classify_anchor_intent("cách tạo ảnh") == "create"
assert MODULE.classify_anchor_intent("email") == "neutral"

bank = {
    MODULE.canonical_url("https://www.canva.com/vi_vn/thiet-ke/cv/"): {},
    MODULE.canonical_url("https://www.canva.com/vi_vn/mau/s/cv/"): {},
}
results = [
    {
        "rank_organic": 1,
        "url": MODULE.canonical_url("https://www.canva.com/vi_vn/so-yeu-ly-lich-ai/"),
        "target_family": "other",
        "in_bank": False,
        "retired": False,
        "semantic_eligible": True,
        "structurally_linkable": True,
    },
    {
        "rank_organic": 2,
        "url": MODULE.canonical_url("https://www.canva.com/vi_vn/mau/s/cv/"),
        "target_family": "template",
        "in_bank": True,
        "retired": False,
        "semantic_eligible": True,
        "structurally_linkable": True,
    },
    {
        "rank_organic": 3,
        "url": MODULE.canonical_url("https://www.canva.com/vi_vn/thiet-ke/cv/"),
        "target_family": "create",
        "in_bank": True,
        "retired": False,
        "semantic_eligible": True,
        "structurally_linkable": True,
    },
]
google, usable = MODULE.choose_priorities("tạo CV", results)
assert google and google["rank_organic"] == 3
assert usable and usable["url"].endswith("/thiet-ke/cv/")

google, usable = MODULE.choose_priorities("mẫu CV", results)
assert google and google["rank_organic"] == 2
assert usable and usable["url"].endswith("/mau/s/cv/")

retired_results = [dict(results[1], retired=True), results[2]]
google, usable = MODULE.choose_priorities("mẫu CV", retired_results)
assert google is None and usable is None

assert MODULE.semantic_eligible("email", "https://www.canva.com/vi_vn/logo-ai/", "Logo AI") is False
assert MODULE.semantic_eligible("tạo CV", "https://www.canva.com/vi_vn/thiet-ke/cv/", "Tạo CV") is True
assert MODULE.structurally_linkable("https://www.canva.com/vi_vn/help/content-planner/", False) is False

anchors, group_queries = MODULE._query_anchors(
    [
        {"conflict_id": "C001", "anchor": "ảnh đại"},
        {"conflict_id": "C001", "anchor": "ảnh đại diện"},
        {"conflict_id": "C002", "anchor": "email"},
    ]
)
assert group_queries["C001"] == "ảnh đại diện"
assert set(anchors) == {"ảnh đại diện", "email"}

choice_rows = [
    {
        "anchor": "giao diện",
        "decision": "accept",
        "score": "69",
        "serp_rank_organic": "1",
        "serp_row_status": "google_first_eligible",
        "serp_query": "giao diện web site:canva.com/vi_vn/",
        "penalties": "",
        "target_url": "https://www.canva.com/vi_vn/thiet-ke/giao-dien-web/",
        "source_page_url": "https://www.canva.com/vi_vn/source/",
        "serp_google_priority_url": "https://www.canva.com/vi_vn/thiet-ke/giao-dien-web/",
        "serp_bank_priority_url": "https://www.canva.com/vi_vn/thiet-ke/giao-dien-web/",
    },
    {
        "anchor": "giao diện web",
        "decision": "accept",
        "score": "65",
        "serp_rank_organic": "1",
        "serp_row_status": "google_first_eligible",
        "serp_query": "giao diện web site:canva.com/vi_vn/",
        "penalties": "",
        "target_url": "https://www.canva.com/vi_vn/thiet-ke/giao-dien-web/",
        "source_page_url": "https://www.canva.com/vi_vn/source/",
        "serp_google_priority_url": "https://www.canva.com/vi_vn/thiet-ke/giao-dien-web/",
        "serp_bank_priority_url": "https://www.canva.com/vi_vn/thiet-ke/giao-dien-web/",
    },
]
MODULE._assign_group_choice(choice_rows)
assert choice_rows[0]["serp_group_choice"] == "skip"
assert choice_rows[1]["serp_group_choice"] == "use"

review_only_rows = [
    {
        "anchor": "cách ký tên",
        "decision": "review",
        "score": "53",
        "serp_rank_organic": "1",
        "serp_row_status": "google_first_eligible",
        "serp_query": "cách ký tên site:canva.com/vi_vn/",
        "penalties": "",
        "target_url": "https://www.canva.com/vi_vn/chu-ky/",
        "source_page_url": "https://www.canva.com/vi_vn/source/",
        "serp_google_priority_url": "https://www.canva.com/vi_vn/chu-ky/",
        "serp_bank_priority_url": "https://www.canva.com/vi_vn/chu-ky/",
    }
]
MODULE._assign_group_choice(review_only_rows)
assert review_only_rows[0]["serp_group_choice"] == "review"
assert "non-accepted contextual candidate" in review_only_rows[0]["serp_group_note"]

print("PASS: Google SERP conflict priority")
