import unittest
from compare_revision_links import compare, extract_links, publishable


def p(text, links=None, style="NORMAL_TEXT"):
    return {"text": text, "style": style, "links": links or []}


def link(text, start, end, url="https://www.canva.com/vi_vn/tai-lieu/"):
    return {"text": text, "startIndex": start, "endIndex": end, "style": {"link": {"url": url}}}


def snapshot(*ps):
    return {"paragraphs": [p("Final page copy", style="HEADING_1"), *ps,
                           p("Links added for review", style="HEADING_2"),
                           p("Footer", [link("Footer", 100, 106)])]}


class RevisionEvidenceTests(unittest.TestCase):
    def test_split_runs_and_whitespace_do_not_create_false_removals(self):
        before = snapshot(p("tài liệu", [link(" ", 0, 1), link("tài ", 1, 5), link("liệu", 5, 9)]))
        after = snapshot(p("tài liệu", [link("tài liệu", 1, 9)]))
        auto = [{"anchor": "tài liệu", "target_url": "https://www.canva.com/vi_vn/tai-lieu/"}]
        result = compare(before, after, auto)
        self.assertEqual(result["removed_links"], [])
        self.assertEqual(len(result["current_links"]), 1)
        self.assertEqual(result["current_links"][0]["evidence_label"], "retained_automatic")

    def test_retarget_and_move(self):
        old_url = "https://www.canva.com/vi_vn/thiet-ke/documents/"
        before = snapshot(p("tài liệu", [link("tài liệu", 1, 9, old_url)]), p("tài liệu mới"))
        after = snapshot(p("tài liệu"), p("tài liệu mới", [link("tài liệu", 20, 28)]))
        result = compare(before, after, [])
        self.assertEqual(result["current_links"][0]["change"], "retargeted")
        self.assertTrue(result["removed_links"][0]["removal_confirmed"])
        same_target = snapshot(p("tài liệu"), p("tài liệu mới", [link("tài liệu", 20, 28, old_url)]))
        self.assertEqual(compare(before, same_target, [])["removed_links"], [])

    def test_copy_deletion_is_not_negative_preference(self):
        result = compare(snapshot(p("tài liệu", [link("tài liệu", 1, 9)])), snapshot(p("Rewritten")), [])
        self.assertFalse(result["removed_links"][0]["removal_confirmed"])

    def test_accents_are_not_authorship_equivalents(self):
        result = compare(snapshot(p("phong", [link("phong", 1, 6)])), snapshot(p("phông", [link("phông", 1, 6)])), [])
        self.assertEqual(result["current_links"][0]["evidence_label"], "reviewer_added")

    def test_noncontiguous_repeated_anchor_stays_separate(self):
        self.assertEqual(len(extract_links([p("tài liệu và tài liệu", [link("tài liệu", 1, 9), link("tài liệu", 13, 21)])])), 2)

    def test_ambiguous_footer_fails_closed(self):
        with self.assertRaises(ValueError):
            publishable(snapshot(p("Links added for review", style="HEADING_2")))
        with self.assertRaises(ValueError):
            publishable({"paragraphs": [p("Final page copy"), p("Links added for review", style="HEADING_2"), p("More body", style="HEADING_2")]})


if __name__ == "__main__":
    unittest.main()
