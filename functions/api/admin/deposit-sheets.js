/**
 * /api/admin/deposit-sheets  ("Deposit Sheet Link" admin page)
 *
 *   GET
 *     -> { ok: true, slots: [{ id, name, sheetId, tabNames, isOverride }] }
 *        `isOverride: true` means it's a live KV override (edited through
 *        this page); `false` means it's still showing the hardcoded
 *        default baked into that module's own API file.
 *     Requires canSeeAdminSection(..., "depositSheets").
 *
 *   POST { action:"save", slotId, sheetUrlOrId, tabNames } -> store an
 *     override in THREADS_KV. `tabNames` is a comma-separated string
 *     (matches how it's typed in the form). Takes effect on the very
 *     next search/update against that module — no redeploy needed.
 *     Requires canEditAdminSection(..., "depositSheets").
 *
 *   POST { action:"reset", slotId } -> delete the override, reverting
 *     that module back to its hardcoded default.
 *     Requires canEditAdminSection(..., "depositSheets").
 *
 * DEFAULTS shown here (used only for the GET response's "isOverride:
 * false" fallback display) are hand-copied from each module's own
 * SHEET_ID/TAB_NAMES constants — see functions/api/deposit-issue/search.js.
 * Keep these two in sync if you ever change the hardcoded default there
 * directly instead of through this admin page.
 */
import { authenticateStaff, ROLE_RANK, canSeeAdminSection, canEditAdminSection } from "../../_shared/accounts.js";
import { getDepositSheetOverride, saveDepositSheetOverride, deleteDepositSheetOverride } from "../../_shared/depositSheets.js";

// One entry per Deposit-type module. Add a row here (and give the new
// module's search.js/update.js the same getDepositSheetOverride() lookup
// — see deposit-issue's for the pattern) when Deposit Backup is built.
const SLOTS = [
  {
    id: "depositIssue",
    name: "Deposit Issue",
    defaultSheetId: "1HByPuZMuuYZL9S5fPPGjb8RAmCwNVgKXvuLgVBbVM-E",
    defaultTabNames: ["CX PKR"],
  },
];

export async function onRequestGet(context) {
  try {
    return await handleGet(context);
  } catch (e) {
    return json({ ok: false, error: `Unexpected server error: ${String(e && e.message || e)}` }, 500);
  }
}

async function handleGet({ request, env }) {
  if (!env.THREADS_KV) return json({ ok: false, error: "THREADS_KV is not bound yet." }, 500);
  const auth = await authenticateStaff(request, env, ROLE_RANK.senior);
  if (!auth.ok) return json({ ok: false, error: "Not authorized." }, 401);
  if (!canSeeAdminSection(auth.account, "depositSheets")) {
    return json({ ok: false, error: "You don't have access to Deposit Sheet Link." }, 403);
  }

  const slots = [];
  for (const slot of SLOTS) {
    const override = await getDepositSheetOverride(env, slot.id);
    slots.push(
      override
        ? { id: slot.id, name: slot.name, sheetId: override.sheetId, tabNames: override.tabNames, isOverride: true }
        : { id: slot.id, name: slot.name, sheetId: slot.defaultSheetId, tabNames: slot.defaultTabNames, isOverride: false }
    );
  }
  return json({ ok: true, slots });
}

export async function onRequestPost(context) {
  try {
    return await handlePost(context);
  } catch (e) {
    return json({ ok: false, error: `Unexpected server error: ${String(e && e.message || e)}` }, 500);
  }
}

async function handlePost({ request, env }) {
  if (!env.THREADS_KV) return json({ ok: false, error: "THREADS_KV is not bound yet." }, 500);
  const auth = await authenticateStaff(request, env, ROLE_RANK.senior);
  if (!auth.ok) return json({ ok: false, error: "Not authorized." }, 401);
  if (!canEditAdminSection(auth.account, "depositSheets")) {
    return json({ ok: false, error: "You don't have Can-Edit access to Deposit Sheet Link." }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const slot = SLOTS.find((s) => s.id === body.slotId);
  if (!slot) return json({ ok: false, error: `Unknown slot "${body.slotId}".` }, 400);

  if (body.action === "save") {
    try {
      const saved = await saveDepositSheetOverride(env, slot.id, { sheetUrlOrId: body.sheetUrlOrId, tabNames: body.tabNames });
      return json({ ok: true, slot: { id: slot.id, name: slot.name, ...saved, isOverride: true } });
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 400);
    }
  }

  if (body.action === "reset") {
    await deleteDepositSheetOverride(env, slot.id);
    return json({ ok: true, slot: { id: slot.id, name: slot.name, sheetId: slot.defaultSheetId, tabNames: slot.defaultTabNames, isOverride: false } });
  }

  return json({ ok: false, error: `Unknown action "${body.action}".` }, 400);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
