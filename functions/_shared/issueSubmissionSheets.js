/**
 * issueSubmissionSheets.js  (SERVER-ONLY)
 *
 * KV-backed overrides for WHICH Google Sheet (and which tab within it)
 * each brand's issue-submission modules (QA, Account Issue, Withdraw
 * Issue, Risk Issue, Promotion Request, Daily Report, Genie Issue) write
 * to — same brand x module grid shape as routes.js (TG Group/Channel),
 * just storing {sheetId, tabName} instead of {chatId, topicId}.
 *
 * Hardcoded default underneath: today every module for a given brand
 * shares ONE spreadsheet (BRANDS[brandId].sheetId in _shared/routing.js)
 * with a FIXED tab name per module (SHEET_LAYOUT[moduleId].tab — same
 * tab name across every brand, e.g. "QA OTP & Domain"). This lets a
 * SuperAdmin/Owner point any individual brand+module combination at a
 * completely different spreadsheet/tab live from the browser (the
 * "Issue Submission Gsheet" admin page, under Integration Portal)
 * instead of needing a code edit + redeploy.
 *
 * Stored in the same THREADS_KV namespace as accounts/offices/routes,
 * under its own key prefix:
 *   issue-sheet:<brandId>:<moduleId>  ->  { sheetId, tabName }
 *
 * submit.js checks getIssueSheetOverride() first; if nothing is stored
 * for a given brand+module, it falls back to the hardcoded
 * BRANDS[brandId].sheetId + SHEET_LAYOUT[moduleId].tab exactly as
 * before — so turning this on with an empty KV changes nothing that
 * already works, same guarantee every other KV-override feature in this
 * project makes.
 */
import { extractSheetId } from "./depositSheets.js";

function sheetKey(brandId, moduleId) {
  return `issue-sheet:${brandId}:${moduleId}`;
}

function parseEntry(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.sheetId || !parsed.tabName) return null; // guard against malformed/emptied entry
    return { sheetId: String(parsed.sheetId), tabName: String(parsed.tabName) };
  } catch {
    return null;
  }
}

// Used at submission time (functions/api/submit.js) — a single KV read,
// null if nothing overridden for this brand+module (caller falls back
// to the hardcoded BRANDS/SHEET_LAYOUT default).
export async function getIssueSheetOverride(env, brandId, moduleId) {
  if (!env.THREADS_KV) return null;
  const raw = await env.THREADS_KV.get(sheetKey(brandId, moduleId));
  return parseEntry(raw);
}

// Fetches every brand x module override in one batch — used by the
// admin GET endpoint to render the full grid. 9 brands x 7 modules = 63
// reads, well within free-tier limits for a page only opened
// occasionally by a SuperAdmin — same trade-off routes.js's
// getAllRouteOverrides() already makes.
export async function getAllIssueSheetOverrides(env, brandIds, moduleIds) {
  if (!env.THREADS_KV) return {};
  const pairs = [];
  for (const brandId of brandIds) {
    for (const moduleId of moduleIds) pairs.push([brandId, moduleId]);
  }
  const raws = await Promise.all(pairs.map(([b, m]) => env.THREADS_KV.get(sheetKey(b, m))));
  const result = {};
  pairs.forEach(([brandId, moduleId], i) => {
    const parsed = parseEntry(raws[i]);
    if (parsed) result[`${brandId}|${moduleId}`] = parsed;
  });
  return result;
}

export async function saveIssueSheetOverride(env, brandId, moduleId, { sheetUrlOrId, tabName }) {
  const sheetId = extractSheetId(sheetUrlOrId);
  if (!sheetId) throw new Error("Couldn't find a Sheet ID in that link — paste the full Google Sheets URL or just the ID.");
  const trimmedTab = String(tabName || "").trim();
  if (!trimmedTab) throw new Error("Tab name is required.");
  const value = { sheetId, tabName: trimmedTab };
  await env.THREADS_KV.put(sheetKey(brandId, moduleId), JSON.stringify(value));
  return value;
}

export async function deleteIssueSheetOverride(env, brandId, moduleId) {
  await env.THREADS_KV.delete(sheetKey(brandId, moduleId));
}
