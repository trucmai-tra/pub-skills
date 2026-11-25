import { isBlocked, loadLinkingData, resetLinkingDataCache } from "./data.mjs";
import { normalizeAnchorText, normalizeComparableText, normalizeSearchText } from "./text-utils.mjs";

export { loadLinkingData, resetLinkingDataCache };

const ROLE_WEIGHT = { Explicit: 5, Main: 4, Supporting: 3, Learned: 2, Fallback: 1, Manual: 1 };
const DEFAULT_MAX_LINKS = 12;
const DEFAULT_MAX_PER_PARAGRAPH = 2;
const GENERIC_ANCHORS = new Set([
  "đon gian",
  "mau đon gian",
  "đep",
  "đep nhat",
  "mau đep",
  "mien phi",
  "online",
  "chuyen nghiep",
  "de thuong",
  "cute",
  "an tuong",
  "đoc đao",
  "sang tao",
  "moi nhat",
  "template",
  "de lam",
]);

export async function linkText(input, options = {}) {
  const data = options.data || (await loadLinkingData());
  return linkTextWithData(input, { ...options, data });
}

export function linkTextWithData(input, options = {}) {
  const data = options.data;
  const format = options.format || "auto";
  const parsed = parseInput(input, format, data.candidateByUrl);
  const maxLinks = boundedInt(options.maxLinks, DEFAULT_MAX_LINKS, 0, 60);
  const maxPerParagraph = boundedInt(options.maxPerParagraph, DEFAULT_MAX_PER_PARAGRAPH, 1, 20);
  const pageUrl = normalizeUrl(options.pageUrl || "");
  const mainKeywords = Array.isArray(options.mainKeywords) ? options.mainKeywords : [];
  const pool = buildAnchorPool(data.candidates, {
    pageUrl,
    mainKeywords,
    feedbackBlocks: data.feedbackBlocks,
  });
  const injection = injectLinks(parsed.paragraphs, pool, {
    maxLinks,
    maxPerParagraph,
    candidateByUrl: data.candidateByUrl,
    contextualEvaluator: options.contextualEvaluator,
  });
  const links = injection.links;
  const rendered = render(parsed.paragraphs, links);
  const preservedLinks = links.filter((link) => link.source === "manual" || link.source === "preserved");
  const addedLinks = links.filter((link) => link.source === "auto");
  return {
    ok: true,
    html: rendered.html,
    markdown: rendered.markdown,
    plain: rendered.plain,
    links,
    addedLinks,
    preservedLinks,
    contextualDecisions: injection.contextualDecisions,
    stats: {
      candidateCount: data.candidates.length,
      feedbackEvents: data.feedback.length,
      added: addedLinks.length,
      preserved: preservedLinks.length,
      maxLinks,
      maxPerParagraph,
      source: data.source || "json",
      version: data.version || null,
    },
  };
}

export async function suggestCandidates(options = {}) {
  const data = options.data || (await loadLinkingData());
  return suggestCandidatesWithData({ ...options, data });
}

export function suggestCandidatesWithData(options = {}) {
  const data = options.data;
  const query = String(options.query || options.q || "").trim();
  const anchor = String(options.anchor || options.selectedText || "").trim();
  const pageUrl = normalizeUrl(options.pageUrl || "");
  const limit = boundedInt(options.limit, 30, 1, 100);
  const queryNorm = normalizeSearchText(query);
  const anchorNorm = normalizeSearchText(anchor);
  const blockNorm = normalizeAnchorText(anchor);
  const results = [];

  for (const candidate of data.candidates) {
    if (pageUrl && candidate.url === pageUrl) continue;
    if (blockNorm && isBlocked(data.feedbackBlocks, pageUrl, candidate.url, blockNorm)) continue;
    const anchors = (candidate.anchors || []).map((item) => item.text || "").filter(Boolean);
    const haystack = normalizeSearchText(`${candidate.title || ""} ${candidate.url || ""} ${anchors.join(" ")}`);
    if (queryNorm && !haystack.includes(queryNorm)) continue;

    let score = candidate.is_scope ? 5 : 0;
    const normalizedAnchors = anchors.map((item) => normalizeSearchText(item));
    const exactAnchor = Boolean(anchorNorm && normalizedAnchors.some((item) => item === anchorNorm));
    const containsAnchor = Boolean(anchorNorm && haystack.includes(anchorNorm));
    if (exactAnchor) score += 10;
    else if (containsAnchor) score += 4;
    const feedbackBoost = blockNorm
      ? data.positiveFeedbackCounts?.get(`${blockNorm}\u0001${candidate.url}`)?.count || 0
      : 0;
    if (feedbackBoost) score += 8 + Math.min(3, feedbackBoost);
    score += Math.min(3, Math.log10(1 + Number(candidate.ytd_logged_out_sessions || 0)));

    const matchedAnchors = anchors
      .filter((item) => {
        const normalized = normalizeSearchText(item);
        return (
          (queryNorm && normalized.includes(queryNorm)) ||
          (anchorNorm && (normalized === anchorNorm || normalized.includes(anchorNorm)))
        );
      })
      .slice(0, 8);

    results.push({
      score: Number(score.toFixed(4)),
      url: candidate.url,
      title: candidate.title || "",
      type: candidate.page_type_label || candidate.page_type || "",
      is_scope: Boolean(candidate.is_scope),
      sessions: Number(candidate.ytd_logged_out_sessions || 0),
      has_keyword_data: Boolean(candidate.has_keyword_data),
      main_keywords: candidate.main_keywords || [],
      anchors: anchors.slice(0, 8),
      matched_anchors: matchedAnchors,
      match: {
        query: query || null,
        anchor: anchor || null,
        exact_anchor: exactAnchor,
        contains_anchor: containsAnchor,
        positive_feedback: feedbackBoost,
      },
    });
  }

  results.sort((a, b) => b.score - a.score || b.sessions - a.sessions || a.url.localeCompare(b.url));
  return {
    ok: true,
    query,
    anchor,
    pageUrl,
    count: Math.min(limit, results.length),
    totalMatches: results.length,
    candidates: results.slice(0, limit),
    stats: {
      candidateCount: data.candidates.length,
      sourceGeneratedAt: data.candidatePayload.generated_at || null,
      source: data.source || "json",
      version: data.version || null,
    },
  };
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeUrl(value) {
  return String(value || "").trim();
}

function normalizeWithMap(text) {
  const out = [];
  const map = [];
  const chars = [...String(text || "")];
  let originalIndex = 0;
  for (const ch of chars) {
    const decomposed = [...ch.normalize("NFD")];
    for (const part of decomposed) {
      if (/\p{Mark}/u.test(part)) continue;
      const lower = part.toLowerCase();
      if (!lower) continue;
      out.push([...lower][0]);
      map.push(originalIndex);
    }
    originalIndex += ch.length;
  }
  return { text: out.join(""), map };
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function anchorPattern(normAnchor) {
  const body = escapeRegExp(normAnchor).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, "g");
}

function diacriticExact(span, anchorText) {
  return normalizeComparableText(span) === normalizeComparableText(anchorText);
}

function sentenceSpans(paragraph) {
  const spans = [];
  let start = 0;
  const regex = /[.!?…]+(?:\s+|$)/g;
  for (const match of paragraph.matchAll(regex)) {
    spans.push([start, match.index + match[0].length]);
    start = match.index + match[0].length;
  }
  if (start < paragraph.length) spans.push([start, paragraph.length]);
  return spans;
}

function splitPlainParagraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("## ")) return { kind: "h3", text: part.slice(3).trim(), links: [] };
      return { kind: "p", text: part, links: [] };
    });
}

function parseInput(input, format, candidateByUrl) {
  const text = String(input || "");
  const detected = format === "auto" ? (/<[a-z][\s\S]*>/i.test(text) ? "html" : "plain") : format;
  if (detected === "html") {
    return { paragraphs: parseHtmlParagraphs(text, candidateByUrl), format: "html" };
  }
  return { paragraphs: splitPlainParagraphs(text), format: "plain" };
}

function parseHtmlParagraphs(html, candidateByUrl) {
  const paragraphs = [];
  const blockRegex = /<(p|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let found = false;
  for (const match of html.matchAll(blockRegex)) {
    found = true;
    const tag = match[1].toLowerCase();
    const parsed = parseInlineHtml(match[2], candidateByUrl);
    paragraphs.push({
      kind: tag === "p" ? "p" : "h3",
      text: parsed.text.trim(),
      links: tag === "p" ? parsed.links : [],
    });
  }
  if (found) return paragraphs.filter((paragraph) => paragraph.text);
  const parsed = parseInlineHtml(html, candidateByUrl);
  return parsed.text.trim() ? [{ kind: "p", text: parsed.text.trim(), links: parsed.links }] : [];
}

function parseInlineHtml(html, candidateByUrl) {
  const links = [];
  let text = "";
  let cursor = 0;
  const anchorRegex = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorRegex)) {
    text += htmlToText(html.slice(cursor, match.index));
    const start = text.length;
    const anchor = htmlToText(match[3]);
    text += anchor;
    const end = text.length;
    const url = decodeHtml(match[2]).trim();
    const candidate = candidateByUrl.get(url) || {};
    if (anchor && url) {
      links.push({
        url,
        anchor,
        paragraph: 0,
        start,
        end,
        source: "manual",
        target_title: candidate.title || "",
        target_type: candidate.page_type_label || "",
        target_is_scope: Boolean(candidate.is_scope),
        anchor_role: "Manual",
        decision: "preserved",
      });
    }
    cursor = match.index + match[0].length;
  }
  text += htmlToText(html.slice(cursor));
  return { text: text.replace(/\s+/g, " ").trim(), links };
}

function htmlToText(html) {
  return decodeHtml(String(html || "").replace(/<[^>]+>/g, ""));
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildAnchorPool(candidates, context) {
  const ownUrl = context.pageUrl || "";
  const ownNorms = new Set((context.mainKeywords || []).map(normalizeAnchorText).filter(Boolean));
  const pool = [];
  for (const candidate of candidates) {
    if (candidate.url === ownUrl) continue;
    for (const anchor of candidate.anchors || []) {
      const norm = anchor.normalized || normalizeAnchorText(anchor.text);
      const explicit = anchor.source === "explicit";
      const source = anchor.source || "fallback";
      const confidence = Number(anchor.confidence || 0);
      const positiveCount = Number(anchor.positive_count || 0);
      const repeatedLearned = source === "learned" && confidence >= 0.8 && positiveCount >= 2;
      if (!norm || (!explicit && !repeatedLearned && norm.length < 5) || ownNorms.has(norm) || GENERIC_ANCHORS.has(norm)) continue;
      if (isBlocked(context.feedbackBlocks, ownUrl, candidate.url, norm)) continue;
      if (source === "learned" && confidence < 0.8 && positiveCount < 2) continue;
      pool.push({
        url: candidate.url,
        title: candidate.title || "",
        page_type: candidate.page_type || "",
        page_type_label: candidate.page_type_label || "",
        is_scope: Boolean(candidate.is_scope),
        anchor_text: anchor.text || "",
        norm,
        tokens: norm.split(/\s+/).filter(Boolean).length,
        role: anchor.role || "Fallback",
        source,
        confidence,
        positive_count: positiveCount,
        sv: Number(anchor.search_volume || 0),
        sessions: Number(candidate.ytd_logged_out_sessions || 0),
        target_main_keywords: candidate.main_keywords || [],
      });
    }
  }
  pool.sort((a, b) => {
    return (
      Number(b.source === "explicit") - Number(a.source === "explicit") ||
      b.tokens - a.tokens ||
      (ROLE_WEIGHT[b.role] || 0) - (ROLE_WEIGHT[a.role] || 0) ||
      b.confidence - a.confidence ||
      Number(b.is_scope) - Number(a.is_scope) ||
      b.sv - a.sv ||
      b.sessions - a.sessions ||
      a.url.localeCompare(b.url)
    );
  });
  pool.forEach((anchor, index) => {
    anchor.base_rank = index;
  });
  return pool;
}

function cloneExistingLinks(paragraphs) {
  const links = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    for (const link of paragraph.links || []) {
      if (paragraph.kind !== "p") continue;
      links.push({
        ...link,
        paragraph: paragraphIndex,
        source: link.source || "manual",
        decision: link.decision || "preserved",
      });
    }
  });
  return links;
}

function injectLinks(paragraphs, pool, options) {
  if (typeof options.contextualEvaluator === "function") {
    return injectContextualLinks(paragraphs, pool, options);
  }
  const maxLinks = options.maxLinks;
  const maxPerParagraph = options.maxPerParagraph;
  const links = cloneExistingLinks(paragraphs);
  const usedUrls = new Set();
  const usedAnchors = new Set();
  const paragraphCounts = Array(paragraphs.length).fill(0);
  const usedSentences = new Set();
  const takenSpans = new Map(paragraphs.map((_, index) => [index, []]));
  const sentenceMap = paragraphs.map((paragraph) => sentenceSpans(paragraph.text));
  const normalizedParagraphs = paragraphs.map((paragraph) => normalizeWithMap(paragraph.text));

  for (const link of links) {
    usedUrls.add(link.url);
    usedAnchors.add(normalizeAnchorText(link.anchor));
    paragraphCounts[link.paragraph] += 1;
    takenSpans.get(link.paragraph).push([link.start, link.end]);
    const sentenceIndex = findSentenceIndex(sentenceMap[link.paragraph], link.start);
    if (sentenceIndex !== -1) usedSentences.add(`${link.paragraph}\u0001${sentenceIndex}`);
  }

  for (const anchor of pool) {
    if (links.length >= maxLinks) break;
    if (usedUrls.has(anchor.url) || usedAnchors.has(anchor.norm)) continue;
    const pattern = anchorPattern(anchor.norm);
    let placed = false;
    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
      const paragraph = paragraphs[paragraphIndex];
      if (placed || paragraph.kind !== "p" || paragraphCounts[paragraphIndex] >= maxPerParagraph) continue;
      const normalized = normalizedParagraphs[paragraphIndex];
      pattern.lastIndex = 0;
      for (const match of normalized.text.matchAll(pattern)) {
        const start = normalized.map[match.index];
        const end = normalized.map[match.index + match[0].length - 1] + 1;
        const visibleAnchor = paragraph.text.slice(start, end);
        if (!diacriticExact(visibleAnchor, anchor.anchor_text)) continue;
        if (spanOverlaps(takenSpans.get(paragraphIndex), start, end)) continue;
        const sentenceIndex = findSentenceIndex(sentenceMap[paragraphIndex], start);
        if (sentenceIndex === -1 || usedSentences.has(`${paragraphIndex}\u0001${sentenceIndex}`)) continue;
        const candidate = options.candidateByUrl.get(anchor.url) || {};
        links.push({
          url: anchor.url,
          anchor: visibleAnchor,
          paragraph: paragraphIndex,
          start,
          end,
          source: "auto",
          target_title: anchor.title || candidate.title || "",
          target_type: anchor.page_type_label || candidate.page_type_label || "",
          target_is_scope: Boolean(anchor.is_scope || candidate.is_scope),
          anchor_role: anchor.role,
          anchor_source: anchor.source,
          anchor_confidence: anchor.confidence,
          decision: "added",
        });
        usedUrls.add(anchor.url);
        usedAnchors.add(anchor.norm);
        usedSentences.add(`${paragraphIndex}\u0001${sentenceIndex}`);
        paragraphCounts[paragraphIndex] += 1;
        takenSpans.get(paragraphIndex).push([start, end]);
        placed = true;
        break;
      }
    }
  }

  links.sort((a, b) => a.paragraph - b.paragraph || a.start - b.start);
  return { links, contextualDecisions: [] };
}

function injectContextualLinks(paragraphs, pool, options) {
  const maxLinks = options.maxLinks;
  const maxPerParagraph = options.maxPerParagraph;
  const links = cloneExistingLinks(paragraphs);
  const usedUrls = new Set();
  const usedAnchors = new Set();
  const paragraphCounts = Array(paragraphs.length).fill(0);
  const usedSentences = new Set();
  const takenSpans = new Map(paragraphs.map((_, index) => [index, []]));
  const sentenceMap = paragraphs.map((paragraph) => sentenceSpans(paragraph.text));
  const normalizedParagraphs = paragraphs.map((paragraph) => normalizeWithMap(paragraph.text));
  const contextualDecisions = [];
  const acceptedProposals = [];

  for (const link of links) {
    usedUrls.add(link.url);
    usedAnchors.add(normalizeAnchorText(link.anchor));
    paragraphCounts[link.paragraph] += 1;
    takenSpans.get(link.paragraph).push([link.start, link.end]);
    const sentenceIndex = findSentenceIndex(sentenceMap[link.paragraph], link.start);
    if (sentenceIndex !== -1) usedSentences.add(`${link.paragraph}\u0001${sentenceIndex}`);
  }

  for (const anchor of pool) {
    if (usedUrls.has(anchor.url) || usedAnchors.has(anchor.norm)) continue;
    const pattern = anchorPattern(anchor.norm);
    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
      const paragraph = paragraphs[paragraphIndex];
      if (paragraph.kind !== "p" || paragraphCounts[paragraphIndex] >= maxPerParagraph) continue;
      const normalized = normalizedParagraphs[paragraphIndex];
      pattern.lastIndex = 0;
      for (const match of normalized.text.matchAll(pattern)) {
        const start = normalized.map[match.index];
        const end = normalized.map[match.index + match[0].length - 1] + 1;
        const visibleAnchor = paragraph.text.slice(start, end);
        if (!diacriticExact(visibleAnchor, anchor.anchor_text)) continue;
        if (spanOverlaps(takenSpans.get(paragraphIndex), start, end)) continue;
        const sentenceIndex = findSentenceIndex(sentenceMap[paragraphIndex], start);
        const sentenceSpan = sentenceMap[paragraphIndex][sentenceIndex];
        if (sentenceIndex === -1 || !sentenceSpan || usedSentences.has(`${paragraphIndex}\u0001${sentenceIndex}`)) continue;
        const relevance = options.contextualEvaluator({
          anchor,
          visible_anchor: visibleAnchor,
          paragraph: paragraph.text,
          paragraph_index: paragraphIndex,
          sentence: paragraph.text.slice(sentenceSpan[0], sentenceSpan[1]).trim(),
          sentence_index: sentenceIndex,
          start,
          end,
        });
        const decision = {
          anchor: visibleAnchor,
          target_url: anchor.url,
          target_title: anchor.title || "",
          target_type: anchor.page_type_label || anchor.page_type || "",
          anchor_source: anchor.source,
          anchor_role: anchor.role,
          positive_count: anchor.positive_count,
          paragraph_index: paragraphIndex,
          start,
          end,
          sentence: paragraph.text.slice(sentenceSpan[0], sentenceSpan[1]).trim(),
          decision: relevance.decision,
          score: relevance.score,
          signals: relevance.signals || [],
          penalties: relevance.penalties || [],
          metrics: relevance.metrics || {},
          selection_status: relevance.decision === "accept" ? "eligible" : "not_eligible",
        };
        contextualDecisions.push(decision);
        if (relevance.decision === "accept") {
          acceptedProposals.push({
            anchor,
            visibleAnchor,
            paragraphIndex,
            sentenceIndex,
            start,
            end,
            relevance,
            decision,
          });
        }
      }
    }
  }

  acceptedProposals.sort((a, b) => (
    b.relevance.score - a.relevance.score ||
    a.anchor.base_rank - b.anchor.base_rank ||
    a.paragraphIndex - b.paragraphIndex ||
    a.start - b.start ||
    a.anchor.url.localeCompare(b.anchor.url)
  ));

  for (const proposal of acceptedProposals) {
    if (links.length >= maxLinks) {
      proposal.decision.selection_status = "not_selected_limit";
      continue;
    }
    const { anchor, paragraphIndex, sentenceIndex, start, end, visibleAnchor } = proposal;
    if (usedUrls.has(anchor.url)) {
      proposal.decision.selection_status = "not_selected_duplicate_target";
      continue;
    }
    if (usedAnchors.has(anchor.norm)) {
      proposal.decision.selection_status = "not_selected_duplicate_anchor";
      continue;
    }
    if (paragraphCounts[paragraphIndex] >= maxPerParagraph) {
      proposal.decision.selection_status = "not_selected_paragraph_limit";
      continue;
    }
    if (usedSentences.has(`${paragraphIndex}\u0001${sentenceIndex}`)) {
      proposal.decision.selection_status = "not_selected_sentence_limit";
      continue;
    }
    if (spanOverlaps(takenSpans.get(paragraphIndex), start, end)) {
      proposal.decision.selection_status = "not_selected_overlap";
      continue;
    }
    const candidate = options.candidateByUrl.get(anchor.url) || {};
    links.push({
      url: anchor.url,
      anchor: visibleAnchor,
      paragraph: paragraphIndex,
      start,
      end,
      source: "auto",
      target_title: anchor.title || candidate.title || "",
      target_type: anchor.page_type_label || candidate.page_type_label || "",
      target_is_scope: Boolean(anchor.is_scope || candidate.is_scope),
      anchor_role: anchor.role,
      anchor_source: anchor.source,
      anchor_confidence: anchor.confidence,
      contextual_relevance: proposal.relevance,
      decision: "added",
    });
    proposal.decision.selection_status = "selected";
    usedUrls.add(anchor.url);
    usedAnchors.add(anchor.norm);
    usedSentences.add(`${paragraphIndex}\u0001${sentenceIndex}`);
    paragraphCounts[paragraphIndex] += 1;
    takenSpans.get(paragraphIndex).push([start, end]);
  }

  links.sort((a, b) => a.paragraph - b.paragraph || a.start - b.start);
  contextualDecisions.sort((a, b) => (
    a.paragraph_index - b.paragraph_index ||
    a.start - b.start ||
    b.score - a.score ||
    a.target_url.localeCompare(b.target_url)
  ));
  return { links, contextualDecisions };
}

function spanOverlaps(spans, start, end) {
  return spans.some(([existingStart, existingEnd]) => !(end <= existingStart || start >= existingEnd));
}

function findSentenceIndex(spans, start) {
  return spans.findIndex(([sentenceStart, sentenceEnd]) => sentenceStart <= start && start < sentenceEnd);
}

function render(paragraphs, links) {
  const byParagraph = new Map();
  for (const link of links) {
    if (!byParagraph.has(link.paragraph)) byParagraph.set(link.paragraph, []);
    byParagraph.get(link.paragraph).push(link);
  }
  const htmlParts = [];
  const markdownParts = [];
  const plainParts = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraph.kind === "h3") {
      htmlParts.push(`<h3>${escapeHtml(paragraph.text)}</h3>`);
      markdownParts.push(`## ${paragraph.text}`);
      plainParts.push(`## ${paragraph.text}`);
      return;
    }
    const paragraphLinks = byParagraph.get(paragraphIndex) || [];
    htmlParts.push(`<p>${renderParagraph(paragraph.text, paragraphLinks, "html")}</p>`);
    markdownParts.push(renderParagraph(paragraph.text, paragraphLinks, "markdown"));
    plainParts.push(paragraph.text);
  });
  return {
    html: htmlParts.join("\n"),
    markdown: markdownParts.join("\n\n"),
    plain: plainParts.join("\n\n"),
  };
}

function renderParagraph(text, paragraphLinks, mode) {
  const pieces = [];
  let cursor = 0;
  for (const link of [...paragraphLinks].sort((a, b) => a.start - b.start)) {
    const before = text.slice(cursor, link.start);
    const anchor = text.slice(link.start, link.end);
    if (mode === "html") {
      pieces.push(escapeHtml(before));
      pieces.push(`<a href="${escapeHtml(link.url)}">${escapeHtml(anchor)}</a>`);
    } else {
      pieces.push(before);
      pieces.push(`[${anchor}](${link.url})`);
    }
    cursor = link.end;
  }
  const tail = text.slice(cursor);
  pieces.push(mode === "html" ? escapeHtml(tail) : tail);
  return pieces.join("");
}
