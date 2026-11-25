#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const artifactToolPath = require.resolve("@oai/artifact-tool");
const { SpreadsheetFile, Workbook } = await import(artifactToolPath);

const [inputPath, outputPath, previewDir] = process.argv.slice(2);
if (!inputPath || !outputPath || !previewDir) {
  throw new Error(
    "Usage: build_workbook.mjs <workbook-data.json> <output.xlsx> <preview-dir>",
  );
}

const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
const workbook = Workbook.create();
const titleFill = "#F2E7FE";
const titleFont = "#3B1261";
const headerFill = "#7D2AE8";
const headerFont = "#FFFFFF";
const borderColor = "#DDD6E5";

const labels = {
  additional_public_emails: "Additional Public Emails",
  audit_status: "Audit Status",
  auditor_notes: "Auditor Notes",
  auto_generated_subtitle_languages: "Auto-generated Subtitle Languages",
  canonical_video_url: "Canonical Video URL",
  channel_about_status: "Channel About Status",
  channel_id: "Channel ID",
  channel_links_status: "Channel Links Status",
  channel_logo: "Channel Logo",
  channel_name: "Channel Name",
  channel_subscribers: "Channel Subscribers",
  channel_subscribers_displayed: "Displayed Subscribers",
  channel_total_views: "Channel Total Views",
  channel_url: "Channel URL",
  enrichment_error: "Enrichment Error",
  enrichment_status: "Enrichment Status",
  executed_query: "Executed Query",
  feature_position: "Feature Position",
  google_best_rank_absolute: "Best Google Rank Absolute",
  google_result_language: "Google Result Language",
  google_result_languages: "Google Result Languages",
  google_serp_occurrences: "Google SERP Occurrences",
  instagram: "Instagram",
  is_embeddable: "Embeddable",
  is_live: "Live",
  joined_date: "Channel Join Date",
  language_qualification: "Language Qualification",
  linkedin: "LinkedIn",
  matched_queries: "Matched Queries",
  matched_query_count: "Matched Query Count",
  non_vietnamese_video_count: "Non-Vietnamese Video Count",
  other_links: "Other Links",
  public_video_count: "Public Video Count",
  public_email_count: "Public Email Count",
  public_emails: "Public Emails",
  query_ranks: "Query Ranks",
  rank_absolute: "Rank Absolute",
  rank_group: "Rank Group",
  ranking_video_count: "Ranking Video Count",
  ranking_video_urls: "Ranking Video URLs",
  raw_url: "Raw URL",
  search_language_code: "Search Language Code",
  search_location_code: "Search Location Code",
  serp_item_type: "SERP Item Type",
  subtitle_languages: "Subtitle Languages",
  tiktok: "TikTok",
  twitter_x: "Twitter / X",
  url: "URL",
  unknown_language_video_count: "Unknown Language Video Count",
  recipient_email: "Recipient Email",
  video_comments: "Video Comments",
  video_id: "Video ID",
  video_language_status: "Video Language Status",
  video_language_statuses: "Video Language Statuses",
  video_likes: "Video Likes",
  video_priority_within_channel: "Video Priority Within Channel",
  video_tags: "Video Tags",
  video_title: "Video Title",
  video_url: "Video URL",
  video_views: "Video Views",
  vietnamese_caption_video_count: "Vietnamese Caption Video Count",
  vietnamese_spoken_video_count: "Vietnamese Spoken Video Count",
};

const urlColumns = new Set([
  "canonical_video_url",
  "channel_logo",
  "channel_url",
  "facebook",
  "instagram",
  "linkedin",
  "raw_url",
  "tiktok",
  "twitter_x",
  "url",
  "video_url",
  "website",
]);
const integerColumns = new Set([
  "channel_subscribers",
  "channel_total_views",
  "duration_time_seconds",
  "feature_position",
  "google_best_rank_absolute",
  "google_serp_occurrences",
  "matched_query_count",
  "non_vietnamese_video_count",
  "public_email_count",
  "public_video_count",
  "rank_absolute",
  "rank_group",
  "ranking_video_count",
  "unknown_language_video_count",
  "video_comments",
  "video_likes",
  "video_priority_within_channel",
  "video_views",
  "vietnamese_caption_video_count",
  "vietnamese_spoken_video_count",
]);
const dateColumns = new Set(["joined_date"]);
const wrapColumns = new Set([
  "additional_public_emails",
  "auditor_notes",
  "description",
  "enrichment_error",
  "matched_queries",
  "other_links",
  "public_emails",
  "query_ranks",
  "rationale",
  "video_language_statuses",
]);

function columnName(columnCount) {
  let value = columnCount;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function displayLabel(column) {
  if (labels[column]) return labels[column];
  return column
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function widthFor(column) {
  if (urlColumns.has(column)) return 52;
  if (wrapColumns.has(column)) return 42;
  if (integerColumns.has(column)) return 16;
  if (dateColumns.has(column)) return 16;
  if (column === "channel_name") return 28;
  if (column === "title" || column === "video_title") return 42;
  if (column === "recipient_email") return 30;
  if (column === "audit_status") return 18;
  if (column === "auditor_notes") return 34;
  if (column.includes("status") || column.includes("qualification")) return 24;
  if (column.includes("query")) return 34;
  if (column.includes("language")) return 28;
  if (column.endsWith("_id")) return 22;
  return 20;
}

for (const sheetData of payload.sheets) {
  const sheet = workbook.worksheets.add(sheetData.name);
  sheet.showGridLines = false;
  const columns = sheetData.columns;
  const lastColumn = columnName(Math.max(columns.length, 1));
  const titleLastColumn = columnName(Math.min(Math.max(columns.length, 1), 12));

  sheet.getRange(`A1:${lastColumn}1`).format.fill = titleFill;
  sheet.getRange(`A1:${titleLastColumn}1`).merge();
  sheet.getRange("A1").values = [[`${payload.title}: ${sheetData.name}`]];
  sheet.getRange(`A1:${titleLastColumn}1`).format = {
    font: { bold: true, color: titleFont, size: 14 },
    rowHeight: 30,
    verticalAlignment: "center",
  };
  sheet.getRange(`A2:${titleLastColumn}2`).merge();
  sheet.getRange("A2").values = [[
    `Target: ${payload.target_url} | Generated: ${payload.generated_at}`,
  ]];
  sheet.getRange(`A2:${titleLastColumn}2`).format = {
    font: { color: "#5C5962", italic: true },
    rowHeight: 22,
    verticalAlignment: "center",
  };

  if (!columns.length) {
    sheet.getRange("A4").values = [["No data"]];
    continue;
  }

  const displayHeaders = columns.map(displayLabel);
  const matrix = [
    displayHeaders,
    ...sheetData.rows.map((row) =>
      columns.map((column) => row[column] ?? "")
    ),
  ];
  const dataRange = sheet.getRangeByIndexes(
    3,
    0,
    matrix.length,
    columns.length,
  );
  dataRange.values = matrix;
  dataRange.format.verticalAlignment = "top";
  dataRange.format.borders = {
    preset: "inside",
    style: "thin",
    color: borderColor,
  };
  const header = sheet.getRangeByIndexes(3, 0, 1, columns.length);
  header.format = {
    fill: headerFill,
    font: { bold: true, color: headerFont },
    rowHeight: 30,
    verticalAlignment: "center",
    wrapText: true,
  };
  const table = sheet.tables.add(
    dataRange,
    true,
    `${sheetData.name.replaceAll(" ", "")}Table`,
  );
  table.style = "TableStyleMedium4";
  table.showFilterButton = true;
  sheet.freezePanes.freezeRows(4);
  sheet.freezePanes.freezeColumns(1);

  if (matrix.length > 1) {
    const body = sheet.getRangeByIndexes(
      4,
      0,
      matrix.length - 1,
      columns.length,
    );
    body.format.rowHeight = columns.some((column) => wrapColumns.has(column))
      ? 42
      : 22;
    body.format.wrapText = false;
  }

  columns.forEach((column, index) => {
    const columnRange = sheet.getRangeByIndexes(
      3,
      index,
      matrix.length,
      1,
    );
    columnRange.format.columnWidth = widthFor(column);
    if (urlColumns.has(column) && matrix.length > 1) {
      sheet.getRangeByIndexes(
        4,
        index,
        matrix.length - 1,
        1,
      ).format.font = { color: "#1A73E8", underline: true };
    }
    if (integerColumns.has(column) && matrix.length > 1) {
      sheet.getRangeByIndexes(
        4,
        index,
        matrix.length - 1,
        1,
      ).format.numberFormat = "#,##0";
    }
    if (dateColumns.has(column) && matrix.length > 1) {
      sheet.getRangeByIndexes(
        4,
        index,
        matrix.length - 1,
        1,
      ).format.numberFormat = "yyyy-mm-dd";
    }
    if (wrapColumns.has(column) && matrix.length > 1) {
      sheet.getRangeByIndexes(
        4,
        index,
        matrix.length - 1,
        1,
      ).format.wrapText = true;
    }
  });
}

for (const sheetData of payload.sheets) {
  if (!sheetData.columns.length) continue;
  const inspected = await workbook.inspect({
    kind: "table",
    sheetId: sheetData.name,
    range: `A1:${columnName(sheetData.columns.length)}${Math.min(
      sheetData.rows.length + 4,
      10,
    )}`,
    include: "values,formulas",
    tableMaxRows: 10,
    tableMaxCols: Math.min(sheetData.columns.length, 12),
  });
  console.log(inspected.ndjson);
}

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(formulaErrors.ndjson);

await fs.mkdir(previewDir, { recursive: true });
for (const sheetData of payload.sheets) {
  const columnCount = Math.max(sheetData.columns.length, 1);
  const preview = await workbook.render({
    sheetName: sheetData.name,
    range: `A1:${columnName(Math.min(columnCount, 12))}${Math.min(
      sheetData.rows.length + 4,
      24,
    )}`,
    scale: 1,
    format: "png",
  });
  await fs.writeFile(
    path.join(previewDir, `${sheetData.name.replaceAll(" ", "-")}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

const readmePath = path.join(path.dirname(outputPath), "readme.md");
try {
  const readme = await fs.readFile(readmePath, "utf8");
  const status = `- Status: workbook built at ${new Date().toISOString()}`;
  const updated = /^- Status: .*$/m.test(readme)
    ? readme.replace(/^- Status: .*$/m, status)
    : `${readme.trimEnd()}\n${status}\n`;
  await fs.writeFile(readmePath, updated, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
