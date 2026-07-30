import { getAccessToken } from "../../_shared/googleOAuth.js";
import { verifyRequest } from "../../_shared/accounts.js";

/**
 * ══════════════════════════════════════════════════════════════════
 *  FILL THESE IN before deploying — see PROJECT_STATUS / README notes
 * ══════════════════════════════════════════════════════════════════
 */
// The Sheet ID from the Gsheet's URL:
// https://docs.google.com/spreadsheets/d/<THIS PART>/edit
const SHEET_ID = "1HByPuZMuuYZL9S5fPPGjb8RAmCwNVgKXvuLgVBbVM-E";

// One tab name, or several if the data is split across tabs (e.g. by
// month). Every tab listed here gets searched on every request.
const TAB_NAMES = ["CX PKR"];

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
  const results = [];

  for (const tab of TAB_NAMES) {
    if (results.length >= MAX_RESULTS) break;
    const range = `'${tab}'!A2:${LAST_COL}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`;
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
        sheetId: SHEET_ID,
        rowIndex: i + 2, // actual row number in the sheet (header is row 1)
        transaction: transactionId,
        requestTime: get(COLS.requestTime),
        channel: get(COLS.channel),
        agentNumber: get(COLS.agentNumber),
        username: get(COLS.username),
        date: get(COLS.date),
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
      });
    });
  }

  return json({ ok: true, results });
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
