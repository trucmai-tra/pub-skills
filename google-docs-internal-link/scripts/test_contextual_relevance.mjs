import assert from "node:assert/strict";

import {
  isHardSkipAnchorTargetPair,
  isHardSkipCandidate,
  scoreContextualCandidate,
} from "./contextual_relevance.mjs";

const source = {
  pageUrl: "https://www.canva.com/vi_vn/thiet-ke/cv-xin-viec-resume/",
  mainKeywords: ["CV xin việc"],
};

const wrongHistory = scoreContextualCandidate(
  {
    visible_anchor: "lịch sử",
    sentence: "Người đã đi làm nên ưu tiên lịch sử nghề nghiệp.",
    paragraph: "Người đã đi làm nên ưu tiên lịch sử nghề nghiệp và kết quả liên quan.",
    anchor: {
      url: "https://www.canva.com/vi_vn/mau/s/lich-su/",
      title: "Lịch sử",
      target_main_keywords: ["mẫu lịch sử"],
      anchor_text: "lịch sử",
      source: "learned",
      role: "Learned",
      positive_count: 2,
    },
  },
  source,
);
assert.equal(wrongHistory.decision, "reject");
assert.equal(wrongHistory.penalties.includes("ambiguous_repeated_pair_without_sentence_support"), true);

const employmentHistory = scoreContextualCandidate(
  {
    visible_anchor: "lịch sử",
    sentence: "Người đã đi làm nên ưu tiên lịch sử nghề nghiệp.",
    paragraph: "Người đã đi làm nên ưu tiên lịch sử nghề nghiệp và kết quả liên quan.",
    anchor: {
      url: "https://www.canva.com/vi_vn/so-yeu-ly-lich/lich-su-nghe-nghiep/",
      title: "Lịch sử nghề nghiệp",
      target_main_keywords: ["lịch sử nghề nghiệp"],
      anchor_text: "lịch sử",
      source: "keyword",
      role: "Supporting",
      positive_count: 0,
    },
  },
  source,
);
assert.equal(employmentHistory.decision, "accept");
assert.deepEqual(employmentHistory.metrics.sentence_target_tokens, ["nghe", "nghiep"]);

const repeatedWebsite = scoreContextualCandidate(
  {
    visible_anchor: "website",
    sentence: "Bạn có thể sử dụng logo trên website.",
    paragraph: "Bạn có thể sử dụng logo trên website và bao bì.",
    anchor: {
      url: "https://www.canva.com/vi_vn/tao-website/",
      title: "Tạo website",
      target_main_keywords: ["cách tạo website"],
      anchor_text: "website",
      source: "learned",
      role: "Learned",
      positive_count: 2,
    },
  },
  { pageUrl: "https://www.canva.com/vi_vn/thiet-ke/logo/", mainKeywords: ["logo"] },
);
assert.equal(repeatedWebsite.decision, "accept");
assert.equal(repeatedWebsite.signals.includes("repeated_manual_pair"), true);

const wrongShortener = scoreContextualCandidate(
  {
    visible_anchor: "rút gọn",
    sentence: "Đọc lại từ đầu đến cuối và rút gọn đoạn chữ dài.",
    paragraph: "Đọc lại từ đầu đến cuối và rút gọn đoạn chữ dài trước khi xuất file.",
    anchor: {
      url: "https://www.canva.com/vi_vn/tinh-nang/rut-gon-link/",
      title: "Rút gọn link",
      target_main_keywords: ["rút gọn link"],
      anchor_text: "rút gọn",
      source: "keyword",
      role: "Supporting",
      positive_count: 0,
    },
  },
  { pageUrl: "https://www.canva.com/vi_vn/thiet-ke/logo/", mainKeywords: ["logo"] },
);
assert.equal(wrongShortener.decision, "reject");

const sourceTopicRepeat = scoreContextualCandidate(
  {
    visible_anchor: "tạo CV",
    sentence: "Bạn có thể tạo CV trực tuyến từ mẫu.",
    paragraph: "Bạn có thể tạo CV trực tuyến từ mẫu.",
    anchor: {
      url: "https://www.canva.com/vi_vn/so-yeu-ly-lich-ai/",
      title: "Tạo CV bằng AI",
      target_main_keywords: ["tạo CV"],
      anchor_text: "tạo CV",
      source: "keyword",
      role: "Main",
      positive_count: 0,
    },
  },
  source,
);
assert.equal(sourceTopicRepeat.decision, "review");
assert.equal(sourceTopicRepeat.penalties.includes("anchor_repeats_source_topic"), true);

const sourceTopicWithGenericModifier = scoreContextualCandidate(
  {
    visible_anchor: "tạo CV online",
    sentence: "Bạn có thể tạo CV online từ mẫu.",
    paragraph: "Bạn có thể tạo CV online từ mẫu.",
    anchor: {
      url: "https://www.canva.com/vi_vn/thiet-ke/cv/",
      title: "Sơ yếu lý lịch",
      page_type: "create",
      page_type_label: "Create",
      target_main_keywords: ["tạo CV"],
      anchor_text: "tạo CV online",
      source: "keyword",
      role: "Supporting",
      positive_count: 0,
    },
  },
  source,
);
assert.equal(sourceTopicWithGenericModifier.decision, "review");
assert.equal(sourceTopicWithGenericModifier.penalties.includes("anchor_repeats_source_topic"), true);

const repeatedSourceTopic = scoreContextualCandidate(
  {
    visible_anchor: "ảnh ghép",
    sentence: "Hai ảnh được sắp xếp thành ảnh ghép dọc.",
    paragraph: "Hai ảnh được sắp xếp thành ảnh ghép dọc.",
    anchor: {
      url: "https://www.canva.com/vi_vn/ghep-anh/",
      title: "Ghép ảnh",
      target_main_keywords: ["ghép ảnh"],
      anchor_text: "ảnh ghép",
      source: "learned",
      role: "Learned",
      positive_count: 3,
    },
  },
  { pageUrl: "https://www.canva.com/vi_vn/thiet-ke/ghep-anh/", mainKeywords: ["ghép ảnh"] },
);
assert.equal(repeatedSourceTopic.decision, "review");
assert.equal(repeatedSourceTopic.penalties.includes("anchor_repeats_source_topic"), true);

const templateToCreate = scoreContextualCandidate({
  visible_anchor: "mẫu CV xin việc",
  sentence: "Chọn một mẫu CV xin việc phù hợp.",
  paragraph: "Chọn một mẫu CV xin việc phù hợp.",
  anchor: {
    url: "https://www.canva.com/vi_vn/thiet-ke/cv/",
    title: "Sơ yếu lý lịch",
    page_type: "create",
    page_type_label: "Create",
    target_main_keywords: ["tạo CV"],
    anchor_text: "mẫu CV xin việc",
    source: "keyword",
    role: "Supporting",
  },
});
assert.equal(templateToCreate.decision, "reject");
assert.equal(templateToCreate.penalties.includes("page_type_intent_mismatch"), true);

const templateToTemplate = scoreContextualCandidate({
  visible_anchor: "mẫu CV xin việc",
  sentence: "Chọn một mẫu CV xin việc phù hợp.",
  paragraph: "Chọn một mẫu CV xin việc phù hợp.",
  anchor: {
    url: "https://www.canva.com/vi_vn/so-yeu-ly-lich/mau/cv-phong-cach-don-gian/",
    title: "CV phong cách đơn giản",
    page_type: "templates_category",
    page_type_label: "Template Subcategory",
    target_main_keywords: ["mẫu CV xin việc đơn giản"],
    anchor_text: "mẫu CV xin việc",
    source: "keyword",
    role: "Supporting",
  },
});
assert.equal(templateToTemplate.decision, "accept");
assert.equal(templateToTemplate.signals.includes("template_anchor_matches_template_page"), true);

const createToTemplate = scoreContextualCandidate({
  visible_anchor: "tạo CV",
  sentence: "Bạn có thể tạo CV online.",
  paragraph: "Bạn có thể tạo CV online.",
  anchor: {
    url: "https://www.canva.com/vi_vn/so-yeu-ly-lich/mau/cv-phong-cach-don-gian/",
    title: "CV phong cách đơn giản",
    page_type: "templates_category",
    page_type_label: "Template Subcategory",
    target_main_keywords: ["mẫu CV xin việc đơn giản"],
    anchor_text: "tạo CV",
    source: "keyword",
    role: "Supporting",
  },
});
assert.equal(createToTemplate.decision, "reject");
assert.equal(createToTemplate.penalties.includes("page_type_intent_mismatch"), true);

const designToCreate = scoreContextualCandidate({
  visible_anchor: "thiết kế logo",
  sentence: "Bắt đầu thiết kế logo cho thương hiệu.",
  paragraph: "Bắt đầu thiết kế logo cho thương hiệu.",
  anchor: {
    url: "https://www.canva.com/vi_vn/thiet-ke/logo/",
    title: "Thiết kế logo",
    page_type: "create",
    page_type_label: "Create",
    target_main_keywords: ["thiết kế logo"],
    anchor_text: "thiết kế logo",
    source: "keyword",
    role: "Main",
  },
});
assert.equal(designToCreate.decision, "accept");
assert.equal(designToCreate.signals.includes("create_anchor_matches_create_page"), true);

const hardSkipSentence = "Cách viết CV xin việc hiệu quả bắt đầu từ dữ kiện thật.";
const hardSkipExact = scoreContextualCandidate({
  visible_anchor: "viết CV xin việc",
  sentence: hardSkipSentence,
  paragraph: hardSkipSentence,
  start: 5,
  end: 21,
  anchor: {
    url: "https://www.canva.com/vi_vn/thiet-ke/cv/",
    title: "Tạo CV",
    page_type: "create",
    page_type_label: "Create",
    target_main_keywords: ["viết CV xin việc"],
    anchor_text: "viết CV xin việc",
    source: "explicit",
    role: "Explicit",
  },
});
assert.equal(hardSkipExact.decision, "reject");
assert.equal(hardSkipExact.penalties.includes("hard_skip_anchor"), true);

assert.equal(isHardSkipCandidate({
  visible_anchor: "viết CV",
  paragraph: hardSkipSentence,
  start: 5,
  end: 12,
}), true);
assert.equal(isHardSkipCandidate({
  visible_anchor: "viết CV",
  paragraph: "Bạn có thể viết CV rõ ràng và súc tích.",
  start: 11,
  end: 18,
}), false);

const blockedThumbnailTarget = "https://www.canva.com/vi_vn/hinh-anh-dep-tren-mang-xa-hoi/mau/thumbnail-youtube/";
const blockedThumbnail = scoreContextualCandidate({
  visible_anchor: "hình thu nhỏ",
  sentence: "Xem các hình thu nhỏ để kiểm tra mạch kể.",
  paragraph: "Xem các hình thu nhỏ để kiểm tra mạch kể.",
  anchor: {
    url: blockedThumbnailTarget,
    title: "Thumbnail YouTube",
    page_type: "templates_search",
    page_type_label: "Template Search",
    target_main_keywords: ["thumbnail YouTube"],
    anchor_text: "hình thu nhỏ",
    source: "explicit",
    role: "Explicit",
  },
});
assert.equal(blockedThumbnail.decision, "reject");
assert.equal(blockedThumbnail.penalties.includes("user_blocked_anchor_target"), true);
assert.equal(isHardSkipAnchorTargetPair({
  visible_anchor: "hình thu nhỏ",
  target_url: `${blockedThumbnailTarget}?ref=test#section`,
}), true);
assert.equal(isHardSkipAnchorTargetPair({
  visible_anchor: "hình thu nhỏ",
  target_url: "https://www.canva.com/vi_vn/mau/thumbnail-khac/",
}), false);
assert.equal(isHardSkipAnchorTargetPair({
  visible_anchor: "thang",
  target_url: "https://www.canva.com/vi_vn/giao-an/mau/thang/?ref=test#section",
}), true);

const genericDesignAppTarget = "https://www.canva.com/vi_vn/thiet-ke/app/";
const blockedGenericDesignApp = scoreContextualCandidate({
  visible_anchor: "thiết kế",
  sentence: "Canva hỗ trợ tiếp tục thiết kế trên điện thoại, máy tính bảng và máy tính.",
  paragraph: "Canva hỗ trợ tiếp tục thiết kế trên điện thoại, máy tính bảng và máy tính.",
  anchor: {
    url: genericDesignAppTarget,
    title: "Thiết kế App",
    page_type: "create",
    page_type_label: "Create",
    target_main_keywords: ["thiết kế giao diện app"],
    anchor_text: "thiết kế",
    source: "keyword",
    role: "Supporting",
  },
});
assert.equal(blockedGenericDesignApp.decision, "reject");
assert.equal(blockedGenericDesignApp.penalties.includes("user_blocked_anchor_target"), true);
assert.equal(isHardSkipAnchorTargetPair({
  visible_anchor: "thiết kế",
  target_url: `${genericDesignAppTarget}?ref=test#section`,
}), true);
assert.equal(isHardSkipAnchorTargetPair({
  visible_anchor: "thiết kế app",
  target_url: genericDesignAppTarget,
}), false);

console.log("google-docs-internal-link contextual relevance tests passed");
