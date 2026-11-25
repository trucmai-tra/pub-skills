#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeRuntimeData } from "../runtime/lib/data.mjs";
import { linkTextWithData } from "../runtime/lib/linker.mjs";
import { normalizeAnchorText } from "../runtime/lib/text-utils.mjs";
import {
  CONTEXTUAL_THRESHOLDS,
  HARD_SKIP_ANCHOR_TARGET_PAIRS,
  HARD_SKIP_ANCHORS,
  createContextualEvaluator,
  isHardSkipAnchorTargetPair,
  isHardSkipCandidate,
} from "./contextual_relevance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(here, "../runtime");
const DEFAULT_MAX_LINKS = 12;
const DEFAULT_MAX_PER_PARAGRAPH = 2;

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function canonicalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase();
    url.search = "";
    url.hash = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`.replace(/\/+/g, "/");
    return url.toString();
  } catch {
    return "";
  }
}

function removalEventsForDocument(events, document) {
  const pageScope = canonicalizeUrl(document.pageUrl);
  const documentScope = canonicalizeUrl(document.documentUrl);
  const activeScope = pageScope || documentScope;

  return events.map((event) => {
    const eventScope = canonicalizeUrl(event.page_url);
    if (!eventScope) return event;
    const matchesDocument = eventScope === pageScope || eventScope === documentScope;
    return {
      ...event,
      page_url: matchesDocument && activeScope ? activeScope : eventScope,
    };
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])),
  );
}

function fallbackTitleFromUrl(value) {
  const canonical = canonicalizeUrl(value);
  if (!canonical) return "";
  try {
    const parts = new URL(canonical).pathname.split("/").filter(Boolean);
    return decodeURIComponent(parts.at(-1) || "").replace(/[-_]+/g, " ").trim();
  } catch {
    return "";
  }
}

function pageTypeFromHistory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "feature" || normalized === "features") return { page_type: "features", page_type_label: "Feature" };
  if (normalized === "create") return { page_type: "create", page_type_label: "Create" };
  if (normalized === "product") return { page_type: "product", page_type_label: "Product" };
  if (normalized.includes("search")) return { page_type: "templates_search", page_type_label: "Template Search" };
  if (normalized.includes("subcategory") || normalized.includes("category")) {
    return { page_type: "templates_category", page_type_label: "Template Subcategory" };
  }
  return { page_type: "other", page_type_label: String(value || "Other").trim() || "Other" };
}

export function augmentCandidatesFromManualHistory(candidatePayload, historyRows, retiredTargets = new Set()) {
  const retired = new Set([...retiredTargets].map(canonicalizeUrl).filter(Boolean));
  const existingTargets = new Set((candidatePayload.candidates || []).map((candidate) => canonicalizeUrl(candidate.url)).filter(Boolean));
  const pairEvidence = new Map();
  for (const row of historyRows || []) {
    if (row.link_source !== "manual") continue;
    const sourceUrl = canonicalizeUrl(row.source_url);
    const targetUrl = canonicalizeUrl(row.target_url);
    const anchor = normalizeAnchorText(row.anchor);
    if (!sourceUrl || !targetUrl.startsWith("https://www.canva.com/vi_vn/") || !anchor || retired.has(targetUrl)) continue;
    const key = `${targetUrl}\u0001${anchor}`;
    if (!pairEvidence.has(key)) pairEvidence.set(key, { targetUrl, sources: new Set(), rows: [] });
    const entry = pairEvidence.get(key);
    entry.sources.add(sourceUrl);
    entry.rows.push(row);
  }
  const qualifyingByTarget = new Map();
  for (const entry of pairEvidence.values()) {
    if (entry.sources.size < 2 || existingTargets.has(entry.targetUrl)) continue;
    if (!qualifyingByTarget.has(entry.targetUrl)) qualifyingByTarget.set(entry.targetUrl, []);
    qualifyingByTarget.get(entry.targetUrl).push(...entry.rows);
  }
  const promoted = [];
  for (const [targetUrl, rows] of qualifyingByTarget) {
    const metadataRow = rows.find((row) => row.target_title || row.target_type) || rows[0] || {};
    const type = pageTypeFromHistory(metadataRow.target_type);
    promoted.push({
      url: targetUrl,
      title: metadataRow.target_title || fallbackTitleFromUrl(targetUrl),
      ...type,
      is_scope: false,
      ytd_logged_out_sessions: 0,
      has_keyword_data: false,
      main_keywords: [],
      anchors: [],
      origin: "repeated_manual_history",
    });
  }
  promoted.sort((a, b) => a.url.localeCompare(b.url));
  return {
    candidatePayload: { ...candidatePayload, candidates: [...(candidatePayload.candidates || []), ...promoted] },
    promotedTargets: promoted.map((candidate) => candidate.url),
  };
}

function feedbackKey(event) {
  return [
    event.action || "",
    event.page_url || "",
    canonicalizeUrl(event.target_url),
    normalizeAnchorText(event.anchor),
  ].join("\u0001");
}

function mergeHistoricalFeedback(feedback, csvText) {
  const merged = new Map();
  for (const event of feedback || []) merged.set(feedbackKey(event), event);
  for (const row of parseCsv(csvText)) {
    if (row.link_source !== "manual" || !row.target_url || !row.anchor) continue;
    const event = {
      action: "added",
      target_url: row.target_url,
      anchor: row.anchor,
      page_url: row.source_url || "",
      page_slug: row.source_slug || "",
      source: "manual",
      at: null,
    };
    const key = feedbackKey(event);
    if (!merged.has(key)) merged.set(key, event);
  }
  return [...merged.values()];
}

function cloneCandidate(candidate, anchors) {
  return {
    ...candidate,
    anchors,
  };
}

function explicitPayload(candidatePayload, mappings) {
  const byUrl = new Map((candidatePayload.candidates || []).map((candidate) => [canonicalizeUrl(candidate.url), candidate]));
  const candidates = [];
  const missingTargets = [];
  for (const rule of mappings?.rules || []) {
    const candidate = byUrl.get(canonicalizeUrl(rule.url));
    if (!candidate) {
      missingTargets.push(rule.url);
      continue;
    }
    const anchors = (rule.phrases || []).filter(Boolean).map((phrase) => ({
      text: phrase,
      normalized: normalizeAnchorText(phrase),
      source: "explicit",
      role: "Explicit",
      search_volume: 1_000_000_000,
      traffic: 1_000_000_000,
    }));
    if (anchors.length) candidates.push(cloneCandidate(candidate, anchors));
  }
  return {
    payload: {
      generated_at: candidatePayload.generated_at || null,
      source: { tier: "explicit_destination_mappings" },
      summary: { candidate_count: candidates.length },
      candidates,
    },
    missingTargets,
  };
}

function repeatedFeedback(feedback) {
  const pairs = new Map();
  for (const event of feedback || []) {
    if (event.action !== "added") continue;
    const target = canonicalizeUrl(event.target_url);
    const anchor = normalizeAnchorText(event.anchor);
    if (!target || !anchor) continue;
    const key = `${anchor}\u0001${target}`;
    if (!pairs.has(key)) pairs.set(key, { pages: new Set(), events: [] });
    const entry = pairs.get(key);
    if (event.page_url) entry.pages.add(event.page_url);
    entry.events.push(event);
  }
  return [...pairs.values()].filter((entry) => entry.pages.size >= 2).flatMap((entry) => entry.events);
}

function priorityPayload(candidatePayload, repeatedEvents) {
  const targets = new Set(repeatedEvents.map((event) => canonicalizeUrl(event.target_url)));
  const candidates = (candidatePayload.candidates || [])
    .filter((candidate) => targets.has(canonicalizeUrl(candidate.url)))
    .map((candidate) => cloneCandidate(candidate, []));
  return {
    generated_at: candidatePayload.generated_at || null,
    source: { tier: "repeated_human_feedback" },
    summary: { candidate_count: candidates.length },
    candidates,
  };
}

export function loadSourceData(repoRoot = DEFAULT_REPO_ROOT) {
  const paths = {
    candidates: resolve(repoRoot, "data/candidates.json"),
    feedback: resolve(repoRoot, "data/link_feedback.json"),
    history: resolve(repoRoot, "data/internal-links.csv"),
    retiredTargets: resolve(repoRoot, "data/retired-targets.json"),
    mappings: resolve(repoRoot, "data/destination-mappings.json"),
  };
  const retiredPayload = JSON.parse(readFileSync(paths.retiredTargets, "utf8"));
  const retiredTargets = new Set(
    (retiredPayload.targets || [])
      .filter((target) => target.status === "retired")
      .map((target) => canonicalizeUrl(target.url))
      .filter(Boolean),
  );
  const rawCandidateFilePayload = JSON.parse(readFileSync(paths.candidates, "utf8"));
  const candidateFilePayload = {
    ...rawCandidateFilePayload,
    candidates: (rawCandidateFilePayload.candidates || [])
      .filter((candidate) => !retiredTargets.has(canonicalizeUrl(candidate.url))),
  };
  const feedback = JSON.parse(readFileSync(paths.feedback, "utf8"));
  const mappings = JSON.parse(readFileSync(paths.mappings, "utf8"));
  const historyText = readFileSync(paths.history, "utf8");
  const historyRows = parseCsv(historyText);
  const augmented = augmentCandidatesFromManualHistory(candidateFilePayload, historyRows, retiredTargets);
  const mergedFeedback = mergeHistoricalFeedback(feedback, historyText)
    .filter((event) => !retiredTargets.has(canonicalizeUrl(event.target_url)));
  return {
    candidatePayload: augmented.candidatePayload,
    candidateFileCount: candidateFilePayload.candidates?.length || 0,
    promotedTargets: augmented.promotedTargets,
    retiredTargets: [...retiredTargets].sort(),
    feedback: mergedFeedback,
    mappings,
    paths,
  };
}

function emptyData() {
  return normalizeRuntimeData({
    candidatePayload: { generated_at: null, candidates: [] },
    feedback: [],
    source: "empty",
  });
}

function paragraphList(plain) {
  return String(plain || "").split(/\n\s*\n/g).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function htmlToVisibleText(value) {
  return String(value || "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function metadataField(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-+*]\s+/, "")
    .replace(/\*\*|__/g, "")
    .trim();
  const match = normalized.match(/^(meta|seo)\s+(title|description)\s*(?::|[-–])?\s*(.*)$/iu);
  if (!match) return null;
  return {
    name: `${match[1].toLowerCase()}_${match[2].toLowerCase()}`,
    label_only: !match[3].trim(),
  };
}

function isHowToHeading(value) {
  const normalized = normalizeAnchorText(value).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized === "how to" || normalized === "how to steps";
}

function isKnownSectionBoundaryHeading(value) {
  const normalized = normalizeAnchorText(value).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return new Set([
    "metadata",
    "banner",
    "lead block",
    "illustrated image",
    "content",
    "content block",
    "faq",
    "links added for review",
  ]).has(normalized);
}

function protectPlainContent(value) {
  const parts = String(value || "").split(/(\n\s*\n)/g);
  let protectNext = "";
  let howToHeadingLevel = null;
  return parts.map((part, index) => {
    if (index % 2 === 1 || !part.trim()) return part;
    const trimmed = part.trim();
    const meta = metadataField(trimmed);
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/u);
    const heading = Boolean(headingMatch);
    if (headingMatch) {
      const level = headingMatch[1].length;
      if (isHowToHeading(headingMatch[2])) howToHeadingLevel = level;
      else if (
        howToHeadingLevel !== null &&
        (isKnownSectionBoundaryHeading(headingMatch[2]) || (howToHeadingLevel <= 2 && level <= howToHeadingLevel))
      ) howToHeadingLevel = null;
    }
    const protectedReason = protectNext || (howToHeadingLevel !== null ? "how_to_block" : "") || meta?.name || (heading ? "heading" : "");
    protectNext = meta?.label_only ? `${meta.name}_value` : "";
    if (!protectedReason) return part;
    return `## ${trimmed.replace(/^#{1,6}\s+/, "")}`;
  }).join("");
}

function protectHtmlContent(value) {
  let protectNext = "";
  let howToHeadingLevel = null;
  return String(value || "").replace(
    /<(p|h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (block, rawTag, _attributes, inner) => {
      const tag = rawTag.toLowerCase();
      const visible = htmlToVisibleText(inner);
      const meta = metadataField(visible);
      const headingLevel = tag === "p" ? null : Number(tag.slice(1));
      if (headingLevel !== null) {
        if (isHowToHeading(visible)) howToHeadingLevel = headingLevel;
        else if (
          howToHeadingLevel !== null &&
          (isKnownSectionBoundaryHeading(visible) || (howToHeadingLevel <= 2 && headingLevel <= howToHeadingLevel))
        ) howToHeadingLevel = null;
      }
      const protectedReason = protectNext || (howToHeadingLevel !== null ? "how_to_block" : "") || meta?.name || (tag === "p" ? "" : "heading");
      protectNext = meta?.label_only ? `${meta.name}_value` : "";
      if (!protectedReason) return block;
      return `<h3 data-internal-link-protected="${protectedReason}">${inner}</h3>`;
    },
  );
}

function protectDocumentContent(content, format) {
  const detected = format === "auto" ? (/<[a-z][\s\S]*>/i.test(content) ? "html" : "plain") : format;
  return detected === "html" ? protectHtmlContent(content) : protectPlainContent(content);
}

function extractHtmlLinks(content, format) {
  const detected = format === "auto" ? (/<[a-z][\s\S]*>/i.test(content) ? "html" : "plain") : format;
  if (detected !== "html") return [];
  const links = [];
  for (const match of String(content || "").matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const anchor = htmlToVisibleText(match[3]);
    const url = htmlToVisibleText(match[2]);
    if (anchor && url) links.push({ anchor, url });
  }
  return links;
}

function mergePreservedLinks(...groups) {
  const merged = [];
  const seen = new Set();
  for (const link of groups.flat()) {
    const target = canonicalizeUrl(link.url || link.target_url);
    const anchor = normalizeAnchorText(link.anchor);
    const key = `${target || link.url || link.target_url}\u0001${anchor}`;
    if (!target || !anchor || seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...link, url: link.url || link.target_url });
  }
  return merged;
}

function protectedParagraphs(plain) {
  const protectedItems = [];
  let protectNext = "";
  paragraphList(plain).forEach((paragraph, index) => {
    const meta = metadataField(paragraph);
    const heading = /^##\s+\S/u.test(paragraph);
    const reason = protectNext || meta?.name || (heading ? "heading" : "");
    protectNext = meta?.label_only ? `${meta.name}_value` : "";
    if (reason) protectedItems.push({ paragraph_index: index, reason });
  });
  return protectedItems;
}

function exactMatchIndex(paragraphs, chosenParagraph, chosenStart, anchor) {
  let count = 0;
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    let from = 0;
    for (;;) {
      const found = paragraph.indexOf(anchor, from);
      if (found === -1) break;
      count += 1;
      if (paragraphIndex === chosenParagraph && found === chosenStart) return count;
      from = found + Math.max(1, anchor.length);
    }
  }
  return null;
}

function locatorFor(link, paragraphs) {
  const paragraph = paragraphs[link.paragraph] || "";
  return {
    paragraph_index: link.paragraph,
    start: link.start,
    end: link.end,
    prefix: paragraph.slice(Math.max(0, link.start - 48), link.start),
    suffix: paragraph.slice(link.end, Math.min(paragraph.length, link.end + 48)),
    match_index: exactMatchIndex(paragraphs, link.paragraph, link.start, link.anchor),
    match_index_scope: "planner_plain_text",
    paragraph_fingerprint: sha256(paragraph),
  };
}

function runPass(content, format, data, options) {
  return linkTextWithData(content, {
    format,
    data,
    pageUrl: options.pageUrl || "",
    mainKeywords: options.mainKeywords || [],
    maxLinks: options.totalLimit,
    maxPerParagraph: options.maxPerParagraph,
    contextualEvaluator: options.contextualEvaluator,
  });
}

function normalizeDocument(input, overrides = {}) {
  const content = String(input.content ?? input.html ?? input.text ?? "");
  if (!content.trim()) throw new Error("Expected non-empty document content");
  const format = overrides.format && overrides.format !== "auto" ? overrides.format : input.format || overrides.format || "auto";
  if (!new Set(["auto", "plain", "html"]).has(format)) throw new Error(`Unsupported format: ${format}`);
  return {
    documentUrl: String(overrides.documentUrl ?? input.document_url ?? input.documentUrl ?? "").trim(),
    title: String(input.title || "").trim(),
    pageUrl: String(overrides.pageUrl ?? input.page_url ?? input.pageUrl ?? "").trim(),
    mainKeywords: overrides.mainKeywords?.length
      ? overrides.mainKeywords
      : Array.isArray(input.main_keywords ?? input.mainKeywords)
        ? input.main_keywords ?? input.mainKeywords
        : [],
    format,
    content,
  };
}

export function createPlan(input, sources, overrides = {}) {
  const document = normalizeDocument(input, overrides);
  const protectedContent = protectDocumentContent(document.content, document.format);
  const baseline = runPass(protectedContent, document.format, emptyData(), {
    pageUrl: document.pageUrl,
    mainKeywords: document.mainKeywords,
    totalLimit: 0,
    maxPerParagraph: overrides.maxPerParagraph || DEFAULT_MAX_PER_PARAGRAPH,
  });
  const preservedLinks = mergePreservedLinks(
    baseline.preservedLinks,
    extractHtmlLinks(document.content, document.format),
  );
  const maxAutoLinks = boundedInteger(overrides.maxLinks, DEFAULT_MAX_LINKS, 0, 60);
  const totalLimit = Math.min(60, preservedLinks.length + maxAutoLinks);
  const contextualEvaluator = createContextualEvaluator({
    pageUrl: document.pageUrl,
    mainKeywords: document.mainKeywords,
  });
  const common = {
    pageUrl: canonicalizeUrl(document.pageUrl) || canonicalizeUrl(document.documentUrl),
    mainKeywords: document.mainKeywords,
    totalLimit,
    maxPerParagraph: boundedInteger(overrides.maxPerParagraph, DEFAULT_MAX_PER_PARAGRAPH, 1, 20),
    contextualEvaluator,
  };

  const explicit = explicitPayload(sources.candidatePayload, sources.mappings);
  const removalEvents = removalEventsForDocument(
    sources.feedback.filter((event) => event.action === "removed"),
    document,
  );
  const documentFeedback = [
    ...sources.feedback.filter((event) => event.action !== "removed"),
    ...removalEvents,
  ];
  const explicitData = normalizeRuntimeData({
    candidatePayload: explicit.payload,
    feedback: removalEvents,
    source: "mass_creation_explicit",
  });
  const explicitResult = runPass(protectedContent, document.format, explicitData, common);

  const repeatedEvents = repeatedFeedback(sources.feedback);
  const learnedData = normalizeRuntimeData({
    candidatePayload: priorityPayload(sources.candidatePayload, repeatedEvents),
    feedback: [...repeatedEvents, ...removalEvents],
    source: "mass_creation_repeated_human",
  });
  const learnedResult = runPass(explicitResult.html, "html", learnedData, common);

  const generalData = normalizeRuntimeData({
    candidatePayload: sources.candidatePayload,
    feedback: documentFeedback,
    source: "mass_creation_candidates",
    version: sources.candidatePayload.generated_at || null,
  });
  const generalResult = runPass(learnedResult.html, "html", generalData, common);
  const paragraphs = paragraphList(generalResult.plain);

  const tiered = [
    ...explicitResult.addedLinks.map((link) => ({ ...link, evidence_tier: "explicit_mapping" })),
    ...learnedResult.addedLinks.map((link) => ({ ...link, evidence_tier: "repeated_human" })),
    ...generalResult.addedLinks.map((link) => ({ ...link, evidence_tier: "candidate_pool" })),
  ];
  const contextualDecisions = [
    ...explicitResult.contextualDecisions.map((item) => ({ ...item, evidence_tier: "explicit_mapping" })),
    ...learnedResult.contextualDecisions.map((item) => ({ ...item, evidence_tier: "repeated_human" })),
    ...generalResult.contextualDecisions.map((item) => ({ ...item, evidence_tier: "candidate_pool" })),
  ];
  const usedTargets = new Set(preservedLinks.map((link) => canonicalizeUrl(link.url)).filter(Boolean));
  const usedAnchors = new Set(preservedLinks.map((link) => normalizeAnchorText(link.anchor)).filter(Boolean));
  const pageCanonical = canonicalizeUrl(document.pageUrl);
  const placements = [];
  const skipped = [];

  for (const link of tiered) {
    const targetCanonical = canonicalizeUrl(link.url);
    const anchorNormalized = normalizeAnchorText(link.anchor);
    let reason = "";
    if (!targetCanonical) reason = "invalid_target_url";
    else if (pageCanonical && targetCanonical === pageCanonical) reason = "self_link";
    else if (usedTargets.has(targetCanonical)) reason = "duplicate_target";
    else if (usedAnchors.has(anchorNormalized)) reason = "duplicate_anchor";
    if (reason) {
      skipped.push({ anchor: link.anchor, target_url: link.url, evidence_tier: link.evidence_tier, reason });
      continue;
    }
    const locator = locatorFor(link, paragraphs);
    if (locator.match_index === null || paragraphs[link.paragraph]?.slice(link.start, link.end) !== link.anchor) {
      skipped.push({ anchor: link.anchor, target_url: link.url, evidence_tier: link.evidence_tier, reason: "stale_locator" });
      continue;
    }
    usedTargets.add(targetCanonical);
    usedAnchors.add(anchorNormalized);
    placements.push({
      anchor: link.anchor,
      anchor_normalized: anchorNormalized,
      target_url: link.url,
      target_url_normalized: targetCanonical,
      target_title: link.target_title || "",
      target_type: link.target_type || "",
      evidence_tier: link.evidence_tier,
      contextual_relevance: link.contextual_relevance,
      locator,
    });
  }
  placements.sort((a, b) => a.locator.paragraph_index - b.locator.paragraph_index || a.locator.start - b.locator.start);

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    document: {
      document_url: document.documentUrl,
      title: document.title,
      source_page_url: document.pageUrl,
      source_page_url_optional: true,
      main_keywords: document.mainKeywords,
      format: document.format,
      plain_text: generalResult.plain,
      content_fingerprint: sha256(generalResult.plain),
      protected_paragraphs: protectedParagraphs(generalResult.plain),
    },
    policy: {
      max_auto_links: maxAutoLinks,
      max_per_paragraph: common.maxPerParagraph,
      one_target_per_document: true,
      one_anchor_per_document: true,
      exclude_meta_title: true,
      exclude_meta_description: true,
      exclude_headings: true,
      exclude_how_to_blocks: true,
      blank_source_page_url_allowed: true,
      pre_application_review: false,
      contextual_relevance: {
        enabled: true,
        version: 1,
        accept_threshold: CONTEXTUAL_THRESHOLDS.accept,
        review_threshold: CONTEXTUAL_THRESHOLDS.review,
        apply_decisions: ["accept"],
        review_decisions_are_not_applied: true,
        hard_skip_anchors: HARD_SKIP_ANCHORS,
        hard_skip_anchor_target_pairs: HARD_SKIP_ANCHOR_TARGET_PAIRS,
      },
    },
    sources: {
      candidates_path: sources.paths?.candidates || null,
      feedback_path: sources.paths?.feedback || null,
      history_path: sources.paths?.history || null,
      mappings_path: sources.paths?.mappings || null,
      retired_targets_path: sources.paths?.retiredTargets || null,
      candidate_generated_at: sources.candidatePayload.generated_at || null,
      candidate_count: sources.candidatePayload.candidates?.length || 0,
      candidate_file_count: sources.candidateFileCount ?? sources.candidatePayload.candidates?.length ?? 0,
      history_promoted_target_count: sources.promotedTargets?.length || 0,
      history_promoted_targets: sources.promotedTargets || [],
      retired_target_count: sources.retiredTargets?.length || 0,
      retired_targets: sources.retiredTargets || [],
      feedback_event_count: sources.feedback.length,
      repeated_human_event_count: repeatedEvents.length,
      missing_mapping_targets: explicit.missingTargets,
    },
    preserved_links: preservedLinks.map((link) => ({
      anchor: link.anchor,
      target_url: link.url,
      target_url_normalized: canonicalizeUrl(link.url),
    })),
    placements,
    skipped,
    contextual_decisions: contextualDecisions,
    stats: {
      preserved: preservedLinks.length,
      planned: placements.length,
      skipped: skipped.length,
      protected_paragraphs: protectedParagraphs(generalResult.plain).length,
      contextual_accepted: contextualDecisions.filter((item) => item.decision === "accept").length,
      contextual_review: contextualDecisions.filter((item) => item.decision === "review").length,
      contextual_rejected: contextualDecisions.filter((item) => item.decision === "reject").length,
    },
  };
}

function sentenceIndex(paragraph, offset) {
  let start = 0;
  let index = 0;
  for (const match of paragraph.matchAll(/[.!?…]+(?:\s+|$)/g)) {
    const end = match.index + match[0].length;
    if (start <= offset && offset < end) return index;
    start = end;
    index += 1;
  }
  return start <= offset && offset <= paragraph.length ? index : -1;
}

export function validatePlan(plan) {
  const errors = [];
  const warnings = [];
  const paragraphs = paragraphList(plan?.document?.plain_text || "");
  const placements = Array.isArray(plan?.placements) ? plan.placements : [];
  const preserved = Array.isArray(plan?.preserved_links) ? plan.preserved_links : [];
  const contextualDecisions = Array.isArray(plan?.contextual_decisions) ? plan.contextual_decisions : [];
  const usedTargets = new Set(preserved.map((link) => canonicalizeUrl(link.target_url)).filter(Boolean));
  const usedAnchors = new Set(preserved.map((link) => normalizeAnchorText(link.anchor)).filter(Boolean));
  const pageCanonical = canonicalizeUrl(plan?.document?.source_page_url || "");
  const retiredTargets = new Set((plan?.sources?.retired_targets || []).map(canonicalizeUrl).filter(Boolean));
  const protectedIndexes = new Map(
    [
      ...protectedParagraphs(plan?.document?.plain_text || ""),
      ...(Array.isArray(plan?.document?.protected_paragraphs) ? plan.document.protected_paragraphs : []),
    ].map((item) => [Number(item.paragraph_index), item.reason || "protected_content"]),
  );
  const paragraphCounts = new Map();
  const sentenceKeys = new Set();

  if (!plan?.document?.plain_text) errors.push("document.plain_text is required");
  if (plan?.document?.content_fingerprint !== sha256(plan?.document?.plain_text || "")) {
    errors.push("document content_fingerprint does not match plain_text");
  }
  if (plan?.document?.source_page_url && !pageCanonical) errors.push("source_page_url is invalid");

  for (const [index, item] of contextualDecisions.entries()) {
    const label = `contextual_decisions[${index}]`;
    if (!new Set(["accept", "review", "reject"]).has(item.decision)) {
      errors.push(`${label} has an invalid decision`);
    }
    if (!Number.isFinite(Number(item.score))) errors.push(`${label} does not have a numeric score`);
    if (item.selection_status === "selected" && item.decision !== "accept") {
      errors.push(`${label} selects a non-accepted candidate`);
    }
  }

  for (const [index, placement] of placements.entries()) {
    const label = `placements[${index}]`;
    const target = canonicalizeUrl(placement.target_url);
    const anchor = normalizeAnchorText(placement.anchor);
    const contextual = placement.contextual_relevance;
    const locator = placement.locator || {};
    const paragraph = paragraphs[locator.paragraph_index];
    if (!target) errors.push(`${label} has an invalid target_url`);
    if (retiredTargets.has(target)) errors.push(`${label} uses a retired target URL`);
    if (isHardSkipAnchorTargetPair({ visible_anchor: placement.anchor, target_url: placement.target_url })) {
      errors.push(`${label} uses a hard-skip anchor-target pair`);
    }
    if (plan.policy?.contextual_relevance?.enabled && contextual?.decision !== "accept") {
      errors.push(`${label} does not have an accepted contextual-relevance decision`);
    }
    if (plan.policy?.contextual_relevance?.enabled && !Number.isFinite(Number(contextual?.score))) {
      errors.push(`${label} does not have a numeric contextual-relevance score`);
    }
    if (pageCanonical && target === pageCanonical) errors.push(`${label} is a self-link`);
    if (usedTargets.has(target)) errors.push(`${label} repeats a normalized target URL`);
    if (usedAnchors.has(anchor)) errors.push(`${label} repeats a normalized anchor`);
    if (paragraph === undefined) errors.push(`${label} points outside the document`);
    else {
      if (isHardSkipCandidate({
        visible_anchor: placement.anchor,
        paragraph,
        start: Number(locator.start),
        end: Number(locator.end),
      })) {
        errors.push(`${label} overlaps a hard-skip anchor phrase`);
      }
      if (protectedIndexes.has(Number(locator.paragraph_index))) {
        errors.push(`${label} points into protected content (${protectedIndexes.get(Number(locator.paragraph_index))})`);
      }
      if (paragraph.slice(locator.start, locator.end) !== placement.anchor) errors.push(`${label} anchor does not match its range`);
      if (exactMatchIndex(paragraphs, locator.paragraph_index, locator.start, placement.anchor) !== locator.match_index) {
        errors.push(`${label} match_index is stale`);
      }
      if (sha256(paragraph) !== locator.paragraph_fingerprint) errors.push(`${label} paragraph fingerprint is stale`);
      if (paragraph.slice(Math.max(0, locator.start - 48), locator.start) !== locator.prefix) errors.push(`${label} prefix is stale`);
      if (paragraph.slice(locator.end, Math.min(paragraph.length, locator.end + 48)) !== locator.suffix) errors.push(`${label} suffix is stale`);
      const count = (paragraphCounts.get(locator.paragraph_index) || 0) + 1;
      paragraphCounts.set(locator.paragraph_index, count);
      if (count > Number(plan.policy?.max_per_paragraph || DEFAULT_MAX_PER_PARAGRAPH)) {
        errors.push(`${label} exceeds the per-paragraph limit`);
      }
      const sentence = sentenceIndex(paragraph, locator.start);
      const sentenceKey = `${locator.paragraph_index}\u0001${sentence}`;
      if (sentenceKeys.has(sentenceKey)) errors.push(`${label} repeats a sentence`);
      sentenceKeys.add(sentenceKey);
    }
    usedTargets.add(target);
    usedAnchors.add(anchor);
  }
  if (placements.length > Number(plan.policy?.max_auto_links || DEFAULT_MAX_LINKS)) {
    errors.push("placements exceed max_auto_links");
  }
  return { ok: errors.length === 0, errors, warnings };
}

function parseArgs(argv) {
  const args = { mainKeywords: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") args.input = argv[++index];
    else if (value === "--out") args.out = argv[++index];
    else if (value === "--repo-root") args.repoRoot = argv[++index];
    else if (value === "--page-url") args.pageUrl = argv[++index];
    else if (value === "--document-url") args.documentUrl = argv[++index];
    else if (value === "--main-keyword") args.mainKeywords.push(argv[++index]);
    else if (value === "--format") args.format = argv[++index];
    else if (value === "--max-links") args.maxLinks = Number(argv[++index]);
    else if (value === "--max-per-paragraph") args.maxPerParagraph = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!args.input || !args.out) throw new Error("Usage: plan_links.mjs --input <file> --out <plan.json>");
  return args;
}

function readPlannerInput(path, args) {
  const raw = readFileSync(path, "utf8");
  if (extname(path).toLowerCase() === ".json") return JSON.parse(raw);
  return {
    document_url: args.documentUrl || "",
    page_url: args.pageUrl || "",
    main_keywords: args.mainKeywords,
    format: args.format || "auto",
    content: raw,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = loadSourceData(resolve(args.repoRoot || DEFAULT_REPO_ROOT));
  const plan = createPlan(readPlannerInput(args.input, args), sources, args);
  const validation = validatePlan(plan);
  if (!validation.ok) throw new Error(`Generated plan failed validation:\n${validation.errors.join("\n")}`);
  writeFileSync(resolve(args.out), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ out: resolve(args.out), ...plan.stats, warnings: validation.warnings }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
