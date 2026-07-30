import { getAccessToken } from "../../_shared/googleOAuth.js";
import { verifyRequest } from "../../_shared/accounts.js";
import { getDepositSheetOverride } from "../../_shared/depositSheets.js";

// Stable identifier for this module's slot in the "Deposit Sheet Link"
// admin page (Account Management → Deposit Sheet Link) — must match the
// `id` used in functions/api/admin/deposit-sheets.js's SLOTS array.
const SLOT_ID = "depositIssue";

/**
 * ══════════════════════════════════════════════════════════════════
 *  HARDCODED DEFAULTS — only used if nothing's been saved through the
 *  "Deposit Sheet Link" admin page yet. Once someone saves a link there,
 *  THAT value wins and these two are ignored — see resolveSheetConfig().
 * ══════════════════════════════════════════════════════════════════
 */
// The Sheet ID from the Gsheet's URL:
// https://docs.google.com/spreadsheets/d/<THIS PART>/edit
const SHEET_ID = "1HByPuZMuuYZL9S5fPPGjb8RAmCwNVgKXvuLgVBbVM-E";

// One tab name, or several if the data is split across tabs (e.g. by
// month). Every tab listed here gets searched on every request.
const TAB_NAMES = ["CX PKR"];

// Resolves the actual Sheet ID + tab names to use for this request:
// live KV override (set via the admin page) if one exists, otherwise
// the hardcoded defaults above.
async function resolveSheetConfig(env) {
  const override = await getDepositSheetOverride(env, SLOT_ID);
  return override ? { sheetId: override.sheetId, tabNames: override.tabNames } : { sheetId: SHEET_ID, tabNames: TAB_NAMES };
}

// Column layout confirmed from the real sheet (row 1 = headers, data
// starts row 2). If the department ever reorders columns, update here.
const COLS = {
  transactionId: "A",
  requestTime: "B",
  channel: "C",
  agentNumber: "D",
  username: "E",
  date: "F",
  imageLink: "G",
  transactionError: "H",
  statusPG: "I",
  cartId: "J",
  reference: "K",
  cashOutNumber: "L",
  amount: "M",
  supportPIC: "N",
  pg: "O",
  csPIC: "P",
  playerContactNo: "Q",
  statusCS: "R",
  correctUid: "S",
  playersCartId: "T",
  paymentStatus: "U",
  pytPsd: "V",
  remark: "W",
};
const LAST_COL = "W"; // must match the last key in COLS above
const MAX_RESULTS = 500;

// Same normalization promo-search.js uses — folds invisible differences
// (double spaces, stray whitespace, fullwidth punctuation) so a tab name
// that LOOKS identical to the human eye still matches.
function normalizeTabName(name) {
  return String(name).normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

// Sheet's real tab titles rarely change — cache per Worker isolate for a
// few minutes instead of re-fetching metadata on every search. Keyed by
// sheetId so the cache self-invalidates if the admin page points this
// module at a different Sheet.
let cachedTabTitles = null; // { sheetId, titles, expiresAt }
const TAB_CACHE_MS = 5 * 60 * 1000;

async function resolveExistingTabs(accessToken, sheetId) {
  const now = Date.now();
  if (cachedTabTitles && cachedTabTitles.sheetId === sheetId && cachedTabTitles.expiresAt > now) return cachedTabTitles.titles;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Could not read sheet tab list: ${data.error?.message || res.status}`);
  const titles = (data.sheets || []).map((s) => s.properties.title);
  cachedTabTitles = { sheetId, titles, expiresAt: now + TAB_CACHE_MS };
  return titles;
}

export async function onRequestPost(context) {
  try {
    return await handleSearch(context);
  } catch (e) {
    return json({ ok: false, error: `Search failed: ${String(e && e.message || e)}` }, 500);
  }
}

async function handleSearch({ request, env }) {
  // Same gate every other protected endpoint uses (see submit.js) — requires
  // a valid X-Agent-Token from a logged-in, non-locked account whose office
  // IP still matches. The frontend's authguard.js/authFetch() already
  // attaches this header automatically.
  const account = await verifyRequest(request, env);
  if (!account) return json({ ok: false, error: "Login required." }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const raw = (body && body.query || "").trim();
  if (!raw) return json({ ok: false, error: "Missing query." }, 400);

  // Same comma/newline-separated multi-query parsing as the rest of the hub.
  const queries = raw.split(/[\n,]+/).map((q) => q.trim()).filter(Boolean).map((q) => q.toLowerCase());
  if (!queries.length) return json({ ok: false, error: "No valid search terms." }, 400);

  const accessToken = await getAccessToken(env);
  const { sheetId, tabNames } = await resolveSheetConfig(env);

  // Resolve configured tab names against what actually exists on the
  // sheet — a mistyped/renamed tab becomes a warning in the response
  // instead of a silent "0 results".
  let realTitles;
  try {
    realTitles = await resolveExistingTabs(accessToken, sheetId);
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 502);
  }
  const realByNormalized = new Map(realTitles.map((t) => [normalizeTabName(t), t]));
  const tabsToQuery = []; // real title strings only
  const missingTabs = [];
  for (const configured of tabNames) {
    const real = realByNormalized.get(normalizeTabName(configured));
    if (real) tabsToQuery.push(real);
    else missingTabs.push(configured);
  }

  const results = [];

  for (const tab of tabsToQuery) {
    if (results.length >= MAX_RESULTS) break;
    const range = `'${tab.replace(/'/g, "''")}'!A2:${LAST_COL}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Sheets API error reading "${tab}": ${data.error?.message || res.status}`);
    }
    const rows = data.values || [];
    rows.forEach((row, i) => {
      if (results.length >= MAX_RESULTS) return;
      const get = (colLetter) => row[colIndex(colLetter)] || "";
      const transactionId = get(COLS.transactionId);
      const reference = get(COLS.reference);
      const username = get(COLS.username);
      const agentNumber = get(COLS.agentNumber);
      // Match if ANY query is a substring of Transaction ID, Reference,
      // Username, or Agent Number.
      const haystack = (transactionId + " " + reference + " " + username + " " + agentNumber).toLowerCase();
      const isMatch = queries.some((q) => haystack.includes(q));
      if (!isMatch) return;

      results.push({
        sheetName: "PKR Deposit Support", // adjust label shown in the UI if you want
        tabName: tab,
        sheetId,
        rowIndex: i + 2, // actual row number in the sheet (header is row 1)
        transaction: transactionId,
        requestTime: get(COLS.requestTime),
        channel: get(COLS.channel),
        agentNumber: get(COLS.agentNumber),
        username: get(COLS.username),
        date: get(COLS.date),
        imageLink: get(COLS.imageLink),
        transactionError: get(COLS.transactionError),
        statusPG: get(COLS.statusPG),
        cartId: get(COLS.cartId),
        reference,
        cashOutNumber: get(COLS.cashOutNumber),
        amount: get(COLS.amount),
        supportPIC: get(COLS.supportPIC),
        pg: get(COLS.pg),
        csPIC: get(COLS.csPIC),
        playerContactNo: get(COLS.playerContactNo),
        statusCS: get(COLS.statusCS),
        correctUid: get(COLS.correctUid),
        playersCartId: get(COLS.playersCartId),
        paymentStatus: get(COLS.paymentStatus),
      });
    });
  }

  return json({
    ok: true,
    results,
    missingTabs: missingTabs.length ? missingTabs : undefined,
    // Only included when something's misconfigured — lets you see the
    // sheet's real tab names without opening the sheet.
    actualSheetTabs: missingTabs.length ? realTitles : undefined,
  });
}

// Converts a column letter like "P" to a 0-based array index (15).
function colIndex(letter) {
  let n = 0;
  for (let i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
  return n - 1;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
