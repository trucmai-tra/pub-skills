import assert from "node:assert/strict";
import { buildFeedbackBlocks, buildImportRows, normalizeRuntimeData } from "../lib/data.mjs";
import { linkText, suggestCandidates } from "../lib/linker.mjs";

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const plainResult = await linkText(
  [
    "Chiếc logo công ty sẽ xuất hiện trên danh thiếp, poster và fanpage.",
    "",
    "## Đồng bộ thương hiệu",
    "",
    "Bạn có thể dùng cùng bộ nhận diện thương hiệu cho mọi điểm chạm.",
  ].join("\n"),
  {
    format: "plain",
    pageUrl: "https://www.canva.com/vi_vn/logo/mau/cong-ty/",
    mainKeywords: ["logo công ty"],
    maxLinks: 4,
  },
);

assert.equal(plainResult.ok, true);
assert.match(plainResult.html, /<a href="https:\/\/www\.canva\.com\/vi_vn\/danh-thiep\/mau\/">danh thiếp<\/a>/);
assert.equal(plainResult.addedLinks.length > 0, true);
assert.equal(
  plainResult.links.some((link) => link.url === "https://www.canva.com/vi_vn/logo/mau/cong-ty/"),
  false,
);

const htmlResult = await linkText(
  '<p>Dùng <a href="https://www.canva.com/vi_vn/danh-thiep/mau/">danh thiếp</a> cùng poster cho bộ nhận diện.</p>',
  {
    format: "html",
    pageUrl: "https://www.canva.com/vi_vn/logo/mau/cong-ty/",
    mainKeywords: ["logo công ty"],
    maxLinks: 3,
  },
);

assert.equal(htmlResult.preservedLinks.length, 1);
assert.equal(
  htmlResult.links.filter((link) => link.url === "https://www.canva.com/vi_vn/danh-thiep/mau/").length,
  1,
);

const suggestResult = await suggestCandidates({
  query: "danh thiep",
  anchor: "danh thiếp",
  pageUrl: "https://www.canva.com/vi_vn/logo/mau/cong-ty/",
  limit: 5,
});

assert.equal(suggestResult.ok, true);
assert.equal(suggestResult.candidates.length > 0, true);
assert.equal(suggestResult.candidates[0].url, "https://www.canva.com/vi_vn/danh-thiep/mau/");
assert.equal(suggestResult.candidates[0].match.exact_anchor, true);

const retiredTargetUrl = "https://www.canva.com/vi_vn/mau/s/powerpoint/";
const retiredData = normalizeRuntimeData({
  candidatePayload: {
    generated_at: "2026-09-04T00:00:00.000Z",
    candidates: [{
      url: retiredTargetUrl,
      title: "Retired target",
      page_type: "templates_search",
      page_type_label: "Template Search",
      anchors: [{ text: "mẫu PowerPoint", source: "keyword", role: "Main" }],
    }],
  },
  feedback: [],
  source: "test",
});
assert.equal(retiredData.candidates.length, 0);
assert.equal(buildImportRows(retiredData.candidatePayload, []).candidateRows.length, 0);

const fixtureCandidatePayload = {
  generated_at: "2026-07-08T00:00:00.000Z",
  candidates: [
    {
      url: "https://www.canva.com/vi_vn/a/",
      title: "Mau poster A",
      page_type: "templates_category",
      page_type_label: "Templates",
      ytd_logged_out_sessions: 10000,
      is_scope: false,
      has_keyword_data: false,
      anchors: [{ text: "mẫu poster", normalized: "mau poster", source: "fallback", role: "Fallback" }],
    },
    {
      url: "https://www.canva.com/vi_vn/b/",
      title: "Mau poster B",
      page_type: "templates_category",
      page_type_label: "Templates",
      ytd_logged_out_sessions: 1,
      is_scope: false,
      has_keyword_data: false,
      anchors: [{ text: "mẫu poster", normalized: "mau poster", source: "fallback", role: "Fallback" }],
    },
  ],
};

const boostedData = normalizeRuntimeData({
  candidatePayload: fixtureCandidatePayload,
  feedback: [
    {
      action: "added",
      target_url: "https://www.canva.com/vi_vn/b/",
      anchor: "mẫu poster",
      page_url: "https://www.canva.com/vi_vn/source-1/",
      at: "2026-07-08T00:00:00.000Z",
    },
  ],
  source: "test",
});

const boostedSuggest = await suggestCandidates({
  query: "mau poster",
  anchor: "mẫu poster",
  limit: 2,
  data: boostedData,
});

assert.equal(boostedSuggest.candidates[0].url, "https://www.canva.com/vi_vn/b/");
assert.equal(boostedSuggest.candidates[0].match.positive_feedback, 1);

const learnedOnceData = normalizeRuntimeData({
  candidatePayload: {
    generated_at: "2026-07-08T00:00:00.000Z",
    candidates: [
      {
        url: "https://www.canva.com/vi_vn/learned/",
        title: "Learned target",
        page_type: "create",
        page_type_label: "Create",
        ytd_logged_out_sessions: 0,
        is_scope: false,
        has_keyword_data: false,
        anchors: [],
      },
    ],
  },
  feedback: [
    {
      action: "added",
      target_url: "https://www.canva.com/vi_vn/learned/",
      anchor: "thử nghiệm",
      page_url: "https://www.canva.com/vi_vn/source-1/",
      at: "2026-07-08T00:00:00.000Z",
    },
  ],
  source: "test",
});

const learnedOnce = await linkText("Đây là thử nghiệm phù hợp.", {
  format: "plain",
  data: learnedOnceData,
});

assert.equal(learnedOnce.addedLinks.length, 0);

const learnedTwiceData = normalizeRuntimeData({
  candidatePayload: learnedOnceData.candidatePayload,
  feedback: [
    {
      action: "added",
      target_url: "https://www.canva.com/vi_vn/learned/",
      anchor: "thử nghiệm",
      page_url: "https://www.canva.com/vi_vn/source-1/",
      at: "2026-07-08T00:00:00.000Z",
    },
    {
      action: "added",
      target_url: "https://www.canva.com/vi_vn/learned/",
      anchor: "thử nghiệm",
      page_url: "https://www.canva.com/vi_vn/source-2/",
      at: "2026-07-08T00:01:00.000Z",
    },
  ],
  source: "test",
});

const learnedTwice = await linkText("Đây là thử nghiệm phù hợp.", {
  format: "plain",
  data: learnedTwiceData,
});

assert.equal(learnedTwice.addedLinks.length, 1);
assert.equal(learnedTwice.addedLinks[0].anchor_source, "learned");

const shortLearnedTarget = "https://www.canva.com/vi_vn/tinh-nang/phong-chu-mien-phi/";
const shortLearnedCandidatePayload = {
  generated_at: "2026-09-07T00:00:00.000Z",
  candidates: [
    {
      url: shortLearnedTarget,
      title: "Phông chữ miễn phí",
      page_type: "features",
      page_type_label: "Feature",
      ytd_logged_out_sessions: 0,
      is_scope: false,
      has_keyword_data: false,
      anchors: [],
    },
  ],
};
const shortLearnedOnceData = normalizeRuntimeData({
  candidatePayload: shortLearnedCandidatePayload,
  feedback: [
    {
      action: "added",
      target_url: shortLearnedTarget,
      anchor: "font",
      page_url: "https://www.canva.com/vi_vn/source-1/",
    },
  ],
  source: "test",
});
const shortLearnedOnce = await linkText("Bạn có thể đổi font cho tiêu đề.", {
  format: "plain",
  data: shortLearnedOnceData,
});
assert.equal(shortLearnedOnce.addedLinks.length, 0);

const shortLearnedTwiceData = normalizeRuntimeData({
  candidatePayload: shortLearnedCandidatePayload,
  feedback: [
    {
      action: "added",
      target_url: shortLearnedTarget,
      anchor: "font",
      page_url: "https://www.canva.com/vi_vn/source-1/",
    },
    {
      action: "added",
      target_url: shortLearnedTarget,
      anchor: "font",
      page_url: "https://www.canva.com/vi_vn/source-2/",
    },
  ],
  source: "test",
});
const shortLearnedTwice = await linkText("Bạn có thể đổi font cho tiêu đề.", {
  format: "plain",
  data: shortLearnedTwiceData,
});
assert.equal(shortLearnedTwice.addedLinks.length, 1);
assert.equal(shortLearnedTwice.addedLinks[0].anchor, "font");
assert.equal(shortLearnedTwice.addedLinks[0].anchor_source, "learned");

const blockedLearnedData = normalizeRuntimeData({
  candidatePayload: learnedOnceData.candidatePayload,
  feedback: [
    {
      action: "added",
      target_url: "https://www.canva.com/vi_vn/learned/",
      anchor: "thử nghiệm",
      page_url: "https://www.canva.com/vi_vn/source-1/",
      at: "2026-07-08T00:00:00.000Z",
    },
    {
      action: "added",
      target_url: "https://www.canva.com/vi_vn/learned/",
      anchor: "thử nghiệm",
      page_url: "https://www.canva.com/vi_vn/source-2/",
      at: "2026-07-08T00:01:00.000Z",
    },
    {
      action: "removed",
      target_url: "https://www.canva.com/vi_vn/learned/",
      anchor: "thử nghiệm",
      page_url: "https://www.canva.com/vi_vn/source-1/",
      at: "2026-07-08T00:02:00.000Z",
    },
    {
      action: "removed",
      target_url: "https://www.canva.com/vi_vn/learned/",
      anchor: "thử nghiệm",
      page_url: "https://www.canva.com/vi_vn/source-2/",
      at: "2026-07-08T00:03:00.000Z",
    },
  ],
  source: "test",
});

const blockedLearned = await linkText("Đây là thử nghiệm phù hợp.", {
  format: "plain",
  data: blockedLearnedData,
});

assert.equal(blockedLearned.addedLinks.length, 0);
assert.equal(buildFeedbackBlocks(blockedLearnedData.feedback).globalBlock.size, 1);

const importRows = buildImportRows(fixtureCandidatePayload, boostedData.feedback);
assert.equal(importRows.summary.candidates, 2);
assert.equal(importRows.anchorRows[0].normalized_anchor, "mau poster");
assert.equal(importRows.feedbackRows[0].source_event_key.length > 0, true);
assert.equal(importRows.feedbackRows[0].feedback_key.length > 0, true);

const duplicateFeedbackRows = buildImportRows(fixtureCandidatePayload, [
  {
    action: "added",
    target_url: "https://www.canva.com/vi_vn/b/",
    anchor: "mẫu poster",
    page_url: "https://www.canva.com/vi_vn/source-1/",
    at: "2026-07-08T00:00:00.000Z",
  },
  {
    action: "added",
    target_url: "https://www.canva.com/vi_vn/b/",
    anchor: "mẫu poster",
    page_url: "https://www.canva.com/vi_vn/source-1/",
    at: "2026-07-08T00:01:00.000Z",
  },
  {
    action: "added",
    target_url: "https://www.canva.com/vi_vn/b/",
    anchor: "mẫu poster",
    page_url: "https://www.canva.com/vi_vn/source-2/",
    at: "2026-07-08T00:02:00.000Z",
  },
]);

assert.equal(duplicateFeedbackRows.summary.feedback, 2);
assert.equal(new Set(duplicateFeedbackRows.feedbackRows.map((row) => row.feedback_key)).size, 2);

console.log("linker tests passed");
