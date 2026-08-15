/**
 * /api/admin/issue-submission-sheets  ("Issue Submission Gsheet" admin
 * page, under Integration Portal)
 *
 * Same brand x module grid shape as /api/admin/routes (TG Group/
 * Channel) — one row per (brand, issue-submission module) pair, each
 * independently overridable with its own Sheet URL/ID + Tab name.
 *
 *   GET
 *     -> { brands: [{id,name}], modules: [{id,name,emoji}],
 *          sheets: { "<brandId>|<moduleId>": {sheetId,tabName,isOverride} } }
 *        `isOverride: true` means it's a live KV override (edited
 *        through this page); `false` means it's still showing the
 *        hardcoded default (BRANDS[brandId].sheetId +
 *        SHEET_LAYOUT[moduleId].tab from _shared/routing.js).
 *     Requires canSeeAdminSection(..., "issueSubmissionSheet").
 *
 *   POST { action:"save", brandId, moduleId, sheetUrlOrId, tabName } ->
 *     store an override in THREADS_KV. Takes effect on the very next
 *     form submission for that brand+module — no redeploy needed.
 *     Requires canEditAdminSection(..., "issueSubmissionSheet").
 *
 *   POST { action:"reset", brandId, moduleId } -> delete the override,
 *     reverting that brand+module back to the hardcoded default.
 *     Requires canEditAdminSection(..., "issueSubmissionSheet").
 *
 * See functions/_shared/issueSubmissionSheets.js for the KV layer, and
 * functions/api/submit.js for where the override is actually consulted
 * at submission time.
 */
import { authenticateStaff, ROLE_RANK, canSeeAdminSection, canEditAdminSection } from "../../_shared/accounts.js";
import { getAllIssueSheetOverrides, saveIssueSheetOverride, deleteIssueSheetOverride } from "../../_shared/issueSubmissionSheets.js";
import { BRANDS, MODULE_META, SHEET_LAYOUT } from "../../_shared/routing.js";

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
  if (!canSeeAdminSection(auth.account, "issueSubmissionSheet")) {
    return json({ ok: false, error: "You don't have access to Issue Submission Gsheet." }, 403);
  }

  const brandIds = Object.keys(BRANDS);
  // Promotion Request is deliberately excluded from this grid — its
  // sheet is chosen per (brand, promotion type) via the separate
  // PROMOTION_SHEET_CONFIG in routing.js, not a single per-brand default
  // like the other 6 modules. It has no SHEET_LAYOUT entry at all for
  // that reason — see submit.js's own comment on this same exclusion.
  const moduleIds = Object.keys(SHEET_LAYOUT);
  const overrides = await getAllIssueSheetOverrides(env, brandIds, moduleIds);

  const brands = brandIds.map((id) => ({ id, name: BRANDS[id].name }));
  const modules = moduleIds.map((id) => ({ id, name: MODULE_META[id].name, emoji: MODULE_META[id].emoji }));

  const sheets = {};
  for (const brandId of brandIds) {
    for (const moduleId of moduleIds) {
      const key = `${brandId}|${moduleId}`;
      const override = overrides[key];
      if (override) {
        sheets[key] = { sheetId: override.sheetId, tabName: override.tabName, isOverride: true };
      } else {
        sheets[key] = { sheetId: BRANDS[brandId].sheetId || "", tabName: SHEET_LAYOUT[moduleId]?.tab || "", isOverride: false };
      }
    }
  }

  return json({ ok: true, brands, modules, sheets });
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
  if (!canEditAdminSection(auth.account, "issueSubmissionSheet")) {
    return json({ ok: false, error: "You don't have Can-Edit access to Issue Submission Gsheet." }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const { brandId, moduleId } = body || {};
  if (!BRANDS[brandId]) return json({ ok: false, error: `Unknown brand "${brandId}".` }, 400);
  if (!SHEET_LAYOUT[moduleId]) return json({ ok: false, error: `Unknown or unsupported module "${moduleId}".` }, 400);

  if (body.action === "save") {
    try {
      const saved = await saveIssueSheetOverride(env, brandId, moduleId, { sheetUrlOrId: body.sheetUrlOrId, tabName: body.tabName });
      return json({ ok: true, sheet: { ...saved, isOverride: true } });
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 400);
    }
  }

  if (body.action === "reset") {
    await deleteIssueSheetOverride(env, brandId, moduleId);
    return json({ ok: true, sheet: { sheetId: BRANDS[brandId].sheetId || "", tabName: SHEET_LAYOUT[moduleId]?.tab || "", isOverride: false } });
  }

  return json({ ok: false, error: `Unknown action "${body.action}".` }, 400);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
