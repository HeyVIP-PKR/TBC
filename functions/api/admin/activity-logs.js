/**
 * /api/admin/activity-logs — the Activity Logs audit-trail page's API.
 *
 *   GET -> { ok: true, entries: [{ts,category,action,agent,detail,ip}, ...] }
 *     Newest first, up to 1000 entries (see listActivityLog() in
 *     _shared/activityLog.js — 90-day retention, swept opportunistically).
 *
 * Gated by canViewActivityLogs() (_shared/accounts.js) — a flat,
 * per-account, Owner-only-by-default boolean, NOT the rank-tiered
 * ADMIN_SECTIONS mechanism every other admin page uses. Same treatment as
 * canViewActiveAgents(): no rank gets this for free, not even SuperAdmin,
 * and only Owner can grant it (functions/api/admin/accounts.js). The
 * front-end's canSeeAdminSection()-style sidebar check is only the "hide
 * the entry point" half — this server-side check is what's actually
 * enforced; a request straight to this endpoint without the flag is
 * rejected the same as if the account didn't exist.
 */
import { authenticateStaff, ROLE_RANK, canViewActivityLogs } from "../../_shared/accounts.js";
import { listActivityLog } from "../../_shared/activityLog.js";

export async function onRequestGet(context) {
  try {
    return await handleGet(context);
  } catch (e) {
    return json({ ok: false, error: `Unexpected server error: ${String(e && e.message || e)}` }, 500);
  }
}

async function handleGet({ request, env }) {
  if (!env.THREADS_KV) return json({ ok: false, error: "THREADS_KV is not bound yet." }, 500);
  // Lowest possible auth floor (agent) — canViewActivityLogs() below is
  // what actually gates this, same pattern as Active Agents.
  const auth = await authenticateStaff(request, env, ROLE_RANK.agent);
  if (!auth.ok) return json({ ok: false, error: "Not authorized." }, 401);
  if (!canViewActivityLogs(auth.account)) {
    return json({ ok: false, error: "You don't have access to Activity Logs." }, 403);
  }

  const entries = await listActivityLog(env, { limit: 1000 });
  return json({ ok: true, entries });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
