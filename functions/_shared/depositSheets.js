/**
 * depositSheets.js  (SERVER-ONLY)
 *
 * KV-backed overrides for which Google Sheet a "Deposit *" module reads
 * from — same layering pattern as routes.js (TG Group/Channel): a
 * hardcoded default lives in code, and this lets a SuperAdmin change it
 * live from the browser (the "Deposit Sheet Link" admin page) instead of
 * needing a code edit + redeploy every time the other department swaps
 * in a new Sheet.
 *
 * Stored in the same THREADS_KV namespace as accounts/offices/routes,
 * under its own key prefix:
 *   deposit-sheet:<slotId>  ->  { sheetId, tabNames: string[] }
 *
 * `slotId` is a stable identifier for WHICH module this sheet feeds —
 * "depositIssue" today. Deliberately keyed this way (not hardcoded to
 * one single value) so a future "Deposit Backup" module can register its
 * own slotId ("depositBackup", or one per brand/period if it ends up
 * needing several) without touching this file — see search.js/update.js
 * for how "depositIssue" is consumed today.
 */

function sheetKey(slotId) {
  return `deposit-sheet:${slotId}`;
}

// Accepts either a raw Sheet ID or a full Google Sheets URL (any of the
// usual forms: .../d/<id>/edit, .../d/<id>/edit#gid=0, .../d/<id>) and
// returns just the ID — so whoever's pasting this in doesn't have to
// manually trim the URL down first.
export function extractSheetId(input) {
  const trimmed = String(input || "").trim();
  const match = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // Not a URL — assume it's already a bare ID if it looks like one.
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  return "";
}

function parseConfig(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.sheetId) return null; // guard against malformed/emptied entry
    return {
      sheetId: String(parsed.sheetId),
      tabNames: Array.isArray(parsed.tabNames) && parsed.tabNames.length ? parsed.tabNames.map(String) : [],
    };
  } catch {
    return null;
  }
}

// Used at request time (search.js/update.js) — a single KV read, null if
// nothing's been overridden for this slot (caller falls back to its own
// hardcoded default).
export async function getDepositSheetOverride(env, slotId) {
  if (!env.THREADS_KV) return null;
  const raw = await env.THREADS_KV.get(sheetKey(slotId));
  return parseConfig(raw);
}

export async function saveDepositSheetOverride(env, slotId, { sheetUrlOrId, tabNames }) {
  const sheetId = extractSheetId(sheetUrlOrId);
  if (!sheetId) throw new Error("Couldn't find a Sheet ID in that link — paste the full Google Sheets URL or just the ID.");
  const cleanTabs = String(tabNames || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!cleanTabs.length) throw new Error("At least one tab name is required.");
  const value = { sheetId, tabNames: cleanTabs };
  await env.THREADS_KV.put(sheetKey(slotId), JSON.stringify(value));
  return value;
}

export async function deleteDepositSheetOverride(env, slotId) {
  await env.THREADS_KV.delete(sheetKey(slotId));
}
