import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./env.mjs";
import { normalizeAnchorText } from "./text-utils.mjs";

loadLocalEnv();

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(here, "..");
const candidatesPath = resolve(projectDir, "data/candidates.json");
const feedbackPath = resolve(projectDir, "data/link_feedback.json");
const retiredTargetsPath = resolve(projectDir, "data/retired-targets.json");

const CACHE_TTL_MS = 15 * 60 * 1000;
const SUPABASE_PAGE_SIZE = 1000;
const BATCH_SIZE = 500;
const KEY_SEPARATOR = "\u0001";

let runtimeCache;
let jsonCache;
let retiredTargetCache;

function loadRetiredTargets() {
  if (!retiredTargetCache) {
    const payload = JSON.parse(readFileSync(retiredTargetsPath, "utf8"));
    retiredTargetCache = new Set(
      (payload.targets || [])
        .filter((target) => target.status === "retired")
        .map((target) => String(target.url || "").trim())
        .filter(Boolean),
    );
  }
  return retiredTargetCache;
}

export async function loadLinkingData() {
  if (!hasSupabaseConfig()) {
    return loadJsonLinkingData("json");
  }

  const now = Date.now();
  if (runtimeCache?.data && runtimeCache.expiresAt > now) {
    return runtimeCache.data;
  }

  try {
    if (runtimeCache?.data?.source === "supabase") {
      const version = await getSupabaseVersion();
      if (String(version.version) === String(runtimeCache.version)) {
        runtimeCache.expiresAt = now + CACHE_TTL_MS;
        return runtimeCache.data;
      }
    }

    const loaded = await loadSupabaseData();
    runtimeCache = {
      data: loaded,
      version: loaded.version,
      expiresAt: now + CACHE_TTL_MS,
    };
    return loaded;
  } catch (error) {
    if (jsonFallbackEnabled()) {
      const fallback = loadJsonLinkingData("json_fallback");
      return {
        ...fallback,
        error: error.message,
      };
    }
    throw error;
  }
}

export function resetLinkingDataCache() {
  runtimeCache = undefined;
  jsonCache = undefined;
  retiredTargetCache = undefined;
}

export function loadJsonLinkingData(source = "json") {
  if (!jsonCache) {
    const candidatePayload = JSON.parse(readFileSync(candidatesPath, "utf8"));
    const feedback = JSON.parse(readFileSync(feedbackPath, "utf8"));
    jsonCache = normalizeRuntimeData({
      candidatePayload,
      feedback,
      source: "json",
      version: candidatePayload.generated_at || null,
    });
  }
  return source === "json" ? jsonCache : { ...jsonCache, source };
}

export function normalizeRuntimeData({ candidatePayload, candidates, feedback, blocks = [], source, version }) {
  const normalizedFeedback = normalizeFeedbackEvents(feedback || []);
  const positiveFeedbackCounts = buildPositiveFeedbackCounts(normalizedFeedback);
  const retiredTargets = loadRetiredTargets();
  const rawCandidates = (candidates || candidatePayload?.candidates || [])
    .filter((candidate) => !retiredTargets.has(String(candidate.url || "").trim()));
  const normalizedCandidates = rawCandidates.map((candidate) => normalizeCandidate(candidate, positiveFeedbackCounts));
  const candidateByUrl = new Map(normalizedCandidates.map((candidate) => [candidate.url, candidate]));
  const derivedBlocks = buildFeedbackBlocks(normalizedFeedback);
  const storedBlocks = buildBlockSets(blocks);
  const feedbackBlocks = {
    pageBlock: new Set([...derivedBlocks.pageBlock, ...storedBlocks.pageBlock]),
    globalBlock: new Set([...derivedBlocks.globalBlock, ...storedBlocks.globalBlock]),
  };

  return {
    candidatePayload: candidatePayload || {
      generated_at: null,
      source: { runtime: source },
      summary: { candidate_count: normalizedCandidates.length },
      candidates: normalizedCandidates,
    },
    candidates: normalizedCandidates,
    feedback: normalizedFeedback,
    candidateByUrl,
    feedbackBlocks,
    positiveFeedbackCounts,
    source,
    version: version || null,
  };
}

export function buildFeedbackBlocks(feedback) {
  const pageBlock = new Set();
  const pagesByAnchorTarget = new Map();

  for (const event of feedback || []) {
    if (event.action !== "removed") continue;
    const pageUrl = event.page_url || "";
    const targetUrl = event.target_url || "";
    const normalizedAnchor = event.normalized_anchor || normalizeAnchorText(event.anchor);
    if (!targetUrl || !normalizedAnchor) continue;

    if (pageUrl) {
      pageBlock.add(blockKey(pageUrl, targetUrl, normalizedAnchor));
    }

    const pair = anchorTargetKey(normalizedAnchor, targetUrl);
    if (!pagesByAnchorTarget.has(pair)) pagesByAnchorTarget.set(pair, new Set());
    if (pageUrl) pagesByAnchorTarget.get(pair).add(pageUrl);
  }

  const globalBlock = new Set();
  for (const [pair, pages] of pagesByAnchorTarget.entries()) {
    if (pages.size >= 2) globalBlock.add(pair);
  }

  return { pageBlock, globalBlock };
}

export function isBlocked(feedbackBlocks, pageUrl, targetUrl, normalizedAnchor) {
  if (!targetUrl || !normalizedAnchor) return false;
  if (feedbackBlocks?.globalBlock?.has(anchorTargetKey(normalizedAnchor, targetUrl))) return true;
  if (pageUrl && feedbackBlocks?.pageBlock?.has(blockKey(pageUrl, targetUrl, normalizedAnchor))) return true;
  return false;
}

export function buildImportRows(candidatePayload, feedback) {
  const candidateRows = [];
  const anchorRows = [];
  const feedbackRowsByKey = new Map();
  for (const event of normalizeFeedbackEvents(feedback || [])) {
    const feedbackKey = feedbackIdempotencyKey(event);
    if (feedbackRowsByKey.has(feedbackKey)) continue;
    feedbackRowsByKey.set(feedbackKey, {
      action: event.action,
      page_url: event.page_url || null,
      page_slug: event.page_slug || null,
      target_url: event.target_url,
      anchor: event.anchor,
      normalized_anchor: event.normalized_anchor,
      source: event.source || "manual",
      context_html: event.context_html || null,
      created_at: event.created_at || new Date().toISOString(),
      source_event_key: feedbackSourceKey(event),
      feedback_key: feedbackKey,
    });
  }
  const feedbackRows = [...feedbackRowsByKey.values()];

  const retiredTargets = loadRetiredTargets();
  for (const candidate of candidatePayload?.candidates || []) {
    if (retiredTargets.has(String(candidate.url || "").trim())) continue;
    candidateRows.push({
      url: candidate.url,
      title: candidate.title || "",
      page_type: candidate.page_type || "",
      page_type_label: candidate.page_type_label || candidate.page_type || "",
      is_scope: Boolean(candidate.is_scope),
      sessions: Number(candidate.ytd_logged_out_sessions || candidate.sessions || 0),
      has_keyword_data: Boolean(candidate.has_keyword_data),
      source_run: candidate.source_run || candidatePayload?.source?.preferred_base || null,
      main_keywords: Array.isArray(candidate.main_keywords) ? candidate.main_keywords : [],
      tags: Array.isArray(candidate.tags) ? candidate.tags : [],
      is_active: true,
    });

    for (const anchor of candidate.anchors || []) {
      const normalizedAnchor = anchor.normalized || anchor.normalized_anchor || normalizeAnchorText(anchor.text || anchor.anchor);
      if (!candidate.url || !normalizedAnchor) continue;
      anchorRows.push({
        target_url: candidate.url,
        anchor: anchor.text || anchor.anchor || "",
        normalized_anchor: normalizedAnchor,
        source: normalizeAnchorSource(anchor.source),
        role: normalizeAnchorRole(anchor.role, anchor.source),
        search_volume: Number(anchor.search_volume || 0),
        traffic: Number(anchor.traffic || 0),
        confidence: Number(anchor.confidence || 0),
        is_active: true,
      });
    }
  }

  return {
    candidateRows,
    anchorRows,
    feedbackRows,
    summary: {
      candidates: candidateRows.length,
      anchors: anchorRows.length,
      feedback: feedbackRows.length,
    },
  };
}

export async function importJsonSnapshots() {
  requireSupabaseConfig();
  const candidatePayload = JSON.parse(readFileSync(candidatesPath, "utf8"));
  const feedback = JSON.parse(readFileSync(feedbackPath, "utf8"));
  const rows = buildImportRows(candidatePayload, feedback);

  await batchUpsert("internal_link_candidates", rows.candidateRows, "url");
  await deleteRows("internal_link_anchors", "source=in.(keyword,fallback)");
  await batchUpsert("internal_link_anchors", rows.anchorRows, "target_url,normalized_anchor,source");
  await batchInsertIgnore("internal_link_feedback", rows.feedbackRows, "feedback_key");

  const allFeedback = await fetchRows("internal_link_feedback", {
    select: "*",
    order: "created_at.asc",
  });
  const derived = await recomputeDerivedRows(allFeedback);
  const version = await bumpDataVersion();
  resetLinkingDataCache();

  return {
    ok: true,
    imported: rows.summary,
    derived,
    version,
  };
}

export async function exportSupabaseSnapshots() {
  requireSupabaseConfig();
  const data = await loadSupabaseData();
  const candidates = data.candidates.map((candidate) => ({
    url: candidate.url,
    page_type: candidate.page_type || "",
    page_type_label: candidate.page_type_label || "",
    ytd_logged_out_sessions: Number(candidate.ytd_logged_out_sessions || 0),
    title: candidate.title || "",
    tags: candidate.tags || [],
    is_scope: Boolean(candidate.is_scope),
    has_keyword_data: Boolean(candidate.has_keyword_data),
    main_keywords: candidate.main_keywords || [],
    anchors: (candidate.anchors || []).map((anchor) => ({
      text: anchor.text,
      normalized: anchor.normalized,
      source: anchor.source,
      role: anchor.role,
      search_volume: Number(anchor.search_volume || 0),
      traffic: Number(anchor.traffic || 0),
      confidence: Number(anchor.confidence || 0),
    })),
  }));

  return {
    candidatePayload: {
      generated_at: new Date().toISOString(),
      source: {
        runtime: "supabase",
        export_rule: "runtime export from internal_link_candidates and internal_link_anchors",
      },
      summary: {
        candidate_count: candidates.length,
        with_keyword_data: candidates.filter((candidate) => candidate.has_keyword_data).length,
        scope_pages: candidates.filter((candidate) => candidate.is_scope).length,
      },
      candidates,
    },
    feedback: data.feedback.map((event) => ({
      action: event.action,
      target_url: event.target_url,
      anchor: event.anchor,
      page_url: event.page_url,
      page_slug: event.page_slug,
      at: event.created_at,
      source: event.source,
    })),
  };
}

export async function recordFeedback(payload) {
  requireSupabaseConfig();
  const event = normalizeFeedbackInput(payload);
  const inserted = await supabaseRequest("internal_link_feedback?on_conflict=feedback_key", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: event,
  });
  const feedback = Array.isArray(inserted) ? inserted[0] : inserted;

  if (!feedback) {
    const existing = await fetchFeedbackByKey(event.feedback_key);
    return {
      ok: true,
      duplicate: true,
      feedback: existing,
      derived: { skipped: "duplicate_feedback" },
      version: null,
    };
  }

  let derived = {};
  if (event.action === "added") {
    derived = await refreshLearnedAnchor(event.target_url, event.normalized_anchor, event.anchor);
  } else if (event.action === "removed") {
    derived = await refreshRemovalBlocks(event.target_url, event.normalized_anchor, event.page_url);
  }

  const version = await bumpDataVersion();
  resetLinkingDataCache();
  return {
    ok: true,
    duplicate: false,
    feedback,
    derived,
    version,
  };
}

export async function invalidateRuntimeCache() {
  requireSupabaseConfig();
  const version = await bumpDataVersion();
  resetLinkingDataCache();
  return { ok: true, version };
}

export async function loadSupabaseData() {
  requireSupabaseConfig();
  const [version, candidateRows, anchorRows, feedbackRows, blockRows] = await Promise.all([
    getSupabaseVersion(),
    fetchRows("internal_link_candidates", {
      select: "*",
      is_active: "eq.true",
      order: "sessions.desc.nullslast,url.asc",
    }),
    fetchRows("internal_link_anchors", {
      select: "*",
      is_active: "eq.true",
      order: "target_url.asc,role.asc,search_volume.desc",
    }),
    fetchRows("internal_link_feedback", {
      select: "*",
      order: "created_at.asc",
    }),
    fetchRows("internal_link_blocks", {
      select: "*",
      order: "created_at.asc",
    }),
  ]);

  const anchorsByTarget = new Map();
  for (const row of anchorRows) {
    if (!anchorsByTarget.has(row.target_url)) anchorsByTarget.set(row.target_url, []);
    anchorsByTarget.get(row.target_url).push({
      text: row.anchor,
      normalized: row.normalized_anchor,
      source: row.source,
      role: row.role,
      search_volume: row.search_volume,
      traffic: row.traffic,
      confidence: row.confidence,
    });
  }

  const candidates = candidateRows.map((row) => ({
    url: row.url,
    title: row.title || "",
    page_type: row.page_type || "",
    page_type_label: row.page_type_label || row.page_type || "",
    is_scope: Boolean(row.is_scope),
    ytd_logged_out_sessions: Number(row.sessions || 0),
    has_keyword_data: Boolean(row.has_keyword_data),
    main_keywords: Array.isArray(row.main_keywords) ? row.main_keywords : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    anchors: anchorsByTarget.get(row.url) || [],
  }));

  return normalizeRuntimeData({
    candidatePayload: {
      generated_at: version.updated_at || null,
      source: { runtime: "supabase" },
      summary: { candidate_count: candidates.length },
      candidates,
    },
    candidates,
    feedback: feedbackRows.map(dbFeedbackToRuntime),
    blocks: blockRows,
    source: "supabase",
    version: version.version,
  });
}

async function getSupabaseVersion() {
  const rows = await fetchRows("internal_link_data_versions", {
    select: "version,updated_at",
    id: "eq.default",
  });
  return rows[0] || { version: 0, updated_at: null };
}

async function bumpDataVersion() {
  const result = await supabaseRequest("rpc/internal_link_bump_data_version", {
    method: "POST",
    body: {},
  });
  const version = Array.isArray(result) ? result[0] : result;
  return version?.version ?? version ?? null;
}

async function refreshLearnedAnchor(targetUrl, normalizedAnchor, anchor) {
  if (!(await candidateExists(targetUrl))) {
    return { learnedAnchor: { targetUrl, normalizedAnchor, skipped: "target_not_in_candidates" } };
  }
  const feedback = await fetchRows("internal_link_feedback", {
    select: "page_url",
    action: "eq.added",
    target_url: `eq.${targetUrl}`,
    normalized_anchor: `eq.${normalizedAnchor}`,
  });
  const count = feedback.length;
  const confidence = count >= 2 ? 0.8 : 0.55;
  await batchUpsert(
    "internal_link_anchors",
    [
      {
        target_url: targetUrl,
        anchor,
        normalized_anchor: normalizedAnchor,
        source: "learned",
        role: "Learned",
        confidence,
        search_volume: 0,
        traffic: 0,
        is_active: true,
      },
    ],
    "target_url,normalized_anchor,source",
  );
  return { learnedAnchor: { targetUrl, normalizedAnchor, count, confidence } };
}

async function refreshRemovalBlocks(targetUrl, normalizedAnchor, pageUrl) {
  const insertedBlocks = [];
  if (pageUrl) {
    await insertBlockIfMissing({
      page_url: pageUrl,
      target_url: targetUrl,
      normalized_anchor: normalizedAnchor,
      scope: "page",
      reason: "removed-feedback",
    });
    insertedBlocks.push("page");
  }

  const removals = await fetchRows("internal_link_feedback", {
    select: "page_url",
    action: "eq.removed",
    target_url: `eq.${targetUrl}`,
    normalized_anchor: `eq.${normalizedAnchor}`,
  });
  const pages = new Set(removals.map((event) => event.page_url).filter(Boolean));
  if (pages.size >= 2) {
    await insertBlockIfMissing({
      target_url: targetUrl,
      normalized_anchor: normalizedAnchor,
      scope: "global",
      reason: "removed-feedback",
    });
    insertedBlocks.push("global");
  }
  return { blocks: insertedBlocks, distinctRemovalPages: pages.size };
}

async function recomputeDerivedRows(feedbackRows) {
  const feedback = normalizeFeedbackEvents(feedbackRows.map(dbFeedbackToRuntime));
  const positiveCounts = buildPositiveFeedbackCounts(feedback);
  const candidateRows = await fetchRows("internal_link_candidates", { select: "url" });
  const knownTargets = new Set(candidateRows.map((row) => row.url));
  const learnedRows = [];
  let skippedLearnedAnchors = 0;
  for (const entry of positiveCounts.values()) {
    if (!knownTargets.has(entry.targetUrl)) {
      skippedLearnedAnchors += 1;
      continue;
    }
    learnedRows.push({
      target_url: entry.targetUrl,
      anchor: entry.anchor,
      normalized_anchor: entry.normalizedAnchor,
      source: "learned",
      role: "Learned",
      confidence: entry.count >= 2 ? 0.8 : 0.55,
      search_volume: 0,
      traffic: 0,
      is_active: true,
    });
  }

  const feedbackBlocks = buildFeedbackBlocks(feedback);
  const blockRows = [];
  for (const key of feedbackBlocks.pageBlock) {
    const [pageUrl, targetUrl, normalizedAnchor] = key.split(KEY_SEPARATOR);
    blockRows.push({
      page_url: pageUrl,
      target_url: targetUrl,
      normalized_anchor: normalizedAnchor,
      scope: "page",
      reason: "removed-feedback",
    });
  }
  for (const key of feedbackBlocks.globalBlock) {
    const [normalizedAnchor, targetUrl] = key.split(KEY_SEPARATOR);
    blockRows.push({
      page_url: null,
      target_url: targetUrl,
      normalized_anchor: normalizedAnchor,
      scope: "global",
      reason: "removed-feedback",
    });
  }

  await deleteRows("internal_link_blocks", "reason=eq.removed-feedback");
  await batchUpsert("internal_link_anchors", learnedRows, "target_url,normalized_anchor,source");
  await batchInsert("internal_link_blocks", blockRows);

  return {
    learnedAnchors: learnedRows.length,
    skippedLearnedAnchors,
    blocks: blockRows.length,
  };
}

async function candidateExists(targetUrl) {
  const rows = await fetchRows("internal_link_candidates", {
    select: "url",
    url: `eq.${targetUrl}`,
  });
  return rows.length > 0;
}

async function insertBlockIfMissing(row) {
  const params = {
    select: "id",
    target_url: `eq.${row.target_url}`,
    normalized_anchor: `eq.${row.normalized_anchor}`,
    scope: `eq.${row.scope}`,
  };
  if (row.scope === "page") params.page_url = `eq.${row.page_url}`;
  const existing = await fetchRows("internal_link_blocks", params);
  if (existing.length > 0) return;
  await batchInsert("internal_link_blocks", [row]);
}

async function batchUpsert(table, rows, onConflict) {
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const chunk = rows.slice(index, index + BATCH_SIZE);
    const params = new URLSearchParams({ on_conflict: onConflict });
    await supabaseRequest(`${table}?${params}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: chunk,
    });
  }
}

async function batchInsertIgnore(table, rows, onConflict) {
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const chunk = rows.slice(index, index + BATCH_SIZE);
    const params = new URLSearchParams({ on_conflict: onConflict });
    await supabaseRequest(`${table}?${params}`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: chunk,
    });
  }
}

async function batchInsert(table, rows) {
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const chunk = rows.slice(index, index + BATCH_SIZE);
    await supabaseRequest(table, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: chunk,
    });
  }
}

async function deleteRows(table, queryString) {
  await supabaseRequest(`${table}?${queryString}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

async function fetchRows(table, params = {}) {
  const rows = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const search = new URLSearchParams(params);
    const page = await supabaseRequest(`${table}?${search}`, {
      headers: { Range: `${from}-${from + SUPABASE_PAGE_SIZE - 1}` },
    });
    if (!Array.isArray(page)) {
      throw new Error(`Expected array response from ${table}`);
    }
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }
  return rows;
}

async function supabaseRequest(path, options = {}) {
  requireSupabaseConfig();
  const url = new URL(path, `${supabaseUrl()}/rest/v1/`);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...(options.headers || {}),
  };
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase ${options.method || "GET"} ${url.pathname} failed (${response.status}): ${message}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}

function normalizeCandidate(candidate, positiveFeedbackCounts) {
  const url = candidate.url || "";
  const anchors = [];
  const seen = new Set();
  for (const anchor of candidate.anchors || []) {
    const normalized = anchor.normalized || anchor.normalized_anchor || normalizeAnchorText(anchor.text || anchor.anchor);
    if (!normalized) continue;
    const source = normalizeAnchorSource(anchor.source);
    const key = `${source}${KEY_SEPARATOR}${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const positive = positiveFeedbackCounts.get(anchorTargetKey(normalized, url));
    anchors.push({
      text: anchor.text || anchor.anchor || "",
      normalized,
      source,
      role: normalizeAnchorRole(anchor.role, source),
      search_volume: Number(anchor.search_volume || 0),
      traffic: Number(anchor.traffic || 0),
      confidence: Number(anchor.confidence || 0),
      positive_count: positive?.count || Number(anchor.positive_count || 0),
    });
  }

  for (const entry of positiveFeedbackCounts.values()) {
    if (entry.targetUrl !== url) continue;
    const key = `learned${KEY_SEPARATOR}${entry.normalizedAnchor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    anchors.push({
      text: entry.anchor,
      normalized: entry.normalizedAnchor,
      source: "learned",
      role: "Learned",
      search_volume: 0,
      traffic: 0,
      confidence: entry.count >= 2 ? 0.8 : 0.55,
      positive_count: entry.count,
    });
  }

  return {
    ...candidate,
    url,
    anchors,
    is_scope: Boolean(candidate.is_scope),
    has_keyword_data: Boolean(candidate.has_keyword_data),
    ytd_logged_out_sessions: Number(candidate.ytd_logged_out_sessions || candidate.sessions || 0),
    main_keywords: Array.isArray(candidate.main_keywords) ? candidate.main_keywords : [],
    tags: Array.isArray(candidate.tags) ? candidate.tags : [],
  };
}

function normalizeFeedbackEvents(feedback) {
  return (feedback || [])
    .map((event) => ({
      action: event.action === "removed" ? "removed" : "added",
      target_url: event.target_url || event.targetUrl || "",
      anchor: event.anchor || "",
      normalized_anchor:
        event.normalized_anchor || event.normalizedAnchor || event.normalized || normalizeAnchorText(event.anchor),
      page_url: event.page_url || event.pageUrl || "",
      page_slug: event.page_slug || event.pageSlug || "",
      source: normalizeFeedbackSource(event.source),
      context_html: event.context_html || event.contextHtml || null,
      created_at: event.created_at || event.at || null,
    }))
    .filter((event) => event.target_url && event.anchor && event.normalized_anchor);
}

function normalizeFeedbackInput(payload) {
  const action = payload?.action === "removed" ? "removed" : payload?.action === "added" ? "added" : "";
  const targetUrl = String(payload?.targetUrl || payload?.target_url || "").trim();
  const anchor = String(payload?.anchor || "").trim();
  if (!action) throw new Error("Expected action to be added or removed");
  if (!targetUrl) throw new Error("Expected non-empty targetUrl");
  if (!anchor) throw new Error("Expected non-empty anchor");
  const event = {
    action,
    page_url: String(payload?.pageUrl || payload?.page_url || "").trim() || null,
    page_slug: String(payload?.pageSlug || payload?.page_slug || "").trim() || null,
    target_url: targetUrl,
    anchor,
    normalized_anchor: normalizeAnchorText(anchor),
    source: normalizeFeedbackSource(payload?.source || "manual"),
    context_html: payload?.contextHtml || payload?.context_html || null,
  };
  return {
    ...event,
    feedback_key: feedbackIdempotencyKey(event),
  };
}

function buildPositiveFeedbackCounts(feedback) {
  const counts = new Map();
  for (const event of feedback || []) {
    if (event.action !== "added") continue;
    const key = anchorTargetKey(event.normalized_anchor, event.target_url);
    if (!counts.has(key)) {
      counts.set(key, {
        normalizedAnchor: event.normalized_anchor,
        targetUrl: event.target_url,
        anchor: event.anchor,
        count: 0,
        pages: new Set(),
      });
    }
    const entry = counts.get(key);
    entry.count += 1;
    if (event.page_url) entry.pages.add(event.page_url);
  }
  return counts;
}

function buildBlockSets(rows) {
  const pageBlock = new Set();
  const globalBlock = new Set();
  for (const row of rows || []) {
    const targetUrl = row.target_url || row.targetUrl || "";
    const normalizedAnchor = row.normalized_anchor || row.normalizedAnchor || "";
    if (!targetUrl || !normalizedAnchor) continue;
    if (row.scope === "global") {
      globalBlock.add(anchorTargetKey(normalizedAnchor, targetUrl));
    } else if (row.scope === "page" && row.page_url) {
      pageBlock.add(blockKey(row.page_url, targetUrl, normalizedAnchor));
    }
  }
  return { pageBlock, globalBlock };
}

function dbFeedbackToRuntime(row) {
  return {
    action: row.action,
    target_url: row.target_url,
    anchor: row.anchor,
    normalized_anchor: row.normalized_anchor,
    page_url: row.page_url || "",
    page_slug: row.page_slug || "",
    source: row.source || "manual",
    context_html: row.context_html || null,
    created_at: row.created_at || null,
  };
}

function feedbackSourceKey(event) {
  return [
    event.action || "",
    event.page_url || "",
    event.target_url || "",
    event.normalized_anchor || normalizeAnchorText(event.anchor),
    event.created_at || "",
  ].join(KEY_SEPARATOR);
}

function feedbackIdempotencyKey(event) {
  return [event.action || "", event.page_url || "", event.target_url || "", event.normalized_anchor || ""].join(
    KEY_SEPARATOR,
  );
}

async function fetchFeedbackByKey(feedbackKey) {
  const rows = await fetchRows("internal_link_feedback", {
    select: "*",
    feedback_key: `eq.${feedbackKey}`,
  });
  return rows[0] || null;
}

function normalizeAnchorSource(source) {
  return source === "explicit" || source === "keyword" || source === "learned" ? source : "fallback";
}

function normalizeAnchorRole(role, source) {
  if (role === "Explicit" || role === "Main" || role === "Supporting" || role === "Fallback" || role === "Learned") return role;
  if (source === "explicit") return "Explicit";
  return source === "learned" ? "Learned" : "Fallback";
}

function normalizeFeedbackSource(source) {
  return source === "auto" || source === "api" ? source : "manual";
}

function anchorTargetKey(normalizedAnchor, targetUrl) {
  return `${normalizedAnchor}${KEY_SEPARATOR}${targetUrl}`;
}

function blockKey(pageUrl, targetUrl, normalizedAnchor) {
  return `${pageUrl}${KEY_SEPARATOR}${targetUrl}${KEY_SEPARATOR}${normalizedAnchor}`;
}

function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function requireSupabaseConfig() {
  if (!hasSupabaseConfig()) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured");
  }
}

function supabaseUrl() {
  return String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function jsonFallbackEnabled() {
  const raw = String(process.env.INTERNAL_LINKING_ENABLE_JSON_FALLBACK || "").toLowerCase();
  return raw === "true" || raw === "1";
}
