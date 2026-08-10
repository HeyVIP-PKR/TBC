/**
 * presence.js  (SERVER-ONLY)
 *
 * Backs the "Active Agents" feature — near-real-time online/inactive/
 * offline presence, plus a per-day timeline and a 7-day rollup, for
 * every logged-in agent. Deliberately a SEPARATE system from the
 * existing lightweight `lastActiveAt` field on accounts (see
 * touchLastActive() in accounts.js) — that one is explicitly throttled
 * to 5 minutes and documented as "not a real-time presence indicator";
 * this one is. Keeping them apart means neither has to compromise on
 * its own use case.
 *
 * DESIGN — heartbeat + timeout, not push:
 * The client (public/assets/presence-heartbeat.js) POSTs
 * /api/presence/heartbeat every 15s while logged in, reporting
 * "online" (tab visible) or "inactive" (tab hidden/switched away — via
 * the Page Visibility API, so this fires the instant a tab is switched,
 * not on the next heartbeat tick). If the browser is closed, crashes,
 * or loses network, no more heartbeats arrive — there is no way for a
 * dying client to reliably send a final "offline" signal, so OFFLINE IS
 * ALWAYS DERIVED, never reported: any read of presence data checks
 * whether the last heartbeat is older than OFFLINE_AFTER_MS and treats
 * it as offline if so, regardless of what status was last stored. This
 * is why every getX() below re-derives status instead of trusting the
 * stored value verbatim.
 *
 * STORAGE (all in THREADS_KV, same namespace as accounts/offices):
 *   presence:current:<username>        -> current snapshot (see shape below)
 *   presence:log:<username>:<yyyy-mm-dd> -> array of timeline segments for that day
 *   presence:daily:<username>:<yyyy-mm-dd> -> { totalOnlineSeconds, lastActiveAt }
 *     cached rollup, updated incrementally on each heartbeat so the
 *     Last 7 days table doesn't need to re-scan a full day's log on
 *     every read.
 *
 * A "segment" is one continuous stretch of a single status:
 *   { from: ISOString, to: ISOString|null, status, device, browser, os }
 * `to: null` means "still ongoing" — closed off (given a real `to`)
 * the moment the status changes, or read as "now" (or day-end, for a
 * past day) when displayed.
 */

const HEARTBEAT_INTERVAL_MS = 15000;
// Anything older than 3 missed heartbeats is treated as offline — long
// enough to absorb a slow network blip or a background-tab throttled
// timer, short enough that "online" stays meaningful.
const OFFLINE_AFTER_MS = HEARTBEAT_INTERVAL_MS * 3;

function pad2(n) { return String(n).padStart(2, "0"); }
function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function todayKey() { return dateKey(new Date()); }

function currentKey(username) { return `presence:current:${username.toLowerCase()}`; }
function logKey(username, date) { return `presence:log:${username.toLowerCase()}:${date}`; }
function dailyKey(username, date) { return `presence:daily:${username.toLowerCase()}:${date}`; }

async function getCurrent(env, username) {
  const raw = await env.THREADS_KV.get(currentKey(username));
  return raw ? JSON.parse(raw) : null;
}

async function getLog(env, username, date) {
  const raw = await env.THREADS_KV.get(logKey(username, date));
  return raw ? JSON.parse(raw) : [];
}

async function getDaily(env, username, date) {
  const raw = await env.THREADS_KV.get(dailyKey(username, date));
  return raw ? JSON.parse(raw) : { totalOnlineSeconds: 0, lastActiveAt: null };
}

/** Derives the effective status from a stored snapshot, applying the
 * offline timeout — this is the ONLY place "offline" gets decided. */
function deriveStatus(current, now = Date.now()) {
  if (!current) return "offline";
  const age = now - new Date(current.lastHeartbeat).getTime();
  if (age > OFFLINE_AFTER_MS) return "offline";
  return current.status; // "online" | "inactive"
}

/**
 * Called by POST /api/presence/heartbeat. `status` is "online" or
 * "inactive" (never "offline" — see the module note above). Closes the
 * previous timeline segment and opens a new one if the status (or
 * device/browser/os — e.g. the same person switching machines) changed
 * since the last heartbeat; otherwise just extends the ongoing segment
 * and bumps the daily online-seconds counter.
 */
export async function recordHeartbeat(env, username, { status, device, browser, os }) {
  if (status !== "online" && status !== "inactive") throw new Error("Invalid status.");
  const now = new Date();
  const nowIso = now.toISOString();
  const date = todayKey();

  const current = await getCurrent(env, username);
  const sameSegment = current
    && current.status === status
    && current.device === device
    && current.browser === browser
    && current.os === os
    && deriveStatus(current, now.getTime()) !== "offline"; // a timed-out gap always starts a fresh segment

  const log = await getLog(env, username, date);

  if (sameSegment) {
    // Extend the ongoing segment — nothing to close/open, just bump
    // lastHeartbeat on the snapshot and (if online) the daily total.
  } else {
    // Close whatever was open (if anything, and if it belongs to today —
    // a segment that started yesterday and is still "open" at midnight
    // is left for the day-boundary reconciliation in getRecord() to
    // split, not handled here to keep heartbeat writes cheap).
    if (log.length && log[log.length - 1].to === null) {
      log[log.length - 1].to = nowIso;
    }
    log.push({ from: nowIso, to: null, status, device, browser, os });
    await env.THREADS_KV.put(logKey(username, date), JSON.stringify(log));
  }

  const heartbeatSeconds = HEARTBEAT_INTERVAL_MS / 1000;
  if (status === "online") {
    const daily = await getDaily(env, username, date);
    daily.totalOnlineSeconds += heartbeatSeconds;
    daily.lastActiveAt = nowIso;
    await env.THREADS_KV.put(dailyKey(username, date), JSON.stringify(daily));
  }

  const fresh = { status, lastHeartbeat: nowIso, device, browser, os };
  await env.THREADS_KV.put(currentKey(username), JSON.stringify(fresh));
  return fresh;
}

/** One row for the main Active Agents list — current effective status
 * plus how long it's held and today's running total. `account` is the
 * already-loaded account record (role/officeId), passed in by the
 * caller so this module never has to import accounts.js itself. */
export async function getListRow(env, account) {
  const username = account.username;
  const current = await getCurrent(env, username);
  const now = Date.now();
  const status = deriveStatus(current, now);
  const since = current ? new Date(current.lastHeartbeat).getTime() : null; // approximation, see note below
  const daily = await getDaily(env, username, todayKey());
  return {
    username,
    role: account.role,
    officeId: account.officeId,
    status,
    device: current?.device || null,
    browser: current?.browser || null,
    os: current?.os || null,
    // "since" is deliberately the last HEARTBEAT time, not the segment
    // start — good enough for the list's "just now" / "6 mins ago"
    // display, which only needs recency, not exact segment duration
    // (that level of precision lives in the Record popover's timeline).
    statusSince: current ? current.lastHeartbeat : null,
    totalOnlineSecondsToday: Math.round(daily.totalOnlineSeconds),
    lastActiveAt: daily.lastActiveAt,
  };
}

/** Closes an "open" segment against `now` (or against the last instant
 * of a PAST day, at 23:59:59) so every segment in the returned list has
 * a real `to` — the raw KV log always has at most one open segment
 * (the most recent), everything else is already closed by
 * recordHeartbeat(). */
function closeOpenSegment(segments, date, now) {
  if (!segments.length) return segments;
  const last = segments[segments.length - 1];
  if (last.to !== null) return segments;
  const isToday = date === todayKey();
  const closedTo = isToday ? new Date(now).toISOString() : `${date}T23:59:59.999Z`;
  return [...segments.slice(0, -1), { ...last, to: closedTo }];
}

/** Today's (or a past day's) full timeline for one agent, newest
 * segment first, each with a computed duration in seconds. */
export async function getDayTimeline(env, username, date) {
  const raw = await getLog(env, username, date);
  const closed = closeOpenSegment(raw, date, Date.now());
  return closed
    .map((seg) => ({
      ...seg,
      durationSeconds: Math.max(0, Math.round((new Date(seg.to).getTime() - new Date(seg.from).getTime()) / 1000)),
    }))
    .reverse(); // newest first
}

/** Last N days (including today) of { date, totalOnlineSeconds,
 * lastActiveAt }, newest first. Today's row is read live (not yet
 * "closed"), past days come straight from their cached daily rollup. */
export async function getLastNDays(env, username, n = 7) {
  const out = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = dateKey(d);
    const daily = await getDaily(env, username, date);
    out.push({
      date,
      label: i === 0 ? "Today" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      totalOnlineSeconds: Math.round(daily.totalOnlineSeconds),
      lastActiveAt: daily.lastActiveAt,
    });
  }
  return out;
}
