from __future__ import annotations

import argparse
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SKILL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_DIR / "scripts"))

import prospecting


class ProspectingTests(unittest.TestCase):
    def test_target_path_preserves_canva_url_route(self) -> None:
        self.assertEqual(
            prospecting.target_relative_path(
                "https://www.canva.com/vi_vn/thiet-ke/video/?x=1"
            ),
            Path("vi_vn/thiet-ke/video"),
        )

    def test_target_url_must_be_canva_vietnam(self) -> None:
        with self.assertRaises(ValueError):
            prospecting.validate_target_url(
                "https://www.canva.com/en_gb/create/videos/"
            )

    def test_dataforseo_env_path_uses_explicit_override(self) -> None:
        with patch.dict(
            prospecting.os.environ,
            {"PROSPECTING_CLAUDE_ENV_FILE": "~/custom-dataforseo.env"},
        ):
            self.assertEqual(
                prospecting.dataforseo_env_path(),
                Path("~/custom-dataforseo.env").expanduser().resolve(),
            )

    def test_standard_watch_video_id_excludes_shorts_and_live(self) -> None:
        self.assertEqual(
            prospecting.standard_video_id(
                "https://www.youtube.com/watch?v=abcdefghijk&t=5"
            ),
            "abcdefghijk",
        )
        self.assertEqual(
            prospecting.standard_video_id(
                "https://www.youtube.com/shorts/abcdefghijk"
            ),
            "",
        )
        self.assertEqual(
            prospecting.classify_youtube_url(
                "https://www.youtube.com/live/abcdefghijk"
            )[0],
            "live_url",
        )

    def test_load_queries_requires_five_to_ten_and_rejects_operators(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "queries.csv"
            rows = [
                {
                    "query": f"truy vấn {index}",
                    "angle": "",
                    "relationship": "direct",
                    "rationale": "",
                }
                for index in range(5)
            ]
            prospecting.write_csv(path, rows, prospecting.QUERY_COLUMNS)
            loaded = prospecting.load_queries(path, minimum=5, maximum=10)
            self.assertEqual(len(loaded), 5)

            rows[0]["query"] = "video site:youtube.com"
            prospecting.write_csv(path, rows, prospecting.QUERY_COLUMNS)
            with self.assertRaises(ValueError):
                prospecting.load_queries(path, minimum=5, maximum=10)

    def test_parse_serp_keeps_standard_watch_results_only(self) -> None:
        response = {
            "tasks": [
                {
                    "status_code": 20000,
                    "result": [
                        {
                            "items": [
                                {
                                    "type": "organic",
                                    "rank_absolute": 1,
                                    "rank_group": 1,
                                    "url": "https://www.youtube.com/watch?v=abcdefghijk",
                                    "title": "Standard video",
                                    "about_this_result": {"language": "Vietnamese"},
                                },
                                {
                                    "type": "organic",
                                    "rank_absolute": 2,
                                    "rank_group": 2,
                                    "url": "https://www.youtube.com/shorts/lmnopqrstuv",
                                    "title": "Short",
                                },
                                {
                                    "type": "video",
                                    "rank_absolute": 3,
                                    "rank_group": 1,
                                    "items": [
                                        {
                                            "type": "video_element",
                                            "url": "https://www.youtube.com/watch?v=zyxwvutsrqp",
                                            "title": "Video module result",
                                            "source": "YouTube",
                                        },
                                        {
                                            "type": "video_element",
                                            "url": "https://www.youtube.com/live/lmnopqrstuv",
                                            "title": "Live result",
                                            "source": "YouTube",
                                        },
                                    ],
                                },
                            ]
                        }
                    ],
                }
            ]
        }
        rows, first_seen = prospecting.parse_serp_response(
            response=response,
            query_row={
                "query": "cách làm video",
                "angle": "tutorial",
                "relationship": "direct",
                "rationale": "",
            },
            query_index=1,
            executed_query="cách làm video site:youtube.com",
            first_seen_start=0,
            maximum_rank_absolute=20,
        )
        self.assertEqual(first_seen, 4)
        included = [row for row in rows if row["included"]]
        self.assertEqual(
            [row["video_id"] for row in included],
            ["abcdefghijk", "zyxwvutsrqp"],
        )
        self.assertEqual(included[1]["rank_absolute"], 3)
        self.assertEqual(included[1]["feature_position"], 1)

    def test_video_deduplication_retains_queries_and_best_rank(self) -> None:
        base = {
            "included": True,
            "video_id": "abcdefghijk",
            "canonical_video_url": (
                "https://www.youtube.com/watch?v=abcdefghijk"
            ),
            "title": "Video",
            "google_result_language": "",
        }
        rows = [
            {
                **base,
                "query": "query b",
                "rank_absolute": 5,
                "first_seen_order": 1,
            },
            {
                **base,
                "query": "query a",
                "rank_absolute": 2,
                "first_seen_order": 2,
            },
        ]
        candidates = prospecting.aggregate_video_candidates(rows)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["google_best_rank_absolute"], 2)
        self.assertEqual(candidates[0]["matched_query_count"], 2)
        self.assertEqual(
            candidates[0]["query_ranks"],
            "query a: 2 | query b: 5",
        )

    def test_video_info_enrichment_keeps_video_and_channel_metrics_separate(self) -> None:
        candidate = {
            "video_id": "abcdefghijk",
            "canonical_video_url": (
                "https://www.youtube.com/watch?v=abcdefghijk"
            ),
            "serp_title": "SERP title",
            "google_best_rank_absolute": 4,
            "google_serp_occurrences": 2,
            "matched_query_count": 2,
            "matched_queries": "a | b",
            "query_ranks": "a: 4 | b: 8",
            "google_result_languages": "Vietnamese",
            "first_seen_order": 1,
        }
        response = {
            "tasks": [
                {
                    "status_code": 20000,
                    "result": [
                        {
                            "items": [
                                {
                                    "type": "youtube_video_info",
                                    "title": "Canonical title",
                                    "url": candidate["canonical_video_url"],
                                    "views_count": 1000,
                                    "likes_count": 50,
                                    "comments_count": 10,
                                    "subtitles": [
                                        {
                                            "language": "Vietnamese",
                                            "is_auto_generated": True,
                                        }
                                    ],
                                    "is_live": False,
                                    "channel_id": "UC123",
                                    "channel_name": "Creator",
                                    "channel_url": (
                                        "https://www.youtube.com/channel/UC123"
                                    ),
                                    "channel_subscribers_count": {
                                        "displayed_count": "12K",
                                        "count": 12000,
                                    },
                                }
                            ]
                        }
                    ],
                }
            ]
        }
        row = prospecting.enrich_video_candidate(
            candidate,
            response,
            location_code=2704,
            language_code="vi",
        )
        self.assertEqual(row["video_views"], 1000)
        self.assertEqual(row["channel_subscribers"], 12000)
        self.assertEqual(row["google_best_rank_absolute"], 4)
        self.assertEqual(row["video_language_status"], "vietnamese_spoken_signal")

    def test_video_info_enrichment_tolerates_unexpected_optional_shapes(self) -> None:
        candidate = {
            "video_id": "abcdefghijk",
            "canonical_video_url": (
                "https://www.youtube.com/watch?v=abcdefghijk"
            ),
            "serp_title": "SERP title",
        }
        response = {
            "tasks": [
                {
                    "status_code": 20000,
                    "result": [
                        {
                            "items": [
                                {
                                    "keywords": "not-a-list",
                                    "channel_subscribers_count": 12000,
                                }
                            ]
                        }
                    ],
                }
            ]
        }
        row = prospecting.enrich_video_candidate(
            candidate,
            response,
            location_code=2704,
            language_code="vi",
        )
        self.assertEqual(row["video_tags"], "")
        self.assertEqual(row["channel_subscribers"], 0)

    def test_auditor_queue_sorts_by_channel_rank_then_views_and_keeps_no_email(
        self,
    ) -> None:
        channels = [
            {
                "channel_id": "UCHIGH",
                "channel_name": "High Subs",
                "channel_url": "https://www.youtube.com/channel/UCHIGH",
                "channel_subscribers": 5000,
                "channel_total_views": 90000,
                "public_video_count": 40,
                "public_email_count": 2,
                "public_emails": "first@example.com | second@example.com",
                "language_qualification": "vietnamese_spoken_signal",
            },
            {
                "channel_id": "UCLOW",
                "channel_name": "Low Subs",
                "channel_url": "https://www.youtube.com/channel/UCLOW",
                "channel_subscribers": 100,
                "public_email_count": 0,
                "public_emails": "",
                "language_qualification": "language_review",
            },
        ]
        videos = [
            {
                "video_id": "lowviews001",
                "enrichment_status": "qualified",
                "channel_id": "UCHIGH",
                "title": "Rank one lower views",
                "canonical_video_url": (
                    "https://www.youtube.com/watch?v=lowviews001"
                ),
                "video_views": 100,
                "google_best_rank_absolute": 1,
            },
            {
                "video_id": "rankthree01",
                "enrichment_status": "qualified",
                "channel_id": "UCHIGH",
                "title": "Rank three higher views",
                "canonical_video_url": (
                    "https://www.youtube.com/watch?v=rankthree01"
                ),
                "video_views": 50000,
                "google_best_rank_absolute": 3,
            },
            {
                "video_id": "highviews01",
                "enrichment_status": "qualified",
                "channel_id": "UCHIGH",
                "title": "Rank one higher views",
                "canonical_video_url": (
                    "https://www.youtube.com/watch?v=highviews01"
                ),
                "video_views": 200,
                "google_best_rank_absolute": 1,
            },
            {
                "video_id": "lowsubvideo",
                "enrichment_status": "qualified",
                "channel_id": "UCLOW",
                "title": "Lower subscriber channel",
                "canonical_video_url": (
                    "https://www.youtube.com/watch?v=lowsubvideo"
                ),
                "video_views": 900000,
                "google_best_rank_absolute": 1,
            },
        ]

        rows = prospecting.build_auditor_video_queue(
            channels=channels,
            videos=videos,
        )

        self.assertEqual(
            [row["video_id"] for row in rows],
            ["highviews01", "lowviews001", "rankthree01", "lowsubvideo"],
        )
        self.assertEqual(
            [row["video_priority_within_channel"] for row in rows],
            [1, 2, 3, 1],
        )
        self.assertEqual(rows[0]["recipient_email"], "first@example.com")
        self.assertEqual(rows[0]["additional_public_emails"], "second@example.com")
        self.assertEqual(rows[-1]["recipient_email"], "")

    def test_channel_about_parser_extracts_stats_and_links(self) -> None:
        html = r'''
        <script>
        var ytInitialData = {
          "contents": {
            "aboutChannelViewModel": {
              "description": "Instagram duplicate: https://instagram.com/creator/ and more at https://example.com/about. Email team@example.com and TEAM@example.com.",
              "viewCountText": "803,066,418 views",
              "joinedDateText": {"content": "Joined Mar 27, 2012"},
              "videoCountText": "1,795 videos",
              "links": [
                {
                  "channelExternalLinkViewModel": {
                    "title": {"content": "Instagram"},
                    "link": {
                      "commandRuns": [
                        {
                          "onTap": {
                            "innertubeCommand": {
                              "commandMetadata": {
                                "webCommandMetadata": {
                                  "url": "https://www.youtube.com/redirect?event=channel_description&q=https%3A%2F%2Finstagram.com%2Fcreator"
                                }
                              }
                            }
                          }
                        }
                      ]
                    }
                  }
                },
                {
                  "channelExternalLinkViewModel": {
                    "title": {"content": "Business email"},
                    "link": {
                      "commandRuns": [
                        {
                          "onTap": {
                            "innertubeCommand": {
                              "commandMetadata": {
                                "webCommandMetadata": {
                                  "url": "mailto:partner@example.org"
                                }
                              }
                            }
                          }
                        }
                      ]
                    }
                  }
                }
              ]
            }
          }
        };
        </script>
        '''
        channel, links = prospecting.parse_channel_about_html(
            html,
            channel_id="UC123",
            channel_name="Creator",
            channel_url="https://www.youtube.com/channel/UC123",
        )
        self.assertEqual(channel["public_video_count"], 1795)
        self.assertEqual(channel["channel_total_views"], 803066418)
        self.assertEqual(channel["joined_date"], "2012-03-27")
        self.assertEqual(channel["instagram"], "https://instagram.com/creator")
        self.assertEqual(channel["public_email_count"], 2)
        self.assertEqual(
            channel["public_emails"],
            "partner@example.org | team@example.com",
        )
        self.assertEqual(len(links), 4)
        self.assertEqual(
            {link["source"] for link in links},
            {"published_link", "channel_description"},
        )
        self.assertEqual(
            [link["url"] for link in links if link["link_type"] == "email"],
            ["partner@example.org", "team@example.com"],
        )

    def test_collect_orchestrates_deduplication_and_outputs_without_live_api(
        self,
    ) -> None:
        target_url = "https://www.canva.com/vi_vn/thiet-ke/video/"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            queries_path = root / "queries.csv"
            queries = [
                {
                    "query": f"truy vấn {index}",
                    "angle": "tutorial",
                    "relationship": "direct",
                    "rationale": "Relevant to the Canva feature.",
                }
                for index in range(5)
            ]
            prospecting.write_csv(
                queries_path,
                queries,
                prospecting.QUERY_COLUMNS,
            )
            config_path = root / "config.yaml"
            config = prospecting.read_yaml(prospecting.DEFAULT_CONFIG)
            config_path.write_text(
                prospecting.yaml.safe_dump(config, sort_keys=False),
                encoding="utf-8",
            )

            serp_response = {
                "cost": 0.002,
                "tasks": [
                    {
                        "status_code": 20000,
                        "result": [
                            {
                                "items": [
                                    {
                                        "type": "organic",
                                        "rank_absolute": 1,
                                        "rank_group": 1,
                                        "url": (
                                            "https://www.youtube.com/"
                                            "watch?v=abcdefghijk"
                                        ),
                                        "title": "SERP title",
                                    }
                                ]
                            }
                        ],
                    }
                ],
            }
            video_response = {
                "cost": 0.001,
                "tasks": [
                    {
                        "status_code": 20000,
                        "result": [
                            {
                                "items": [
                                    {
                                        "title": "Canonical title",
                                        "url": (
                                            "https://www.youtube.com/"
                                            "watch?v=abcdefghijk"
                                        ),
                                        "views_count": 1000,
                                        "likes_count": 50,
                                        "comments_count": 10,
                                        "is_live": False,
                                        "channel_id": "UC123",
                                        "channel_name": "Creator",
                                        "channel_url": (
                                            "https://www.youtube.com/"
                                            "channel/UC123"
                                        ),
                                        "channel_subscribers_count": {
                                            "displayed_count": "12K",
                                            "count": 12000,
                                        },
                                    }
                                ]
                            }
                        ],
                    }
                ],
            }

            class FakeClient:
                calls: list[tuple[str, int]] = []

                def post_each(
                    self,
                    path: str,
                    payloads: list[list[dict[str, object]]],
                    *,
                    concurrency: int,
                ) -> list[dict[str, object]]:
                    self.calls.append((path, len(payloads)))
                    if "google/organic" in path:
                        return [serp_response for _ in payloads]
                    return [video_response for _ in payloads]

            def fake_channel_enrichment(
                channels: list[dict[str, object]],
                config: dict[str, object],
            ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
                self.assertEqual(len(channels), 1)
                channel = {
                    **channels[0],
                    "public_video_count": 320,
                    "channel_total_views": 4200000,
                    "joined_date": "2018-03-14",
                    "instagram": "https://instagram.com/creator",
                    "channel_about_status": "success",
                    "channel_links_status": "success",
                }
                link = {
                    "channel_id": "UC123",
                    "channel_name": "Creator",
                    "channel_url": (
                        "https://www.youtube.com/channel/UC123"
                    ),
                    "link_type": "instagram",
                    "label": "Instagram",
                    "url": "https://instagram.com/creator",
                    "source": "published_link",
                }
                return [channel], [link]

            args = argparse.Namespace(
                target_url=target_url,
                queries=queries_path,
                config=config_path,
            )
            with (
                patch.object(prospecting, "REPO_ROOT", root),
                patch.object(
                    prospecting,
                    "DataForSEOClient",
                    return_value=FakeClient(),
                ),
                patch.object(
                    prospecting,
                    "enrich_channels",
                    side_effect=fake_channel_enrichment,
                ),
            ):
                self.assertEqual(prospecting.run_collect(args), 0)

            self.assertEqual(
                FakeClient.calls,
                [
                    ("/v3/serp/google/organic/live/advanced", 5),
                    ("/v3/serp/youtube/video_info/live/advanced", 1),
                ],
            )
            out_dir = (
                root
                / "work"
                / "youtube-prospecting"
                / "vi_vn"
                / "thiet-ke"
                / "video"
            )
            summary = json.loads(
                (out_dir / "run-summary.json").read_text(encoding="utf-8")
            )
            self.assertEqual(summary["unique_standard_videos"], 1)
            self.assertEqual(summary["unique_channels"], 1)
            self.assertEqual(summary["dataforseo_total_cost_usd"], 0.011)
            videos = prospecting.read_csv(out_dir / "ranking-videos.csv")
            channels = prospecting.read_csv(out_dir / "channel-prospects.csv")
            auditor_rows = prospecting.read_csv(out_dir / "auditor-video-queue.csv")
            self.assertEqual(len(videos), 1)
            self.assertEqual(len(channels), 1)
            self.assertEqual(len(auditor_rows), 1)
            self.assertEqual(videos[0]["video_views"], "1000")
            self.assertEqual(channels[0]["channel_subscribers"], "12000")
            self.assertEqual(auditor_rows[0]["video_title"], "Canonical title")
            self.assertEqual(auditor_rows[0]["recipient_email"], "")
            self.assertEqual(
                (out_dir / "ranking-videos.csv").read_bytes()[:3],
                b"\xef\xbb\xbf",
            )
            self.assertEqual(
                (out_dir / "auditor-video-queue.csv").read_bytes()[:3],
                b"\xef\xbb\xbf",
            )
            self.assertIn(
                "- Status: data collected at ",
                (out_dir / "readme.md").read_text(encoding="utf-8"),
            )

    def test_refresh_about_reuses_existing_data_without_dataforseo(self) -> None:
        target_url = "https://www.canva.com/vi_vn/thiet-ke/video/"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out_dir = (
                root
                / "work"
                / "youtube-prospecting"
                / "vi_vn"
                / "thiet-ke"
                / "video"
            )
            out_dir.mkdir(parents=True)
            (out_dir / "readme.md").write_text(
                "# YouTube Prospecting\n\n- Status: collected\n",
                encoding="utf-8",
            )
            prospecting.write_csv(
                out_dir / "ranking-videos.csv",
                [
                    {
                        "video_id": "abcdefghijk",
                        "canonical_video_url": (
                            "https://www.youtube.com/watch?v=abcdefghijk"
                        ),
                        "enrichment_status": "qualified",
                        "channel_id": "UC123",
                        "channel_name": "Creator",
                        "channel_url": "https://www.youtube.com/channel/UC123",
                        "channel_subscribers": 12000,
                        "google_best_rank_absolute": 1,
                        "matched_queries": "ghép file PDF",
                        "video_language_status": "vietnamese_spoken_signal",
                    }
                ],
                prospecting.VIDEO_COLUMNS,
            )
            prospecting.write_csv(
                out_dir / "raw-serp-results.csv",
                [],
                prospecting.RAW_SERP_COLUMNS,
            )
            prospecting.write_json(
                out_dir / "run-summary.json",
                {
                    "target_url": target_url,
                    "dataforseo_total_cost_usd": 1.25,
                },
            )

            def fake_channel_enrichment(
                channels: list[dict[str, object]],
                config: dict[str, object],
            ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
                channel = {
                    **channels[0],
                    "public_email_count": 2,
                    "public_emails": "hello@example.com | team@example.com",
                    "channel_about_status": "success",
                    "channel_links_status": "success",
                }
                links = [
                    {
                        "channel_id": "UC123",
                        "channel_name": "Creator",
                        "channel_url": "https://www.youtube.com/channel/UC123",
                        "link_type": "email",
                        "label": "",
                        "url": email,
                        "source": "channel_description",
                    }
                    for email in ("hello@example.com", "team@example.com")
                ]
                return [channel], links

            args = argparse.Namespace(
                target_url=target_url,
                config=prospecting.DEFAULT_CONFIG,
            )
            with (
                patch.object(prospecting, "REPO_ROOT", root),
                patch.object(
                    prospecting,
                    "enrich_channels",
                    side_effect=fake_channel_enrichment,
                ),
            ):
                self.assertEqual(prospecting.run_refresh_about(args), 0)

            summary = json.loads(
                (out_dir / "run-summary.json").read_text(encoding="utf-8")
            )
            self.assertEqual(summary["dataforseo_total_cost_usd"], 1.25)
            self.assertEqual(summary["channels_with_public_emails"], 1)
            self.assertEqual(summary["public_email_count"], 2)
            channels = prospecting.read_csv(out_dir / "channel-prospects.csv")
            self.assertEqual(
                channels[0]["public_emails"],
                "hello@example.com | team@example.com",
            )
            auditor_rows = prospecting.read_csv(out_dir / "auditor-video-queue.csv")
            self.assertEqual(auditor_rows[0]["recipient_email"], "hello@example.com")
            self.assertEqual(
                auditor_rows[0]["additional_public_emails"],
                "team@example.com",
            )


if __name__ == "__main__":
    unittest.main()
