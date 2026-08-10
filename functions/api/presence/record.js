/**
 * GET /api/presence/record?username=<u>&date=<yyyy-mm-dd>
 *
 * Backs the Record popover on the Active Agents page: one specific
 * agent's timeline for a given day (defaults to today) plus their last
 * 7 days rollup. Same canViewActiveAgents gate as list.js.
 */
import { authenticateStaff, ROLE_RANK, canViewActiveAgents, getAccount } from "../../_shared/accounts.js";
import { getDayTimeline, getLastNDays } from "../../_shared/presence.js";

export async function onRequestGet(context) {
  try {
    return await handle(context);
  } catch (e) {
    return json({ ok: false, error: `Unexpected server error: ${String((e && e.message) || e)}` }, 500);
  }
}

async function handle({ request, env }) {
  if (!env.THREADS_KV) return json({ ok: false, error: "THREADS_KV is not bound yet." }, 500);
  const auth = await authenticateStaff(request, env, ROLE_RANK.agent);
  if (!auth.ok || !auth.account) return json({ ok: false, error: "Not authorized." }, 401);
  if (!canViewActiveAgents(auth.account)) return json({ ok: false, error: "You don't have access to Active Agents." }, 403);

  const url = new URL(request.url);
  const username = (url.searchParams.get("username") || "").trim().toLowerCase();
  if (!username) return json({ ok: false, error: "Missing username." }, 400);

  const target = await getAccount(env, username);
  if (!target || target.role === "owner") return json({ ok: false, error: "Agent not found." }, 404);

  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: "Invalid date." }, 400);

  const [timeline, last7] = await Promise.all([getDayTimeline(env, username, date), getLastNDays(env, username, 7)]);

  return json({ ok: true, username, date, timeline, last7 });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
