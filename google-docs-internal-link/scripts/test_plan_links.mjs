import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { augmentCandidatesFromManualHistory, createPlan, validatePlan } from "./plan_links.mjs";

const candidatePayload = {
  generated_at: "2026-08-14T00:00:00Z",
  candidates: [
    {
      url: "https://www.canva.com/vi_vn/mau/s/poster/",
      title: "Mẫu poster",
      page_type: "templates_search",
      page_type_label: "Template Search",
      is_scope: true,
      ytd_logged_out_sessions: 100,
      main_keywords: ["mẫu poster"],
      anchors: [
        { text: "mẫu poster", normalized: "mau poster", source: "keyword", role: "Main" },
        { text: "poster", normalized: "poster", source: "keyword", role: "Supporting" },
      ],
    },
    {
      url: "https://www.canva.com/vi_vn/chinh-sua-pdf/",
      title: "Chỉnh sửa PDF",
      page_type: "product",
      page_type_label: "Product",
      is_scope: false,
      ytd_logged_out_sessions: 10,
      main_keywords: ["chỉnh sửa PDF"],
      anchors: [{ text: "PDF tài liệu", normalized: "pdf tai lieu", source: "keyword", role: "Main" }],
    },
    {
      url: "https://www.canva.com/vi_vn/tinh-nang/tao-anh-png/",
      title: "Tạo ảnh PNG",
      page_type: "features",
      page_type_label: "Feature",
      is_scope: false,
      ytd_logged_out_sessions: 10,
      main_keywords: ["PNG"],
      anchors: [],
    },
  ],
};

const sources = {
  candidatePayload,
  feedback: [],
  mappings: {
    rules: [
      { phrases: ["PDF"], url: "https://www.canva.com/vi_vn/chinh-sua-pdf/" },
      { phrases: ["PNG"], url: "https://www.canva.com/vi_vn/tinh-nang/tao-anh-png/" },
    ],
  },
  paths: {},
};

const canonicalMappings = JSON.parse(readFileSync(
  new URL("../runtime/data/destination-mappings.json", import.meta.url),
  "utf8",
));
const genericDesignRule = canonicalMappings.rules.find((rule) =>
  rule.url === "https://www.canva.com/vi_vn/thiet-ke/" && rule.phrases.includes("thiết kế")
);
const appDesignRule = canonicalMappings.rules.find((rule) =>
  rule.url === "https://www.canva.com/vi_vn/thiet-ke/app/" && rule.phrases.includes("thiết kế app")
);
assert.ok(genericDesignRule, "canonical mappings must route the exact anchor thiết kế to the general design hub");
assert.ok(appDesignRule, "canonical mappings must preserve the more specific thiết kế app destination");

const genericDesignPlan = createPlan(
  {
    page_url: "https://www.canva.com/vi_vn/thiet-ke/menu-dep-menu-nha-hang-chuyen-nghiep/",
    main_keywords: ["thiết kế menu"],
    format: "plain",
    content: "Canva hỗ trợ tiếp tục thiết kế trên điện thoại, máy tính bảng và máy tính.",
  },
  {
    candidatePayload: {
      generated_at: "2026-09-07T00:00:00Z",
      candidates: [
        {
          url: "https://www.canva.com/vi_vn/thiet-ke/",
          title: "",
          page_type: "create",
          page_type_label: "Create",
          main_keywords: ["thiết kế"],
          anchors: [{ text: "thiết kế", source: "keyword", role: "Main" }],
        },
        {
          url: "https://www.canva.com/vi_vn/thiet-ke/app/",
          title: "Thiết kế App",
          page_type: "create",
          page_type_label: "Create",
          main_keywords: ["thiết kế giao diện app"],
          anchors: [{ text: "thiết kế", source: "keyword", role: "Supporting" }],
        },
      ],
    },
    feedback: [],
    mappings: { rules: [genericDesignRule] },
    paths: {},
  },
);
assert.equal(genericDesignPlan.placements.length, 1);
assert.equal(genericDesignPlan.placements[0].anchor, "thiết kế");
assert.equal(genericDesignPlan.placements[0].target_url, "https://www.canva.com/vi_vn/thiet-ke/");
assert.equal(genericDesignPlan.placements[0].evidence_tier, "explicit_mapping");
assert.equal(genericDesignPlan.placements.some((item) => item.target_url.endsWith("/thiet-ke/app/")), false);
assert.equal(validatePlan(genericDesignPlan).ok, true);

const forcedGenericDesignApp = structuredClone(genericDesignPlan);
forcedGenericDesignApp.placements[0].target_url = "https://www.canva.com/vi_vn/thiet-ke/app/";
assert.equal(
  validatePlan(forcedGenericDesignApp).errors.some((error) => error.includes("hard-skip anchor-target pair")),
  true,
);

const specificAppDesignPlan = createPlan(
  {
    page_url: "https://www.canva.com/vi_vn/example/",
    format: "plain",
    content: "Bạn có thể thiết kế app cho dự án.",
  },
  {
    candidatePayload: {
      generated_at: "2026-09-07T00:00:00Z",
      candidates: [
        {
          url: "https://www.canva.com/vi_vn/thiet-ke/",
          title: "",
          page_type: "create",
          page_type_label: "Create",
          main_keywords: ["thiết kế"],
          anchors: [{ text: "thiết kế", source: "keyword", role: "Main" }],
        },
        {
          url: "https://www.canva.com/vi_vn/thiet-ke/app/",
          title: "Thiết kế App",
          page_type: "create",
          page_type_label: "Create",
          main_keywords: ["thiết kế giao diện app"],
          anchors: [{ text: "thiết kế app", source: "keyword", role: "Supporting" }],
        },
      ],
    },
    feedback: [],
    mappings: { rules: [appDesignRule, genericDesignRule] },
    paths: {},
  },
);
assert.equal(specificAppDesignPlan.placements.length, 1);
assert.equal(specificAppDesignPlan.placements[0].anchor, "thiết kế app");
assert.equal(specificAppDesignPlan.placements[0].target_url, "https://www.canva.com/vi_vn/thiet-ke/app/");
assert.equal(validatePlan(specificAppDesignPlan).ok, true);

const augmentedHistoryTarget = augmentCandidatesFromManualHistory(candidatePayload, [
  {
    source_url: "https://www.canva.com/vi_vn/source-one/",
    target_url: "https://www.canva.com/vi_vn/tinh-nang/phong-chu/",
    anchor: "font",
    link_source: "manual",
    target_title: "Phông chữ",
    target_type: "Feature",
  },
  {
    source_url: "https://www.canva.com/vi_vn/source-two/",
    target_url: "https://www.canva.com/vi_vn/tinh-nang/phong-chu/",
    anchor: "font",
    link_source: "manual",
    target_title: "Phông chữ",
    target_type: "Feature",
  },
  {
    source_url: "https://www.canva.com/vi_vn/source-one/",
    target_url: "https://www.canva.com/vi_vn/one-off/",
    anchor: "một lần",
    link_source: "manual",
  },
]);
assert.deepEqual(augmentedHistoryTarget.promotedTargets, ["https://www.canva.com/vi_vn/tinh-nang/phong-chu/"]);
assert.equal(augmentedHistoryTarget.candidatePayload.candidates.at(-1).origin, "repeated_manual_history");

const repeatedShortManualPlan = createPlan(
  {
    page_url: "https://www.canva.com/vi_vn/thiet-ke/ky-yeu/",
    main_keywords: ["thiết kế kỷ yếu"],
    format: "plain",
    content: "Để kỷ yếu dễ đọc, hãy chọn một font cho tiêu đề và một font cho phần nội dung.",
  },
  {
    candidatePayload: augmentedHistoryTarget.candidatePayload,
    feedback: [
      {
        action: "added",
        target_url: "https://www.canva.com/vi_vn/tinh-nang/phong-chu/",
        anchor: "font",
        page_url: "https://www.canva.com/vi_vn/source-one/",
      },
      {
        action: "added",
        target_url: "https://www.canva.com/vi_vn/tinh-nang/phong-chu/",
        anchor: "font",
        page_url: "https://www.canva.com/vi_vn/source-two/",
      },
    ],
    mappings: { rules: [] },
    paths: {},
  },
);
assert.equal(
  repeatedShortManualPlan.placements.some(
    (item) => item.anchor === "font" && item.target_url === "https://www.canva.com/vi_vn/tinh-nang/phong-chu/",
  ),
  true,
);
assert.equal(
  repeatedShortManualPlan.placements.find((item) => item.anchor === "font").evidence_tier,
  "repeated_human",
);

const retiredUrl = "https://www.canva.com/vi_vn/mau/s/powerpoint/";
const retiredHistoryTarget = augmentCandidatesFromManualHistory(
  { generated_at: "2026-09-04T00:00:00Z", candidates: [] },
  [
    { source_url: "https://www.canva.com/vi_vn/source-one/", target_url: retiredUrl, anchor: "mẫu PowerPoint", link_source: "manual" },
    { source_url: "https://www.canva.com/vi_vn/source-two/", target_url: retiredUrl, anchor: "mẫu PowerPoint", link_source: "manual" },
  ],
  new Set([retiredUrl]),
);
assert.deepEqual(retiredHistoryTarget.promotedTargets, []);

const blankSource = createPlan(
  {
    document_url: "https://docs.google.com/document/d/test/edit",
    page_url: "",
    main_keywords: [],
    format: "plain",
    content: "## mẫu poster\n\nBạn có thể bắt đầu bằng mẫu poster phù hợp.\n\nXuất PDF tài liệu khi hoàn tất.",
  },
  sources,
);

assert.equal(blankSource.document.source_page_url, "");
assert.equal(blankSource.policy.blank_source_page_url_allowed, true);
assert.equal(blankSource.placements.some((item) => item.target_url.endsWith("/poster/")), true);
const poster = blankSource.placements.find((item) => item.target_url.endsWith("/poster/"));
assert.equal(poster.locator.paragraph_index, 1);
assert.equal(poster.locator.match_index, 2);
assert.equal(poster.locator.match_index_scope, "planner_plain_text");
assert.equal(blankSource.placements.filter((item) => item.target_url.endsWith("/chinh-sua-pdf/")).length, 1);
assert.equal(blankSource.placements.find((item) => item.target_url.endsWith("/chinh-sua-pdf/")).anchor, "PDF");
assert.equal(validatePlan(blankSource).ok, true);

const blankSourceWithDocumentRemoval = createPlan(
  {
    document_url: "https://docs.google.com/document/d/test/edit",
    page_url: "",
    main_keywords: [],
    format: "plain",
    content: "Bạn có thể bắt đầu bằng mẫu poster phù hợp.",
  },
  {
    ...sources,
    feedback: [
      {
        action: "removed",
        target_url: "https://www.canva.com/vi_vn/mau/s/poster/",
        anchor: "mẫu poster",
        page_url: "https://docs.google.com/document/d/test/edit?tab=t.0#heading=test",
      },
    ],
  },
);
assert.equal(
  blankSourceWithDocumentRemoval.placements.some(
    (item) => item.target_url.endsWith("/poster/") && item.anchor === "mẫu poster",
  ),
  false,
);

const launchedSourceWithDocumentRemoval = createPlan(
  {
    document_url: "https://docs.google.com/document/d/test/edit",
    page_url: "https://www.canva.com/vi_vn/new-page/",
    main_keywords: [],
    format: "plain",
    content: "Bạn có thể bắt đầu bằng mẫu poster phù hợp.",
  },
  {
    ...sources,
    feedback: [
      {
        action: "removed",
        target_url: "https://www.canva.com/vi_vn/mau/s/poster/",
        anchor: "mẫu poster",
        page_url: "https://docs.google.com/document/d/test/edit",
      },
    ],
  },
);
assert.equal(
  launchedSourceWithDocumentRemoval.placements.some(
    (item) => item.target_url.endsWith("/poster/") && item.anchor === "mẫu poster",
  ),
  false,
);

const selfLink = createPlan(
  {
    page_url: "https://www.canva.com/vi_vn/mau/s/poster",
    format: "plain",
    content: "Bạn có thể bắt đầu bằng mẫu poster phù hợp.",
  },
  sources,
);
assert.equal(selfLink.placements.some((item) => item.target_url.endsWith("/poster/")), false);

const existingVariant = createPlan(
  {
    page_url: "",
    format: "html",
    content: '<p>Dùng <a href="https://www.canva.com/vi_vn/mau/s/poster?ref=test">mẫu poster</a> rồi thử poster lần nữa.</p>',
  },
  sources,
);
assert.equal(existingVariant.preserved_links.length, 1);
assert.equal(existingVariant.placements.some((item) => item.target_url.endsWith("/poster/")), false);

const contextualChoice = createPlan(
  {
    page_url: "https://www.canva.com/vi_vn/thiet-ke/cv-xin-viec-resume/",
    main_keywords: ["CV xin việc"],
    format: "plain",
    content: "Người đã đi làm nên ưu tiên lịch sử nghề nghiệp.",
  },
  {
    candidatePayload: {
      generated_at: "2026-09-04T00:00:00Z",
      candidates: [
        {
          url: "https://www.canva.com/vi_vn/mau/s/lich-su/",
          title: "Lịch sử",
          page_type: "templates_search",
          page_type_label: "Template Search",
          is_scope: true,
          ytd_logged_out_sessions: 1000,
          main_keywords: ["mẫu lịch sử"],
          anchors: [{ text: "lịch sử", source: "keyword", role: "Supporting" }],
        },
        {
          url: "https://www.canva.com/vi_vn/so-yeu-ly-lich/lich-su-nghe-nghiep/",
          title: "Lịch sử nghề nghiệp",
          page_type: "other",
          page_type_label: "Other",
          is_scope: false,
          ytd_logged_out_sessions: 1,
          main_keywords: ["lịch sử nghề nghiệp"],
          anchors: [{ text: "lịch sử", source: "keyword", role: "Supporting" }],
        },
      ],
    },
    feedback: [],
    mappings: { rules: [] },
    paths: {},
  },
);
assert.equal(contextualChoice.placements.length, 1);
assert.equal(
  contextualChoice.placements[0].target_url,
  "https://www.canva.com/vi_vn/so-yeu-ly-lich/lich-su-nghe-nghiep/",
);
assert.equal(contextualChoice.placements[0].contextual_relevance.decision, "accept");
assert.equal(
  contextualChoice.contextual_decisions.some(
    (item) => item.target_url.endsWith("/mau/s/lich-su/") && item.decision === "reject",
  ),
  true,
);

const hardSkippedCvWriting = createPlan(
  {
    page_url: "https://www.canva.com/vi_vn/so-yeu-ly-lich/",
    main_keywords: ["hồ sơ xin việc"],
    format: "plain",
    content: "Cách viết CV xin việc hiệu quả bắt đầu từ dữ kiện thật.",
  },
  {
    candidatePayload: {
      generated_at: "2026-09-04T00:00:00Z",
      candidates: [
        {
          url: "https://www.canva.com/vi_vn/thiet-ke/cv/",
          title: "Thiết kế CV",
          page_type: "create",
          page_type_label: "Create",
          is_scope: true,
          ytd_logged_out_sessions: 100,
          main_keywords: ["tạo CV xin việc"],
          anchors: [
            { text: "viết CV xin việc", source: "keyword", role: "Main" },
            { text: "viết CV", source: "keyword", role: "Supporting" },
          ],
        },
      ],
    },
    feedback: [],
    mappings: {
      rules: [
        { phrases: ["viết CV xin việc", "viết CV"], url: "https://www.canva.com/vi_vn/thiet-ke/cv/" },
      ],
    },
    paths: {},
  },
);
assert.deepEqual(hardSkippedCvWriting.policy.contextual_relevance.hard_skip_anchors, ["viết CV xin việc"]);
assert.equal(hardSkippedCvWriting.placements.length, 0);
assert.equal(
  hardSkippedCvWriting.contextual_decisions.some(
    (item) => item.anchor === "viết CV xin việc" && item.penalties.includes("hard_skip_anchor"),
  ),
  true,
);
assert.equal(
  hardSkippedCvWriting.contextual_decisions.some(
    (item) => item.anchor === "viết CV" && item.penalties.includes("hard_skip_anchor"),
  ),
  true,
);
assert.equal(validatePlan(hardSkippedCvWriting).ok, true);

const blockedThumbnailTarget = "https://www.canva.com/vi_vn/hinh-anh-dep-tren-mang-xa-hoi/mau/thumbnail-youtube/";
const hardSkippedThumbnail = createPlan(
  {
    page_url: "https://www.canva.com/vi_vn/thiet-ke/tranh-hai-huoc-tranh-vui-comic/",
    main_keywords: ["vẽ truyện tranh"],
    format: "plain",
    content: "Xem các hình thu nhỏ để kiểm tra mạch kể.",
  },
  {
    candidatePayload: {
      generated_at: "2026-09-07T00:00:00Z",
      candidates: [
        {
          url: blockedThumbnailTarget,
          title: "Thumbnail YouTube",
          page_type: "templates_search",
          page_type_label: "Template Search",
          is_scope: true,
          ytd_logged_out_sessions: 100,
          main_keywords: ["thumbnail YouTube"],
          anchors: [{ text: "hình thu nhỏ", source: "keyword", role: "Supporting" }],
        },
      ],
    },
    feedback: [],
    mappings: { rules: [{ phrases: ["hình thu nhỏ"], url: blockedThumbnailTarget }] },
    paths: {},
  },
);
assert.equal(hardSkippedThumbnail.placements.length, 0);
assert.deepEqual(hardSkippedThumbnail.policy.contextual_relevance.hard_skip_anchor_target_pairs, [
  { anchor: "thiết kế", target_url: "https://www.canva.com/vi_vn/thiet-ke/app/" },
  { anchor: "hình thu nhỏ", target_url: blockedThumbnailTarget },
  { anchor: "thang", target_url: "https://www.canva.com/vi_vn/giao-an/mau/thang/" },
]);
assert.equal(
  hardSkippedThumbnail.contextual_decisions.some(
    (item) => item.anchor === "hình thu nhỏ" && item.penalties.includes("user_blocked_anchor_target"),
  ),
  true,
);
assert.equal(validatePlan(hardSkippedThumbnail).ok, true);

const forcedBlockedThumbnail = structuredClone(blankSource);
forcedBlockedThumbnail.placements[0].anchor = "hình thu nhỏ";
forcedBlockedThumbnail.placements[0].target_url = blockedThumbnailTarget;
assert.equal(
  validatePlan(forcedBlockedThumbnail).errors.some((error) => error.includes("hard-skip anchor-target pair")),
  true,
);

const protectedHowToHtml = createPlan(
  {
    page_url: "",
    format: "html",
    content: [
      "<h3>How to steps</h3>",
      "<h3>Tải thiết kế</h3>",
      "<p>Xuất PDF tài liệu sau khi kiểm tra.</p>",
      "<h3>Content block</h3>",
      "<p>Bạn có thể dùng PDF tài liệu để chia sẻ nội dung.</p>",
    ].join(""),
  },
  sources,
);
assert.equal(protectedHowToHtml.policy.exclude_how_to_blocks, true);
assert.equal(protectedHowToHtml.placements.filter((item) => item.target_url.endsWith("/chinh-sua-pdf/")).length, 1);
assert.equal(protectedHowToHtml.placements.find((item) => item.target_url.endsWith("/chinh-sua-pdf/")).locator.paragraph_index, 4);
assert.equal(protectedHowToHtml.document.protected_paragraphs.some((item) => item.paragraph_index === 2), true);
assert.equal(validatePlan(protectedHowToHtml).ok, true);

const forcedHowToPlacement = structuredClone(protectedHowToHtml);
const forcedHowToPdf = forcedHowToPlacement.placements.find((item) => item.target_url.endsWith("/chinh-sua-pdf/"));
const howToParagraph = forcedHowToPlacement.document.plain_text.split(/\n\s*\n/g)[2];
const howToStart = howToParagraph.indexOf("PDF");
forcedHowToPdf.locator = {
  paragraph_index: 2,
  start: howToStart,
  end: howToStart + 3,
  prefix: howToParagraph.slice(Math.max(0, howToStart - 48), howToStart),
  suffix: howToParagraph.slice(howToStart + 3, Math.min(howToParagraph.length, howToStart + 3 + 48)),
  match_index: 1,
  match_index_scope: "planner_plain_text",
  paragraph_fingerprint: forcedHowToPdf.locator.paragraph_fingerprint,
};
assert.equal(validatePlan(forcedHowToPlacement).errors.some((error) => error.includes("protected content")), true);

const duplicateTarget = structuredClone(blankSource);
duplicateTarget.placements.push(structuredClone(duplicateTarget.placements[0]));
assert.equal(validatePlan(duplicateTarget).ok, false);
assert.equal(validatePlan(duplicateTarget).errors.some((error) => error.includes("normalized target URL")), true);

const protectedPlain = createPlan(
  {
    page_url: "",
    format: "plain",
    content: [
      "# mẫu poster trong heading cấp một",
      "",
      "**Meta title:** mẫu poster và PDF cho mọi nhu cầu",
      "",
      "Meta description:",
      "",
      "Dùng PDF tài liệu để chia sẻ nội dung.",
      "",
      "Bạn có thể bắt đầu bằng mẫu poster phù hợp.",
      "",
      "Xuất PDF tài liệu khi hoàn tất.",
    ].join("\n"),
  },
  sources,
);
const protectedPlainPoster = protectedPlain.placements.find((item) => item.target_url.endsWith("/poster/"));
const protectedPlainPdf = protectedPlain.placements.find((item) => item.target_url.endsWith("/chinh-sua-pdf/"));
assert.equal(protectedPlainPoster.locator.paragraph_index, 4);
assert.equal(protectedPlainPdf.locator.paragraph_index, 5);
assert.equal(protectedPlain.document.protected_paragraphs.length, 4);
assert.equal(validatePlan(protectedPlain).ok, true);

const protectedHtml = createPlan(
  {
    page_url: "",
    format: "html",
    content: [
      "<h1>mẫu poster trong H1</h1>",
      "<p><strong>Meta title:</strong> mẫu poster và PDF cho mọi nhu cầu</p>",
      "<p><strong>Meta description:</strong></p>",
      "<p>Dùng PDF tài liệu để chia sẻ nội dung.</p>",
      "<p>Bạn có thể bắt đầu bằng mẫu poster phù hợp.</p>",
      "<p>Xuất PDF tài liệu khi hoàn tất.</p>",
    ].join(""),
  },
  sources,
);
assert.equal(protectedHtml.placements.find((item) => item.target_url.endsWith("/poster/")).locator.paragraph_index, 4);
assert.equal(protectedHtml.placements.find((item) => item.target_url.endsWith("/chinh-sua-pdf/")).locator.paragraph_index, 5);
assert.equal(protectedHtml.document.protected_paragraphs.length, 4);
assert.equal(validatePlan(protectedHtml).ok, true);

const forcedProtectedPlacement = structuredClone(protectedPlain);
const forced = forcedProtectedPlacement.placements[0];
const protectedParagraph = forcedProtectedPlacement.document.plain_text.split(/\n\s*\n/g)[0];
forced.locator = {
  paragraph_index: 0,
  start: protectedParagraph.indexOf(forced.anchor),
  end: protectedParagraph.indexOf(forced.anchor) + forced.anchor.length,
  prefix: protectedParagraph.slice(0, protectedParagraph.indexOf(forced.anchor)),
  suffix: protectedParagraph.slice(protectedParagraph.indexOf(forced.anchor) + forced.anchor.length, protectedParagraph.indexOf(forced.anchor) + forced.anchor.length + 48),
  match_index: 1,
  paragraph_fingerprint: forced.locator.paragraph_fingerprint,
};
assert.equal(validatePlan(forcedProtectedPlacement).ok, false);
assert.equal(validatePlan(forcedProtectedPlacement).errors.some((error) => error.includes("protected content")), true);

console.log("google-docs-internal-link planner tests passed");
