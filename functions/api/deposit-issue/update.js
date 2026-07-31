import { getAccessToken } from "../../_shared/googleOAuth.js";
import { verifyRequest } from "../../_shared/accounts.js";
import { PKR_BRANDS, getAllDepositSheetOverrides } from "../../_shared/depositSheets.js";

// Must match search.js's MODULE_SLOT and hardcoded Crickex default — see
// that file for the full explanation of the KV-override-over-code-default
// layering.
const MODULE_SLOT = "depositIssue";
const DEFAULT_CRICKEX_SHEET_ID = "1HByPuZMuuYZL9S5fPPGjb8RAmCwNVgKXvuLgVBbVM-E";
const EDITABLE_RANGE_COLS = "P:S"; // CS PIC, Player Contact No, Status CS, Correct UID

// Now that each brand can point at a different Sheet, the frontend has
// to tell us WHICH sheetId a given row came from (search.js already
// includes it on every result — see curDep.sheetId in deposit-issue.html).
// Rather than trusting that value blindly, check it's actually one of
// the currently-configured brand sheets before writing to it — a
// logged-in agent could otherwise point this at an arbitrary Sheet ID
// the OAuth account happens to have edit access to.
async function isKnownSheetId(env, sheetId) {
  if (sheetId === DEFAULT_CRICKEX_SHEET_ID) return true;
  const overrides = await getAllDepositSheetOverrides(env, MODULE_SLOT, PKR_BRANDS.map((b) => b.id));
  return Object.values(overrides).some((o) => o.sheetId === sheetId);
}

export async function onRequestPost(context) {
  try {
    return await handleUpdate(context);
  } catch (e) {
    return json({ ok: false, error: `Update failed: ${String(e && e.message || e)}` }, 500);
  }
}

async function handleUpdate({ request, env }) {
  const account = await verifyRequest(request, env);
  if (!account) return json({ ok: false, error: "Login required." }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const { sheetId, tabName, rowIndex, csPIC, playerContactNo, statusCS, correctUid } = body || {};
  if (!sheetId || !tabName || !rowIndex) {
    return json({ ok: false, error: "Missing sheetId, tabName, or rowIndex." }, 400);
  }
  if (!Number.isInteger(rowIndex) || rowIndex < 2) {
    return json({ ok: false, error: "Invalid rowIndex." }, 400);
  }
  if (!(await isKnownSheetId(env, sheetId))) {
    return json({ ok: false, error: "That Sheet isn't one of the currently configured Deposit Issue sheets — try searching again." }, 400);
  }

  const accessToken = await getAccessToken(env);
  const range = `'${tabName}'!${EDITABLE_RANGE_COLS.split(":")[0]}${rowIndex}:${EDITABLE_RANGE_COLS.split(":")[1]}${rowIndex}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      range,
      majorDimension: "ROWS",
      values: [[csPIC || "", playerContactNo || "", statusCS || "", correctUid || ""]],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return json({ ok: false, error: `Sheets API error: ${data.error?.message || res.status}` }, 502);
  }

  return json({ ok: true, updatedRange: data.updatedRange || range });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
