import { normalizeSearchText } from "../runtime/lib/text-utils.mjs";

export const CONTEXTUAL_THRESHOLDS = Object.freeze({ accept: 55, review: 30 });
export const HARD_SKIP_ANCHORS = Object.freeze(["viết CV xin việc"]);
export const HARD_SKIP_ANCHOR_TARGET_PAIRS = Object.freeze([
  Object.freeze({
    anchor: "thiết kế",
    target_url: "https://www.canva.com/vi_vn/thiet-ke/app/",
  }),
  Object.freeze({
    anchor: "hình thu nhỏ",
    target_url: "https://www.canva.com/vi_vn/hinh-anh-dep-tren-mang-xa-hoi/mau/thumbnail-youtube/",
  }),
  Object.freeze({
    anchor: "thang",
    target_url: "https://www.canva.com/vi_vn/giao-an/mau/thang/",
  }),
]);
const ACCEPT_THRESHOLD = CONTEXTUAL_THRESHOLDS.accept;
const REVIEW_THRESHOLD = CONTEXTUAL_THRESHOLDS.review;
const HARD_SKIP_ANCHOR_NORMALIZED = HARD_SKIP_ANCHORS.map(normalizeSearchText);

function normalizeTargetUrl(value) {
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

const HARD_SKIP_PAIR_KEYS = new Set(
  HARD_SKIP_ANCHOR_TARGET_PAIRS.map((pair) => (
    `${normalizeSearchText(pair.anchor)}\u0001${normalizeTargetUrl(pair.target_url)}`
  )),
);

const STOP_TOKENS = new Set([
  "ban",
  "bang",
  "bi",
  "cac",
  "cach",
  "canva",
  "cho",
  "co",
  "cua",
  "de",
  "duoc",
  "giup",
  "hay",
  "khi",
  "la",
  "lam",
  "mot",
  "mau",
  "nhung",
  "nhieu",
  "o",
  "online",
  "dep",
  "free",
  "mien",
  "phi",
  "phu",
  "s",
  "su",
  "tao",
  "the",
  "theo",
  "thiet",
  "ke",
  "trang",
  "trong",
  "tu",
  "va",
  "vi",
  "vn",
  "voi",
]);

const STRUCTURAL_PATH_SEGMENTS = new Set([
  "cat",
  "mau",
  "s",
  "thiet-ke",
  "tinh-nang",
  "vi_vn",
]);

const AMBIGUOUS_ANCHORS = new Set([
  "danh sach",
  "du an",
  "giao dien",
  "lich su",
  "mo rong",
  "noi dung",
  "rut gon",
  "thiet ke",
  "tom tat",
  "viet lai",
]);

function normalizedWords(value) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

function normalizeWithMap(value) {
  const original = String(value || "");
  const output = [];
  const map = [];
  for (let index = 0; index < original.length;) {
    const codePoint = String.fromCodePoint(original.codePointAt(index));
    const width = codePoint.length;
    const folded = codePoint
      .normalize("NFD")
      .replace(/\p{Mark}/gu, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase();
    let emittedWordCharacter = false;
    for (const character of folded) {
      if (/[a-z0-9]/u.test(character)) {
        output.push(character);
        map.push(index);
        emittedWordCharacter = true;
      }
    }
    if (!emittedWordCharacter && output.length && output.at(-1) !== " ") {
      output.push(" ");
      map.push(index);
    }
    index += width;
  }
  while (output.at(-1) === " ") {
    output.pop();
    map.pop();
  }
  return { text: output.join(""), map };
}

export function isHardSkipCandidate(input = {}) {
  const anchorNorm = normalizeSearchText(input.visible_anchor || input.anchor?.anchor_text || "");
  if (HARD_SKIP_ANCHOR_NORMALIZED.includes(anchorNorm)) return true;
  const start = Number(input.start);
  const end = Number(input.end);
  if (!String(input.paragraph || "") || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  const normalized = normalizeWithMap(input.paragraph);
  for (const phrase of HARD_SKIP_ANCHOR_NORMALIZED) {
    let offset = 0;
    while (offset <= normalized.text.length - phrase.length) {
      const matchIndex = normalized.text.indexOf(phrase, offset);
      if (matchIndex === -1) break;
      const beforeBoundary = matchIndex === 0 || normalized.text[matchIndex - 1] === " ";
      const afterIndex = matchIndex + phrase.length;
      const afterBoundary = afterIndex === normalized.text.length || normalized.text[afterIndex] === " ";
      if (beforeBoundary && afterBoundary) {
        const rawStart = normalized.map[matchIndex];
        const rawEnd = normalized.map[afterIndex - 1] + 1;
        if (start < rawEnd && end > rawStart) return true;
      }
      offset = matchIndex + 1;
    }
  }
  return false;
}

export function isHardSkipAnchorTargetPair(input = {}) {
  const anchor = normalizeSearchText(input.visible_anchor || input.anchor?.anchor_text || input.anchor || "");
  const target = normalizeTargetUrl(input.target_url || input.anchor?.url || "");
  return Boolean(anchor && target && HARD_SKIP_PAIR_KEYS.has(`${anchor}\u0001${target}`));
}

function semanticTokens(value) {
  return new Set(normalizedWords(value).filter((token) => !STOP_TOKENS.has(token)));
}

function mergeTokens(...values) {
  const merged = new Set();
  for (const value of values.flat()) {
    for (const token of semanticTokens(value)) merged.add(token);
  }
  return merged;
}

function urlTopicText(value) {
  try {
    return new URL(String(value || ""))
      .pathname
      .split("/")
      .filter(Boolean)
      .filter((segment) => !STRUCTURAL_PATH_SEGMENTS.has(segment.toLowerCase()))
      .map((segment) => decodeURIComponent(segment).replace(/[-_]+/g, " "))
      .join(" ");
  } catch {
    return "";
  }
}

function intersection(left, right) {
  return [...left].filter((token) => right.has(token));
}

function subtract(left, right) {
  return new Set([...left].filter((token) => !right.has(token)));
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function rounded(value) {
  return Number(value.toFixed(3));
}

function includesPhrase(value, phrase) {
  const normalizedValue = normalizeSearchText(value);
  const normalizedPhrase = normalizeSearchText(phrase);
  if (!normalizedValue || !normalizedPhrase) return false;
  return new RegExp(`(?:^| )${normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(normalizedValue);
}

function topicProfile({ url = "", title = "", keywords = [] } = {}) {
  return mergeTokens(urlTopicText(url), title, keywords);
}

function makeSourceProfile({ pageUrl = "", mainKeywords = [], title = "" } = {}) {
  return {
    page_url: pageUrl,
    main_keywords: mainKeywords,
    tokens: topicProfile({ url: pageUrl, title, keywords: mainKeywords }),
  };
}

function targetFields(anchor) {
  return [
    urlTopicText(anchor.url),
    anchor.title || "",
    ...(anchor.target_main_keywords || []),
  ];
}

export function classifyAnchorIntent(value) {
  const normalized = normalizeSearchText(value);
  if (/^(?:cac\s+)?mau(?:\s|$)/u.test(normalized)) return "template";
  if (/^(?:cach\s+)?(?:tao|thiet ke)(?:\s|$)/u.test(normalized)) return "create";
  return "neutral";
}

export function classifyTargetFamily(anchor = {}) {
  const type = normalizeSearchText(`${anchor.page_type || ""} ${anchor.page_type_label || ""}`);
  const url = String(anchor.url || "");
  if (type.includes("template") || /\/mau(?:\/|$)|\/mau\/s\//u.test(url)) return "template";
  if (type === "create" || type.includes(" create") || /\/thiet-ke(?:\/|$)/u.test(url)) return "create";
  return "other";
}

export function scoreContextualCandidate(input, sourceProfileInput = {}) {
  const anchor = input.anchor || {};
  const anchorText = input.visible_anchor || anchor.anchor_text || "";
  const anchorNorm = normalizeSearchText(anchorText);
  const rawAnchorWords = normalizedWords(anchorText);
  const anchorTokens = semanticTokens(anchorText);
  const sourceProfile = sourceProfileInput.tokens ? sourceProfileInput : makeSourceProfile(sourceProfileInput);
  const fields = targetFields(anchor);
  const targetTokens = mergeTokens(fields);
  const sentenceTokens = semanticTokens(input.sentence || "");
  const paragraphTokens = semanticTokens(input.paragraph || "");
  const sentenceContextTokens = subtract(sentenceTokens, anchorTokens);
  const paragraphContextTokens = subtract(paragraphTokens, anchorTokens);
  const targetContextTokens = subtract(targetTokens, anchorTokens);
  const anchorTargetMatches = intersection(anchorTokens, targetTokens);
  const sentenceTargetMatches = intersection(sentenceContextTokens, targetContextTokens);
  const paragraphTargetMatches = intersection(paragraphContextTokens, targetContextTokens)
    .filter((token) => !sentenceTargetMatches.includes(token));
  const sourceTargetMatches = intersection(sourceProfile.tokens || new Set(), targetTokens);
  const sourceAnchorMatches = intersection(sourceProfile.tokens || new Set(), anchorTokens);
  const anchorTargetCoverage = ratio(anchorTargetMatches.length, anchorTokens.size);
  const sourceAnchorCoverage = ratio(sourceAnchorMatches.length, anchorTokens.size);
  const sourceTargetSimilarity = ratio(
    sourceTargetMatches.length,
    new Set([...(sourceProfile.tokens || []), ...targetTokens]).size,
  );
  const exactIdentityPhrase = fields.some((field) => includesPhrase(field, anchorText));
  const repeatedHuman = anchor.source === "learned" && Number(anchor.positive_count || 0) >= 2;
  const explicit = anchor.source === "explicit" || anchor.role === "Explicit";
  const anchorIntent = classifyAnchorIntent(anchorText);
  const targetFamily = classifyTargetFamily(anchor);
  const hardSkipAnchor = isHardSkipCandidate(input);
  const hardSkipPair = isHardSkipAnchorTargetPair(input);
  const hardSkip = hardSkipAnchor || hardSkipPair;
  const pageTypeIntentMismatch = !explicit && (
    (anchorIntent === "template" && targetFamily !== "template") ||
    (anchorIntent === "create" && targetFamily === "template")
  );
  const ambiguous = AMBIGUOUS_ANCHORS.has(anchorNorm);
  const distinctiveIdentity = exactIdentityPhrase && !ambiguous && [...anchorTokens].some((token) => token.length >= 5);
  const sourceTopicRepeat = anchorTokens.size > 0 && sourceAnchorCoverage >= 0.75;
  let repeatedWithoutContext = false;
  let sourceDuplicateRisk = false;
  const signals = ["candidate_anchor_record"];
  const penalties = [];
  let score = 15;

  if (hardSkip) {
    return {
      version: 1,
      decision: "reject",
      score: 0,
      thresholds: { accept: ACCEPT_THRESHOLD, review: REVIEW_THRESHOLD },
      signals,
      penalties: [hardSkipPair ? "user_blocked_anchor_target" : "hard_skip_anchor"],
      metrics: {
        anchor_word_count: rawAnchorWords.length,
        anchor_target_coverage: rounded(anchorTargetCoverage),
        source_anchor_coverage: rounded(sourceAnchorCoverage),
        source_target_similarity: rounded(sourceTargetSimilarity),
        anchor_intent: anchorIntent,
        target_family: targetFamily,
        sentence_target_tokens: sentenceTargetMatches.sort(),
        paragraph_target_tokens: paragraphTargetMatches.sort(),
        source_target_tokens: sourceTargetMatches.sort(),
      },
    };
  }

  if (!explicit && anchorIntent === targetFamily && anchorIntent !== "neutral") {
    score += 20;
    signals.push(anchorIntent === "template" ? "template_anchor_matches_template_page" : "create_anchor_matches_create_page");
  }

  if (explicit) {
    signals.push("explicit_destination_mapping");
    score = 100;
  } else if (repeatedHuman) {
    signals.push("repeated_manual_pair");
    score = 85 + Math.min(5, Number(anchor.positive_count || 0));
    if (ambiguous && !sentenceTargetMatches.length) {
      score = 20;
      repeatedWithoutContext = true;
      penalties.push("ambiguous_repeated_pair_without_sentence_support");
    }
    if (sourceTopicRepeat) {
      score = Math.min(score, ACCEPT_THRESHOLD - 1);
      sourceDuplicateRisk = true;
      penalties.push("anchor_repeats_source_topic");
    }
  } else {
    if (anchorTargetCoverage >= 1) {
      score += 20;
      signals.push("anchor_matches_target_topic");
    } else if (anchorTargetCoverage >= 0.5) {
      score += 10;
      signals.push("anchor_partly_matches_target_topic");
    } else {
      score -= 12;
      penalties.push("weak_anchor_target_topic_match");
    }

    if (exactIdentityPhrase) {
      score += 12;
      signals.push("anchor_phrase_in_target_identity");
    }

    if (rawAnchorWords.length >= 4) {
      score += 18;
      signals.push("specific_anchor_phrase");
    } else if (rawAnchorWords.length === 3) {
      score += 14;
      signals.push("specific_anchor_phrase");
    } else if (rawAnchorWords.length === 2) {
      score += 8;
      signals.push("multiword_anchor");
    }
    if (distinctiveIdentity && rawAnchorWords.length === 1) {
      score += 8;
      signals.push("distinctive_single_word_target_identity");
    }

    if (anchor.role === "Main") {
      score += 8;
      signals.push("main_keyword_anchor");
    } else if (anchor.role === "Supporting") {
      score += 4;
      signals.push("supporting_keyword_anchor");
    }

    if (sentenceTargetMatches.length) {
      score += Math.min(30, sentenceTargetMatches.length * 10);
      signals.push("sentence_supports_target_topic");
    }
    if (paragraphTargetMatches.length) {
      score += Math.min(12, paragraphTargetMatches.length * 4);
      signals.push("paragraph_supports_target_topic");
    }
    if (sourceTargetMatches.length && sentenceTargetMatches.length) {
      score += Math.min(6, sourceTargetMatches.length * 2);
      signals.push("target_relates_to_source_topic");
    }

    if (!sentenceTargetMatches.length && !paragraphTargetMatches.length) {
      if (rawAnchorWords.length === 1 && !distinctiveIdentity) {
        score -= 28;
        penalties.push("single_word_anchor_without_context_support");
      } else if (ambiguous) {
        score -= 24;
        penalties.push("ambiguous_anchor_without_context_support");
      } else if (rawAnchorWords.length === 2 && !exactIdentityPhrase) {
        score -= 8;
        penalties.push("short_anchor_without_context_support");
      }
    }

    if (ambiguous && !sentenceTargetMatches.length) {
      score -= 12;
      penalties.push("known_ambiguous_anchor");
    }

    if (sourceTopicRepeat) {
      score -= 20;
      sourceDuplicateRisk = true;
      penalties.push("anchor_repeats_source_topic");
    }
  }

  if (pageTypeIntentMismatch) {
    score = Math.min(score, REVIEW_THRESHOLD - 1);
    penalties.push("page_type_intent_mismatch");
  }

  let decision = "reject";
  if (explicit) decision = "accept";
  else if (pageTypeIntentMismatch) decision = "reject";
  else if (repeatedHuman && !repeatedWithoutContext && !sourceDuplicateRisk) decision = "accept";
  else if (sourceDuplicateRisk) decision = "review";
  else if (score >= ACCEPT_THRESHOLD) decision = "accept";
  else if (score >= REVIEW_THRESHOLD) decision = "review";

  return {
    version: 1,
    decision,
    score,
    thresholds: { accept: ACCEPT_THRESHOLD, review: REVIEW_THRESHOLD },
    signals,
    penalties,
    metrics: {
      anchor_word_count: rawAnchorWords.length,
      anchor_target_coverage: rounded(anchorTargetCoverage),
      source_anchor_coverage: rounded(sourceAnchorCoverage),
      source_target_similarity: rounded(sourceTargetSimilarity),
      anchor_intent: anchorIntent,
      target_family: targetFamily,
      sentence_target_tokens: sentenceTargetMatches.sort(),
      paragraph_target_tokens: paragraphTargetMatches.sort(),
      source_target_tokens: sourceTargetMatches.sort(),
    },
  };
}

export function createContextualEvaluator(source = {}) {
  const sourceProfile = makeSourceProfile(source);
  return (input) => scoreContextualCandidate(input, sourceProfile);
}
