#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Iterable, Iterator
from urllib.parse import parse_qs, unquote, urlsplit, urlunsplit

try:
    import httpx
    import yaml
except ImportError as exc:
    raise SystemExit(
        "Missing dependency. Install packages from the requirements.txt "
        "file beside this skill's SKILL.md."
    ) from exc


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_CONFIG = SKILL_DIR / "config" / "config.yaml"
SPREADSHEET_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n")
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
DESCRIPTION_URL_RE = re.compile(
    r"(?:(?:https?://)|(?:www\.))[^\s<>{}\[\]\"']+",
    re.IGNORECASE,
)
EMAIL_RE = re.compile(
    r"(?<![A-Z0-9._%+-])"
    r"([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,63})"
    r"(?![A-Z0-9._%+-])",
    re.IGNORECASE,
)

QUERY_COLUMNS = ["query", "angle", "relationship", "rationale"]
RAW_SERP_COLUMNS = [
    "query_index",
    "query",
    "angle",
    "relationship",
    "rationale",
    "executed_query",
    "serp_item_type",
    "rank_absolute",
    "rank_group",
    "feature_position",
    "raw_url",
    "url_kind",
    "video_id",
    "canonical_video_url",
    "title",
    "source",
    "google_result_language",
    "included",
    "exclusion_reason",
    "first_seen_order",
]
VIDEO_COLUMNS = [
    "video_id",
    "canonical_video_url",
    "title",
    "thumbnail_url",
    "publication_date",
    "duration_time",
    "duration_time_seconds",
    "video_views",
    "video_likes",
    "video_comments",
    "video_tags",
    "category",
    "google_best_rank_absolute",
    "google_serp_occurrences",
    "matched_query_count",
    "matched_queries",
    "query_ranks",
    "google_result_languages",
    "search_location_code",
    "search_language_code",
    "subtitle_languages",
    "auto_generated_subtitle_languages",
    "video_language_status",
    "is_live",
    "is_embeddable",
    "channel_id",
    "channel_name",
    "channel_url",
    "channel_logo",
    "channel_subscribers_displayed",
    "channel_subscribers",
    "enrichment_status",
    "enrichment_error",
]
AUDITOR_QUEUE_COLUMNS = [
    "audit_status",
    "auditor_notes",
    "recipient_email",
    "additional_public_emails",
    "public_email_count",
    "channel_name",
    "channel_url",
    "channel_subscribers",
    "channel_total_views",
    "public_video_count",
    "video_priority_within_channel",
    "video_title",
    "video_url",
    "video_views",
    "google_best_rank_absolute",
    "matched_queries",
    "query_ranks",
    "google_serp_occurrences",
    "language_qualification",
    "video_language_status",
    "website",
    "facebook",
    "instagram",
    "tiktok",
    "linkedin",
    "twitter_x",
    "other_links",
    "channel_id",
    "video_id",
]
CHANNEL_COLUMNS = [
    "channel_id",
    "channel_name",
    "channel_url",
    "public_email_count",
    "public_emails",
    "channel_logo",
    "channel_subscribers_displayed",
    "channel_subscribers",
    "public_video_count",
    "channel_total_views",
    "joined_date",
    "matched_query_count",
    "matched_queries",
    "ranking_video_count",
    "ranking_video_urls",
    "google_best_rank_absolute",
    "video_language_statuses",
    "vietnamese_spoken_video_count",
    "vietnamese_caption_video_count",
    "non_vietnamese_video_count",
    "unknown_language_video_count",
    "language_qualification",
    "website",
    "instagram",
    "facebook",
    "twitter_x",
    "linkedin",
    "tiktok",
    "other_links",
    "channel_about_status",
    "channel_links_status",
]
LINK_COLUMNS = [
    "channel_id",
    "channel_name",
    "channel_url",
    "link_type",
    "label",
    "url",
    "source",
]
LANGUAGE_COLUMNS = [
    "video_id",
    "canonical_video_url",
    "title",
    "channel_id",
    "channel_name",
    "search_language_code",
    "google_result_languages",
    "subtitle_languages",
    "auto_generated_subtitle_languages",
    "video_language_status",
]


def find_repo_root() -> Path:
    override = (
        os.environ.get("CANVA_YOUTUBE_PROSPECTING_ROOT")
        or os.environ.get("PROSPECTING_CLAUDE_ROOT")
    )
    if override:
        return Path(override).expanduser().resolve()
    return Path.cwd().resolve()


REPO_ROOT = find_repo_root()


def find_installed_skill(name: str, override_name: str) -> Path:
    override = os.environ.get(override_name, "").strip()
    if override:
        return Path(override).expanduser().resolve()
    roots = [
        REPO_ROOT / ".agents" / "skills",
        REPO_ROOT / ".claude" / "skills",
        REPO_ROOT / "plugins" / name / "skills",
        Path.cwd() / ".agents" / "skills",
        Path.cwd() / ".claude" / "skills",
        Path.home() / ".agents" / "skills",
        Path.home() / ".claude" / "skills",
        Path.home() / ".codex" / "skills",
    ]
    for root in roots:
        if (root / name).is_dir():
            return (root / name).resolve()
    cache_patterns = (
        f".codex/plugins/cache/*/{name}/*/skills/{name}",
        f".claude/plugins/cache/*/{name}/*/skills/{name}",
    )
    matches = [
        candidate.resolve()
        for pattern in cache_patterns
        for candidate in Path.home().glob(pattern)
        if candidate.is_dir()
    ]
    if matches:
        return max(matches, key=lambda path: path.stat().st_mtime)
    return (REPO_ROOT / ".claude" / "skills" / name).resolve()


DATAFORSEO_SKILL = find_installed_skill(
    "dataforseo", "CANVA_YOUTUBE_DATAFORSEO_DIR"
)
if str(DATAFORSEO_SKILL) not in sys.path:
    sys.path.insert(0, str(DATAFORSEO_SKILL))

from dataforseo.client import DataForSEOClient, DataForSEOError  # noqa: E402


class RequestRateLimiter:
    def __init__(self, requests_per_second: float) -> None:
        if requests_per_second <= 0:
            raise ValueError("requests_per_second must be greater than zero")
        self.interval = 1 / requests_per_second
        self.lock = Lock()
        self.next_request_at = 0.0

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            delay = max(0.0, self.next_request_at - now)
            if delay:
                time.sleep(delay)
            self.next_request_at = max(now, self.next_request_at) + self.interval


def read_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Expected a YAML mapping in {path}")
    return data


def spreadsheet_safe_value(value: Any) -> Any:
    if isinstance(value, str) and value.startswith(SPREADSHEET_FORMULA_PREFIXES):
        return f"'{value}"
    return value


def restore_spreadsheet_value(value: Any) -> Any:
    if (
        isinstance(value, str)
        and len(value) > 1
        and value.startswith("'")
        and value[1] in SPREADSHEET_FORMULA_PREFIXES
    ):
        return value[1:]
    return value


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return [
            {
                key: restore_spreadsheet_value(value)
                for key, value in row.items()
            }
            for row in csv.DictReader(handle)
        ]


def write_csv(path: Path, rows: Iterable[dict[str, Any]], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    key: spreadsheet_safe_value(value)
                    for key, value in row.items()
                }
            )


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def validate_target_url(target_url: str) -> None:
    parsed = urlsplit(target_url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if parsed.scheme not in {"http", "https"} or host != "canva.com":
        raise ValueError("Target must be a full canva.com URL.")
    if not parsed.path.startswith("/vi_vn/") or parsed.path == "/vi_vn/":
        raise ValueError("Target must be a Canva Vietnam page under /vi_vn/.")


def target_relative_path(target_url: str) -> Path:
    validate_target_url(target_url)
    parts = [unquote(part) for part in urlsplit(target_url).path.split("/") if part]
    if not parts or parts[0] != "vi_vn":
        raise ValueError("Target path must begin with /vi_vn/.")
    safe_parts: list[str] = []
    for part in parts:
        safe = re.sub(r"[^A-Za-z0-9._~-]+", "-", part).strip("-").lower()
        if not safe or safe in {".", ".."}:
            raise ValueError(f"Unsafe target URL path segment: {part!r}")
        safe_parts.append(safe)
    return Path(*safe_parts)


def target_work_dir(target_url: str) -> Path:
    return REPO_ROOT / "work" / "youtube-prospecting" / target_relative_path(target_url)


def dataforseo_env_path() -> Path:
    override = (
        os.environ.get("CANVA_YOUTUBE_PROSPECTING_ENV_FILE")
        or os.environ.get("PROSPECTING_CLAUDE_ENV_FILE")
    )
    if override:
        return Path(override).expanduser().resolve()
    return REPO_ROOT / ".env"


def ensure_work_dir(target_url: str) -> Path:
    base_dir = REPO_ROOT / "work" / "youtube-prospecting"
    out_dir = target_work_dir(target_url)
    out_dir.mkdir(parents=True, exist_ok=True)
    base_readme = base_dir / "readme.md"
    if not base_readme.exists():
        base_readme.write_text(
            "# YouTube Prospecting\n\n"
            "Target-specific Canva YouTube prospecting runs live below this folder.\n",
            encoding="utf-8",
        )
    target_readme = out_dir / "readme.md"
    if not target_readme.exists():
        target_readme.write_text(
            "# YouTube Prospecting\n\n"
            f"- Target URL: {target_url}\n"
            "- Context: Find Vietnamese YouTube channels with Google-visible "
            "videos relevant to this Canva feature.\n"
            "- Inputs: `target-page.md`, `approved-queries.csv`\n"
            "- Outputs: auditor queue, SERP evidence, enriched videos, "
            "channel prospects, links, language audit, and workbook.\n"
            "- Status: prepared\n",
            encoding="utf-8",
        )
    return out_dir


def update_work_status(out_dir: Path, status: str) -> None:
    readme_path = out_dir / "readme.md"
    if not readme_path.exists():
        return
    text = readme_path.read_text(encoding="utf-8")
    replacement = f"- Status: {status}"
    updated, count = re.subn(
        r"^- Status: .*$",
        replacement,
        text,
        count=1,
        flags=re.MULTILINE,
    )
    if count == 0:
        updated = text.rstrip() + f"\n{replacement}\n"
    readme_path.write_text(updated, encoding="utf-8")


def load_queries(
    path: Path,
    *,
    minimum: int,
    maximum: int,
) -> list[dict[str, str]]:
    queries: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in read_csv(path):
        query = (row.get("query") or "").strip()
        if not query or query.casefold() in seen:
            continue
        if "site:" in query.casefold():
            raise ValueError("Approved queries must not contain search operators.")
        seen.add(query.casefold())
        queries.append(
            {
                "query": query,
                "angle": (row.get("angle") or "").strip(),
                "relationship": (row.get("relationship") or "").strip(),
                "rationale": (row.get("rationale") or "").strip(),
            }
        )
    if not minimum <= len(queries) <= maximum:
        raise ValueError(
            f"Expected {minimum}-{maximum} unique approved queries; "
            f"found {len(queries)}."
        )
    return queries


def build_executed_query(query: str) -> str:
    return f"{query} site:youtube.com"


def standard_video_id(url: str) -> str:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if host not in {"youtube.com", "m.youtube.com"} or parsed.path != "/watch":
        return ""
    video_id = (parse_qs(parsed.query).get("v") or [""])[0]
    return video_id if VIDEO_ID_RE.fullmatch(video_id) else ""


def classify_youtube_url(url: str) -> tuple[str, str]:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if host not in {"youtube.com", "m.youtube.com", "youtu.be"}:
        return "non_youtube", ""
    video_id = standard_video_id(url)
    if video_id:
        return "standard_watch", video_id
    path = parsed.path.rstrip("/")
    if path.startswith("/shorts/"):
        return "shorts", ""
    if path.startswith("/live/"):
        return "live_url", ""
    if (
        path.startswith("/channel/")
        or path.startswith("/@")
        or path.startswith("/c/")
        or path.startswith("/user/")
    ):
        return "channel", ""
    if path.startswith("/playlist"):
        return "playlist", ""
    return "other_youtube", ""


def canonical_video_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def result_language(item: dict[str, Any]) -> str:
    about = item.get("about_this_result") or {}
    return str(about.get("language") or "").strip()


def iter_serp_entries(items: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    nested_types = {"video", "video_carousel", "short_videos"}
    for item in items:
        item_type = str(item.get("type") or "")
        if item_type == "organic":
            yield {
                "item": item,
                "serp_item_type": item_type,
                "rank_absolute": item.get("rank_absolute", ""),
                "rank_group": item.get("rank_group", ""),
                "feature_position": "",
            }
            continue
        if item_type not in nested_types:
            continue
        for position, nested in enumerate(item.get("items") or [], start=1):
            if not isinstance(nested, dict):
                continue
            yield {
                "item": nested,
                "serp_item_type": item_type,
                "rank_absolute": item.get("rank_absolute", ""),
                "rank_group": item.get("rank_group", ""),
                "feature_position": position,
            }


def parse_serp_response(
    *,
    response: dict[str, Any],
    query_row: dict[str, str],
    query_index: int,
    executed_query: str,
    first_seen_start: int,
    maximum_rank_absolute: int,
) -> tuple[list[dict[str, Any]], int]:
    tasks = response.get("tasks") or []
    if not tasks:
        raise ValueError(f"No DataForSEO task returned for query: {query_row['query']}")
    task = tasks[0]
    status_code = int(task.get("status_code") or 0)
    if not 20000 <= status_code < 30000:
        raise ValueError(
            f"DataForSEO query failed [{status_code}] for "
            f"{query_row['query']}: {task.get('status_message') or 'Unknown error'}"
        )
    result_sets = task.get("result") or []
    items = (result_sets[0].get("items") or []) if result_sets else []
    rows: list[dict[str, Any]] = []
    first_seen = first_seen_start

    for entry in iter_serp_entries(items):
        item = entry["item"]
        raw_url = str(item.get("url") or "")
        url_kind, video_id = classify_youtube_url(raw_url)
        rank_raw = entry["rank_absolute"]
        try:
            rank_absolute = int(rank_raw)
        except (TypeError, ValueError):
            rank_absolute = 0
        included = (
            url_kind == "standard_watch"
            and rank_absolute > 0
            and rank_absolute <= maximum_rank_absolute
        )
        exclusion_reason = ""
        if url_kind != "standard_watch":
            exclusion_reason = url_kind
        elif rank_absolute <= 0:
            exclusion_reason = "missing_rank_absolute"
        elif rank_absolute > maximum_rank_absolute:
            exclusion_reason = "beyond_rank_limit"
        first_seen += 1
        rows.append(
            {
                "query_index": query_index,
                **query_row,
                "executed_query": executed_query,
                "serp_item_type": entry["serp_item_type"],
                "rank_absolute": rank_absolute or "",
                "rank_group": entry["rank_group"],
                "feature_position": entry["feature_position"],
                "raw_url": raw_url,
                "url_kind": url_kind,
                "video_id": video_id,
                "canonical_video_url": (
                    canonical_video_url(video_id) if video_id else ""
                ),
                "title": item.get("title") or "",
                "source": item.get("source") or item.get("domain") or "",
                "google_result_language": result_language(item),
                "included": included,
                "exclusion_reason": exclusion_reason,
                "first_seen_order": first_seen,
            }
        )
    return rows, first_seen


def aggregate_video_candidates(
    raw_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for row in raw_rows:
        if not row["included"] or not row["video_id"]:
            continue
        video_id = row["video_id"]
        rank = int(row["rank_absolute"])
        candidate = grouped.get(video_id)
        if candidate is None:
            candidate = {
                "video_id": video_id,
                "canonical_video_url": row["canonical_video_url"],
                "serp_title": row["title"],
                "google_best_rank_absolute": rank,
                "google_serp_occurrences": 0,
                "first_seen_order": int(row["first_seen_order"]),
                "query_ranks_map": {},
                "google_result_languages_set": set(),
            }
            grouped[video_id] = candidate
        candidate["google_serp_occurrences"] += 1
        query = row["query"]
        previous = candidate["query_ranks_map"].get(query)
        if previous is None or rank < previous:
            candidate["query_ranks_map"][query] = rank
        if rank < candidate["google_best_rank_absolute"]:
            candidate["google_best_rank_absolute"] = rank
            candidate["serp_title"] = row["title"]
        language = str(row.get("google_result_language") or "").strip()
        if language:
            candidate["google_result_languages_set"].add(language)

    candidates: list[dict[str, Any]] = []
    for candidate in grouped.values():
        query_ranks = sorted(
            candidate.pop("query_ranks_map").items(),
            key=lambda item: (item[1], item[0].casefold()),
        )
        languages = sorted(
            candidate.pop("google_result_languages_set"),
            key=str.casefold,
        )
        candidate["matched_query_count"] = len(query_ranks)
        candidate["matched_queries"] = " | ".join(query for query, _ in query_ranks)
        candidate["query_ranks"] = " | ".join(
            f"{query}: {rank}" for query, rank in query_ranks
        )
        candidate["google_result_languages"] = " | ".join(languages)
        candidates.append(candidate)
    return sorted(
        candidates,
        key=lambda row: (
            int(row["google_best_rank_absolute"]),
            -int(row["matched_query_count"]),
            int(row["first_seen_order"]),
        ),
    )


def parse_dataforseo_item(response: dict[str, Any], label: str) -> dict[str, Any]:
    tasks = response.get("tasks") or []
    if not tasks:
        raise ValueError(f"No DataForSEO task returned for {label}.")
    task = tasks[0]
    status_code = int(task.get("status_code") or 0)
    if not 20000 <= status_code < 30000:
        raise ValueError(
            f"DataForSEO task failed [{status_code}] for {label}: "
            f"{task.get('status_message') or 'Unknown error'}"
        )
    results = task.get("result") or []
    items = (results[0].get("items") or []) if results else []
    if not items:
        raise ValueError(f"No DataForSEO item returned for {label}.")
    return items[0]


def is_vietnamese_language(language: str) -> bool:
    normalized = re.sub(r"[_-]+", " ", language.strip().casefold())
    return (
        normalized == "vi"
        or normalized.startswith("vi ")
        or "vietnamese" in normalized
        or "tiếng việt" in normalized
        or "tieng viet" in normalized
    )


def subtitle_language_status(subtitles: list[dict[str, Any]]) -> str:
    auto_languages = [
        str(item.get("language") or "")
        for item in subtitles
        if item.get("is_auto_generated")
    ]
    manual_languages = [
        str(item.get("language") or "")
        for item in subtitles
        if not item.get("is_auto_generated")
    ]
    if any(is_vietnamese_language(language) for language in auto_languages):
        return "vietnamese_spoken_signal"
    if any(is_vietnamese_language(language) for language in manual_languages):
        return "vietnamese_caption_available"
    if any(language.strip() for language in auto_languages):
        return "non_vietnamese_spoken_signal"
    return "unknown"


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if item is not None]


def enrich_video_candidate(
    candidate: dict[str, Any],
    response: dict[str, Any],
    *,
    location_code: int,
    language_code: str,
) -> dict[str, Any]:
    row = {
        **candidate,
        "title": candidate.get("serp_title", ""),
        "search_location_code": location_code,
        "search_language_code": language_code,
        "enrichment_status": "error",
        "enrichment_error": "",
    }
    try:
        item = parse_dataforseo_item(response, candidate["video_id"])
    except ValueError as exc:
        row["enrichment_error"] = str(exc)
        return row

    subtitles = [
        subtitle
        for subtitle in (item.get("subtitles") or [])
        if isinstance(subtitle, dict)
    ]
    subtitle_languages = sorted(
        {
            str(subtitle.get("language") or "").strip()
            for subtitle in subtitles
            if str(subtitle.get("language") or "").strip()
        },
        key=str.casefold,
    )
    auto_languages = sorted(
        {
            str(subtitle.get("language") or "").strip()
            for subtitle in subtitles
            if subtitle.get("is_auto_generated")
            and str(subtitle.get("language") or "").strip()
        },
        key=str.casefold,
    )
    raw_subscribers = item.get("channel_subscribers_count")
    subscribers = raw_subscribers if isinstance(raw_subscribers, dict) else {}
    is_live = bool(item.get("is_live"))
    row.update(
        {
            "canonical_video_url": item.get("url") or row["canonical_video_url"],
            "title": item.get("title") or row["title"],
            "thumbnail_url": item.get("thumbnail_url") or "",
            "publication_date": item.get("publication_date") or "",
            "duration_time": item.get("duration_time") or "",
            "duration_time_seconds": item.get("duration_time_seconds") or "",
            "video_views": item.get("views_count") or 0,
            "video_likes": item.get("likes_count") or 0,
            "video_comments": item.get("comments_count") or 0,
            "video_tags": " | ".join(string_list(item.get("keywords"))),
            "category": item.get("category") or "",
            "subtitle_languages": " | ".join(subtitle_languages),
            "auto_generated_subtitle_languages": " | ".join(auto_languages),
            "video_language_status": subtitle_language_status(subtitles),
            "is_live": is_live,
            "is_embeddable": bool(item.get("is_embeddable")),
            "channel_id": item.get("channel_id") or "",
            "channel_name": item.get("channel_name") or "",
            "channel_url": item.get("channel_url") or "",
            "channel_logo": item.get("channel_logo") or "",
            "channel_subscribers_displayed": subscribers.get("displayed_count") or "",
            "channel_subscribers": subscribers.get("count") or 0,
            "enrichment_status": "excluded_live" if is_live else "qualified",
            "enrichment_error": "",
        }
    )
    return row


def aggregate_channels(videos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for video in videos:
        if video.get("enrichment_status") != "qualified":
            continue
        channel_id = str(video.get("channel_id") or "")
        if not channel_id:
            continue
        channel = grouped.get(channel_id)
        if channel is None:
            channel = {
                "channel_id": channel_id,
                "channel_name": video.get("channel_name") or "",
                "channel_url": video.get("channel_url") or "",
                "channel_logo": video.get("channel_logo") or "",
                "channel_subscribers_displayed": (
                    video.get("channel_subscribers_displayed") or ""
                ),
                "channel_subscribers": int(video.get("channel_subscribers") or 0),
                "google_best_rank_absolute": int(
                    video.get("google_best_rank_absolute") or 9999
                ),
                "queries": set(),
                "videos": [],
                "language_statuses": defaultdict(int),
            }
            grouped[channel_id] = channel
        channel["channel_subscribers"] = max(
            int(channel["channel_subscribers"] or 0),
            int(video.get("channel_subscribers") or 0),
        )
        channel["google_best_rank_absolute"] = min(
            int(channel["google_best_rank_absolute"]),
            int(video.get("google_best_rank_absolute") or 9999),
        )
        channel["queries"].update(
            query.strip()
            for query in str(video.get("matched_queries") or "").split(" | ")
            if query.strip()
        )
        channel["videos"].append(video["canonical_video_url"])
        channel["language_statuses"][video.get("video_language_status") or "unknown"] += 1

    rows: list[dict[str, Any]] = []
    for channel in grouped.values():
        queries = sorted(channel.pop("queries"), key=str.casefold)
        videos = sorted(set(channel.pop("videos")))
        statuses = channel.pop("language_statuses")
        strong = int(statuses.get("vietnamese_spoken_signal", 0))
        caption = int(statuses.get("vietnamese_caption_available", 0))
        non_vietnamese = int(statuses.get("non_vietnamese_spoken_signal", 0))
        unknown = int(statuses.get("unknown", 0))
        if strong:
            qualification = "vietnamese_spoken_signal"
        elif caption:
            qualification = "vietnamese_caption_review"
        elif unknown:
            qualification = "language_review"
        else:
            qualification = "non_vietnamese_signal"
        rows.append(
            {
                **channel,
                "matched_query_count": len(queries),
                "matched_queries": " | ".join(queries),
                "ranking_video_count": len(videos),
                "ranking_video_urls": " | ".join(videos),
                "video_language_statuses": " | ".join(
                    f"{key}: {value}"
                    for key, value in sorted(statuses.items())
                ),
                "vietnamese_spoken_video_count": strong,
                "vietnamese_caption_video_count": caption,
                "non_vietnamese_video_count": non_vietnamese,
                "unknown_language_video_count": unknown,
                "language_qualification": qualification,
            }
        )
    qualification_order = {
        "vietnamese_spoken_signal": 0,
        "vietnamese_caption_review": 1,
        "language_review": 2,
        "non_vietnamese_signal": 3,
    }
    return sorted(
        rows,
        key=lambda row: (
            qualification_order.get(row["language_qualification"], 9),
            -int(row["matched_query_count"]),
            int(row["google_best_rank_absolute"]),
            -int(row["channel_subscribers"] or 0),
        ),
    )


def int_value(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def split_public_emails(value: Any) -> list[str]:
    return [
        email.strip()
        for email in str(value or "").split(" | ")
        if email.strip()
    ]


def auditor_channel_key(row: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(row.get("channel_id") or ""),
        str(row.get("channel_url") or ""),
        str(row.get("channel_name") or ""),
    )


def build_auditor_video_queue(
    *,
    channels: list[dict[str, Any]],
    videos: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    channel_by_id = {
        str(channel.get("channel_id") or ""): channel
        for channel in channels
        if channel.get("channel_id")
    }
    rows: list[dict[str, Any]] = []
    for video in videos:
        if video.get("enrichment_status") != "qualified":
            continue
        channel = channel_by_id.get(str(video.get("channel_id") or ""), {})
        emails = split_public_emails(channel.get("public_emails"))
        rows.append(
            {
                "audit_status": "",
                "auditor_notes": "",
                "recipient_email": emails[0] if emails else "",
                "additional_public_emails": " | ".join(emails[1:]),
                "public_email_count": channel.get("public_email_count", 0),
                "channel_name": (
                    channel.get("channel_name") or video.get("channel_name") or ""
                ),
                "channel_url": (
                    channel.get("channel_url") or video.get("channel_url") or ""
                ),
                "channel_subscribers": (
                    channel.get("channel_subscribers")
                    or video.get("channel_subscribers")
                    or 0
                ),
                "channel_total_views": channel.get("channel_total_views", 0),
                "public_video_count": channel.get("public_video_count", 0),
                "video_priority_within_channel": 0,
                "video_title": video.get("title", ""),
                "video_url": video.get("canonical_video_url", ""),
                "video_views": video.get("video_views", 0),
                "google_best_rank_absolute": video.get(
                    "google_best_rank_absolute",
                    "",
                ),
                "matched_queries": video.get("matched_queries", ""),
                "query_ranks": video.get("query_ranks", ""),
                "google_serp_occurrences": video.get("google_serp_occurrences", 0),
                "language_qualification": channel.get("language_qualification", ""),
                "video_language_status": video.get("video_language_status", ""),
                "website": channel.get("website", ""),
                "facebook": channel.get("facebook", ""),
                "instagram": channel.get("instagram", ""),
                "tiktok": channel.get("tiktok", ""),
                "linkedin": channel.get("linkedin", ""),
                "twitter_x": channel.get("twitter_x", ""),
                "other_links": channel.get("other_links", ""),
                "channel_id": video.get("channel_id", ""),
                "video_id": video.get("video_id", ""),
            }
        )

    rows.sort(
        key=lambda row: (
            -int_value(row.get("channel_subscribers")),
            str(row.get("channel_name") or "").casefold(),
            str(row.get("channel_id") or ""),
            int_value(row.get("google_best_rank_absolute"), 999_999),
            -int_value(row.get("video_views")),
            str(row.get("video_title") or "").casefold(),
            str(row.get("video_id") or ""),
        )
    )
    priority_by_channel: dict[tuple[str, str, str], int] = defaultdict(int)
    for row in rows:
        key = auditor_channel_key(row)
        priority_by_channel[key] += 1
        row["video_priority_within_channel"] = priority_by_channel[key]
    return rows


def extract_balanced_json(text: str, marker: str) -> dict[str, Any] | None:
    marker_index = text.find(marker)
    if marker_index < 0:
        return None
    start = text.find("{", marker_index + len(marker))
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : index + 1])
    return None


def extract_yt_initial_data(html_text: str) -> dict[str, Any]:
    markers = (
        "var ytInitialData =",
        "ytInitialData =",
        'window["ytInitialData"] =',
    )
    for marker in markers:
        try:
            data = extract_balanced_json(html_text, marker)
        except json.JSONDecodeError:
            continue
        if data:
            return data
    raise ValueError("Could not locate valid ytInitialData JSON.")


def walk_dicts(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_dicts(child)


def find_about_model(data: dict[str, Any]) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    for node in walk_dicts(data):
        model = node.get("aboutChannelViewModel")
        if isinstance(model, dict):
            candidates.append(model)
    if not candidates:
        raise ValueError("Channel About model was not present.")
    return max(
        candidates,
        key=lambda model: sum(
            bool(model.get(key))
            for key in ("viewCountText", "joinedDateText", "videoCountText", "links")
        ),
    )


def text_value(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if not isinstance(value, dict):
        return ""
    if value.get("simpleText"):
        return str(value["simpleText"]).strip()
    if value.get("content"):
        return str(value["content"]).strip()
    return "".join(
        str(run.get("text") or run.get("content") or "")
        for run in (value.get("runs") or [])
        if isinstance(run, dict)
    ).strip()


def parse_count_text(value: Any) -> int:
    text = text_value(value)
    match = re.search(r"([\d.,]+)\s*([KMB])?", text, re.IGNORECASE)
    if not match:
        return 0
    raw_number, suffix = match.groups()
    if suffix:
        try:
            number = float(raw_number.replace(",", ""))
        except ValueError:
            return 0
        multiplier = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}[suffix.upper()]
        return int(number * multiplier)
    digits = re.sub(r"\D", "", raw_number)
    return int(digits) if digits else 0


def parse_joined_date(value: Any) -> str:
    text = re.sub(r"^Joined\s+", "", text_value(value), flags=re.IGNORECASE)
    for date_format in ("%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(text, date_format).date().isoformat()
        except ValueError:
            continue
    return text


def nested_urls(value: Any) -> Iterator[str]:
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "url" and isinstance(child, str):
                yield child
            else:
                yield from nested_urls(child)
    elif isinstance(value, list):
        for child in value:
            yield from nested_urls(child)


def unwrap_youtube_redirect(url: str) -> str:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if host == "youtube.com" and parsed.path == "/redirect":
        target = (parse_qs(parsed.query).get("q") or [""])[0]
        return unquote(target) if target else url
    return url


def external_url_key(url: str) -> str:
    parsed = urlsplit(url.strip())
    normalized_path = parsed.path.rstrip("/") or "/"
    return urlunsplit(
        (
            parsed.scheme.casefold(),
            parsed.netloc.casefold(),
            normalized_path,
            parsed.query,
            "",
        )
    )


def classify_external_link(url: str) -> str:
    if extract_emails(url):
        return "email"
    host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    if host.endswith("instagram.com"):
        return "instagram"
    if host.endswith("facebook.com"):
        return "facebook"
    if host.endswith("twitter.com") or host.endswith("x.com"):
        return "twitter_x"
    if host.endswith("linkedin.com"):
        return "linkedin"
    if host.endswith("tiktok.com"):
        return "tiktok"
    if host:
        return "website"
    return "other"


def clean_description_url(url: str) -> str:
    url = url.rstrip(".,;:!?)")
    if url.lower().startswith("www."):
        return f"https://{url}"
    return url


def extract_emails(*values: Any) -> list[str]:
    emails: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = unquote(str(value or ""))
        for match in EMAIL_RE.findall(text):
            email = match.strip(".,;:!?()[]{}<>\"'")
            key = email.casefold()
            if key in seen:
                continue
            seen.add(key)
            emails.append(email)
    return emails


def parse_channel_about_html(
    html_text: str,
    *,
    channel_id: str,
    channel_name: str,
    channel_url: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    model = find_about_model(extract_yt_initial_data(html_text))
    links: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    seen_emails: set[str] = set()

    def add_email(email: str, *, label: str, source: str) -> None:
        key = email.casefold()
        if key in seen_emails:
            return
        seen_emails.add(key)
        links.append(
            {
                "channel_id": channel_id,
                "channel_name": channel_name,
                "channel_url": channel_url,
                "link_type": "email",
                "label": label,
                "url": email,
                "source": source,
            }
        )

    for link_wrapper in model.get("links") or []:
        if not isinstance(link_wrapper, dict):
            continue
        view_model = link_wrapper.get("channelExternalLinkViewModel") or {}
        if not isinstance(view_model, dict):
            continue
        label = text_value(view_model.get("title"))
        urls = [
            unwrap_youtube_redirect(url)
            for url in nested_urls(view_model.get("link") or {})
            if url.startswith(("http://", "https://", "mailto:"))
        ]
        if not urls:
            continue
        url = urls[0]
        for email in extract_emails(label, url):
            add_email(email, label=label, source="published_link")
        if not url.startswith(("http://", "https://")):
            continue
        url_key = external_url_key(url)
        if url_key in seen_urls:
            continue
        seen_urls.add(url_key)
        links.append(
            {
                "channel_id": channel_id,
                "channel_name": channel_name,
                "channel_url": channel_url,
                "link_type": classify_external_link(url),
                "label": label,
                "url": url,
                "source": "published_link",
            }
        )

    description = text_value(model.get("description"))
    for email in extract_emails(description):
        add_email(email, label="", source="channel_description")
    for match in DESCRIPTION_URL_RE.findall(description):
        url = clean_description_url(match)
        url_key = external_url_key(url)
        if url_key in seen_urls:
            continue
        seen_urls.add(url_key)
        links.append(
            {
                "channel_id": channel_id,
                "channel_name": channel_name,
                "channel_url": channel_url,
                "link_type": classify_external_link(url),
                "label": "",
                "url": url,
                "source": "channel_description",
            }
        )

    flattened: dict[str, list[str]] = defaultdict(list)
    for link in links:
        flattened[link["link_type"]].append(link["url"])
    known_types = ("website", "instagram", "facebook", "twitter_x", "linkedin", "tiktok")
    public_emails = flattened.get("email", [])
    channel_data = {
        "public_video_count": parse_count_text(model.get("videoCountText")),
        "channel_total_views": parse_count_text(model.get("viewCountText")),
        "joined_date": parse_joined_date(model.get("joinedDateText")),
        "public_email_count": len(public_emails),
        "public_emails": " | ".join(public_emails),
        **{
            link_type: flattened.get(link_type, [""])[0]
            for link_type in known_types
        },
        "other_links": " | ".join(flattened.get("other", [])),
        "channel_about_status": "success",
        "channel_links_status": "success" if links else "no_links_published",
    }
    return channel_data, links


def fetch_channel_about(
    channel: dict[str, Any],
    *,
    client: httpx.Client,
    limiter: RequestRateLimiter,
    timeout_seconds: float,
    max_retries: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    url = f"https://www.youtube.com/channel/{channel['channel_id']}/about?hl=en"
    last_error = ""
    for attempt in range(max_retries + 1):
        limiter.wait()
        try:
            response = client.get(url, timeout=timeout_seconds)
        except httpx.HTTPError as exc:
            last_error = str(exc)
            if attempt < max_retries:
                time.sleep(2**attempt)
                continue
            break
        if response.status_code in {403, 429}:
            return (
                {
                    "channel_about_status": "blocked",
                    "channel_links_status": "blocked",
                },
                [],
            )
        if response.status_code >= 500 and attempt < max_retries:
            time.sleep(2**attempt)
            continue
        if response.status_code >= 400:
            return (
                {
                    "channel_about_status": f"http_{response.status_code}",
                    "channel_links_status": "http_error",
                },
                [],
            )
        try:
            return parse_channel_about_html(
                response.text,
                channel_id=channel["channel_id"],
                channel_name=channel["channel_name"],
                channel_url=channel["channel_url"],
            )
        except (ValueError, json.JSONDecodeError) as exc:
            last_error = str(exc)
            break
    return (
        {
            "channel_about_status": "parse_error",
            "channel_links_status": "parse_error",
            "channel_about_error": last_error,
        },
        [],
    )


def enrich_channels(
    channels: list[dict[str, Any]],
    config: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not channels:
        return [], []
    limiter = RequestRateLimiter(
        float(config["channel_about_requests_per_second"])
    )
    headers = {
        "user-agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36"
        ),
        "accept-language": "en-US,en;q=0.9",
    }
    all_links: list[dict[str, Any]] = []
    with httpx.Client(headers=headers, follow_redirects=True) as client:
        def run(channel: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
            return fetch_channel_about(
                channel,
                client=client,
                limiter=limiter,
                timeout_seconds=float(config["channel_about_timeout_seconds"]),
                max_retries=int(config["channel_about_max_retries"]),
            )

        workers = max(
            1,
            min(int(config["channel_about_concurrency"]), len(channels)),
        )
        with ThreadPoolExecutor(max_workers=workers) as executor:
            results = list(executor.map(run, channels))

    enriched: list[dict[str, Any]] = []
    for channel, (about_data, links) in zip(channels, results):
        enriched.append({**channel, **about_data})
        all_links.extend(links)
    return enriched, all_links


def build_workbook_payload(
    *,
    target_url: str,
    generated_at: str,
    auditor_rows: list[dict[str, Any]],
    channels: list[dict[str, Any]],
    videos: list[dict[str, Any]],
    raw_rows: list[dict[str, Any]],
    links: list[dict[str, Any]],
) -> dict[str, Any]:
    language_rows = [
        {column: video.get(column, "") for column in LANGUAGE_COLUMNS}
        for video in videos
    ]
    return {
        "title": "Canva YouTube prospecting",
        "target_url": target_url,
        "generated_at": generated_at,
        "sheets": [
            {
                "name": "Auditor video queue",
                "columns": AUDITOR_QUEUE_COLUMNS,
                "rows": auditor_rows,
            },
            {
                "name": "Channel prospects",
                "columns": CHANNEL_COLUMNS,
                "rows": channels,
            },
            {
                "name": "Ranking videos",
                "columns": VIDEO_COLUMNS,
                "rows": videos,
            },
            {
                "name": "SERP evidence",
                "columns": RAW_SERP_COLUMNS,
                "rows": raw_rows,
            },
            {
                "name": "Channel links",
                "columns": LINK_COLUMNS,
                "rows": links,
            },
            {
                "name": "Language audit",
                "columns": LANGUAGE_COLUMNS,
                "rows": language_rows,
            },
        ],
    }


def response_cost(response: dict[str, Any]) -> float:
    top_level = float(response.get("cost") or 0.0)
    if top_level:
        return top_level
    return sum(
        float(task.get("cost") or 0.0)
        for task in (response.get("tasks") or [])
    )


def public_email_summary(channels: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "channels_with_public_emails": sum(
            int(channel.get("public_email_count") or 0) > 0
            for channel in channels
        ),
        "public_email_count": sum(
            int(channel.get("public_email_count") or 0)
            for channel in channels
        ),
    }


def run_collect(args: argparse.Namespace) -> int:
    config = read_yaml(args.config)
    out_dir = ensure_work_dir(args.target_url)
    queries = load_queries(
        args.queries,
        minimum=int(config["minimum_query_count"]),
        maximum=int(config["maximum_query_count"]),
    )
    write_csv(out_dir / "approved-queries.csv", queries, QUERY_COLUMNS)
    executed_rows = [
        {**query, "executed_query": build_executed_query(query["query"])}
        for query in queries
    ]
    write_csv(
        out_dir / "executed-queries.csv",
        executed_rows,
        [*QUERY_COLUMNS, "executed_query"],
    )

    print(
        f"DataForSEO discovery calls: {len(queries)} Google SERPs.",
        file=sys.stderr,
    )
    client = DataForSEOClient(env_path=dataforseo_env_path())
    serp_payloads = [
        [
            {
                "keyword": row["executed_query"],
                "location_code": int(config["location_code"]),
                "language_code": str(config["language"]),
                "depth": int(config["serp_depth"]),
                "device": str(config["device"]),
            }
        ]
        for row in executed_rows
    ]
    serp_responses = client.post_each(
        "/v3/serp/google/organic/live/advanced",
        serp_payloads,
        concurrency=int(config["serp_concurrency"]),
    )
    raw_rows: list[dict[str, Any]] = []
    first_seen = 0
    serp_cost = 0.0
    for index, (query, executed, response) in enumerate(
        zip(queries, executed_rows, serp_responses),
        start=1,
    ):
        serp_cost += response_cost(response)
        parsed, first_seen = parse_serp_response(
            response=response,
            query_row=query,
            query_index=index,
            executed_query=executed["executed_query"],
            first_seen_start=first_seen,
            maximum_rank_absolute=int(config["maximum_rank_absolute"]),
        )
        raw_rows.extend(parsed)
    candidates = aggregate_video_candidates(raw_rows)

    print(
        f"DataForSEO enrichment calls: {len(candidates)} unique videos.",
        file=sys.stderr,
    )
    video_payloads = [
        [
            {
                "video_id": candidate["video_id"],
                "location_code": int(config["location_code"]),
                "language_code": str(config["language"]),
                "device": str(config["device"]),
            }
        ]
        for candidate in candidates
    ]
    video_responses = client.post_each(
        "/v3/serp/youtube/video_info/live/advanced",
        video_payloads,
        concurrency=int(config["video_info_concurrency"]),
    )
    video_cost = sum(response_cost(response) for response in video_responses)
    videos = [
        enrich_video_candidate(
            candidate,
            response,
            location_code=int(config["location_code"]),
            language_code=str(config["language"]),
        )
        for candidate, response in zip(candidates, video_responses)
    ]
    channels = aggregate_channels(videos)
    channels, links = enrich_channels(channels, config)
    auditor_rows = build_auditor_video_queue(
        channels=channels,
        videos=videos,
    )

    generated_at = datetime.now(timezone.utc).isoformat()
    write_csv(out_dir / "raw-serp-results.csv", raw_rows, RAW_SERP_COLUMNS)
    write_csv(out_dir / "ranking-videos.csv", videos, VIDEO_COLUMNS)
    write_csv(
        out_dir / "auditor-video-queue.csv",
        auditor_rows,
        AUDITOR_QUEUE_COLUMNS,
    )
    write_csv(out_dir / "channel-prospects.csv", channels, CHANNEL_COLUMNS)
    write_csv(out_dir / "channel-links.csv", links, LINK_COLUMNS)
    write_csv(
        out_dir / "language-audit.csv",
        videos,
        LANGUAGE_COLUMNS,
    )
    write_json(
        out_dir / "workbook-data.json",
        build_workbook_payload(
            target_url=args.target_url,
            generated_at=generated_at,
            auditor_rows=auditor_rows,
            channels=channels,
            videos=videos,
            raw_rows=raw_rows,
            links=links,
        ),
    )
    summary = {
        "target_url": args.target_url,
        "generated_at": generated_at,
        "market": config["market"],
        "location_code": int(config["location_code"]),
        "language_code": config["language"],
        "approved_query_count": len(queries),
        "serp_depth": int(config["serp_depth"]),
        "maximum_rank_absolute": int(config["maximum_rank_absolute"]),
        "raw_serp_rows": len(raw_rows),
        "included_serp_rows": sum(bool(row["included"]) for row in raw_rows),
        "unique_standard_videos": len(candidates),
        "qualified_non_live_videos": sum(
            video.get("enrichment_status") == "qualified"
            for video in videos
        ),
        "excluded_live_videos": sum(
            video.get("enrichment_status") == "excluded_live"
            for video in videos
        ),
        "unique_channels": len(channels),
        "channels_with_links": sum(
            channel.get("channel_links_status") == "success"
            for channel in channels
        ),
        **public_email_summary(channels),
        "dataforseo_google_serp_cost_usd": round(serp_cost, 4),
        "dataforseo_video_info_cost_usd": round(video_cost, 4),
        "dataforseo_total_cost_usd": round(serp_cost + video_cost, 4),
    }
    write_json(out_dir / "run-summary.json", summary)
    update_work_status(
        out_dir,
        f"data collected at {generated_at}; workbook pending",
    )
    print(
        f"Collected {len(candidates)} unique standard videos and "
        f"{len(channels)} unique channels. Actual DataForSEO cost: "
        f"${serp_cost + video_cost:.4f}",
        file=sys.stderr,
    )
    print(out_dir)
    return 0


def run_refresh_about(args: argparse.Namespace) -> int:
    config = read_yaml(args.config)
    out_dir = target_work_dir(args.target_url)
    videos_path = out_dir / "ranking-videos.csv"
    raw_rows_path = out_dir / "raw-serp-results.csv"
    if not videos_path.exists() or not raw_rows_path.exists():
        raise ValueError(
            "Existing ranking-videos.csv and raw-serp-results.csv are required. "
            "Run collect first."
        )

    videos = read_csv(videos_path)
    raw_rows = read_csv(raw_rows_path)
    channels = aggregate_channels(videos)
    print(
        f"Refreshing public About data for {len(channels)} unique channels.",
        file=sys.stderr,
    )
    channels, links = enrich_channels(channels, config)
    auditor_rows = build_auditor_video_queue(
        channels=channels,
        videos=videos,
    )
    refreshed_at = datetime.now(timezone.utc).isoformat()

    write_csv(
        out_dir / "auditor-video-queue.csv",
        auditor_rows,
        AUDITOR_QUEUE_COLUMNS,
    )
    write_csv(out_dir / "channel-prospects.csv", channels, CHANNEL_COLUMNS)
    write_csv(out_dir / "channel-links.csv", links, LINK_COLUMNS)
    write_json(
        out_dir / "workbook-data.json",
        build_workbook_payload(
            target_url=args.target_url,
            generated_at=refreshed_at,
            auditor_rows=auditor_rows,
            channels=channels,
            videos=videos,
            raw_rows=raw_rows,
            links=links,
        ),
    )

    summary_path = out_dir / "run-summary.json"
    summary = (
        json.loads(summary_path.read_text(encoding="utf-8"))
        if summary_path.exists()
        else {"target_url": args.target_url}
    )
    summary.update(
        {
            "about_refreshed_at": refreshed_at,
            "unique_channels": len(channels),
            "channels_with_links": sum(
                channel.get("channel_links_status") == "success"
                for channel in channels
            ),
            **public_email_summary(channels),
        }
    )
    write_json(summary_path, summary)
    update_work_status(
        out_dir,
        f"public About data refreshed at {refreshed_at}; workbook pending",
    )
    email_summary = public_email_summary(channels)
    print(
        f"Refreshed {len(channels)} channels; found "
        f"{email_summary['public_email_count']} public email addresses across "
        f"{email_summary['channels_with_public_emails']} channels.",
        file=sys.stderr,
    )
    print(out_dir)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build Canva YouTube outreach prospect datasets."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare", help="Create the target work folder.")
    prepare.add_argument("--target-url", required=True)

    collect = subparsers.add_parser(
        "collect",
        help="Collect Google SERPs, enrich videos, and aggregate channels.",
    )
    collect.add_argument("--target-url", required=True)
    collect.add_argument("--queries", required=True, type=Path)
    collect.add_argument("--config", type=Path, default=DEFAULT_CONFIG)

    refresh_about = subparsers.add_parser(
        "refresh-about",
        help="Refresh public channel About data without repeating DataForSEO calls.",
    )
    refresh_about.add_argument("--target-url", required=True)
    refresh_about.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            print(ensure_work_dir(args.target_url))
            return 0
        if args.command == "collect":
            return run_collect(args)
        if args.command == "refresh-about":
            return run_refresh_about(args)
    except (ValueError, OSError, httpx.HTTPError, DataForSEOError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
