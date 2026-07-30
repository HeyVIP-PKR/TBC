import { getAccessToken } from "../../_shared/googleOAuth.js";
import { verifyRequest } from "../../_shared/accounts.js";
import { getDepositSheetOverride } from "../../_shared/depositSheets.js";

// Must match search.js's SLOT_ID and hardcoded default — see that file
// for the full explanation of the KV-override-over-code-default layering.
const SLOT_ID = "depositIssue";
const SHEET_ID = "1HByPuZMuuYZL9S5fPPGjb8RAmCwNVgKXvuLgVBbVM-E";
const EDITABLE_RANGE_COLS = "P:S"; // CS PIC, Player Contact No, Status CS, Correct UID

async function resolveSheetId(env) {
  const override = await getDepositSheetOverride(env, SLOT_ID);
  return override ? override.sheetId : SHEET_ID;
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

  const { tabName, rowIndex, csPIC, playerContactNo, statusCS, correctUid } = body || {};
  if (!tabName || !rowIndex) {
    return json({ ok: false, error: "Missing tabName or rowIndex." }, 400);
  }
  if (!Number.isInteger(rowIndex) || rowIndex < 2) {
    return json({ ok: false, error: "Invalid rowIndex." }, 400);
  }

  const accessToken = await getAccessToken(env);
  const sheetId = await resolveSheetId(env);
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
