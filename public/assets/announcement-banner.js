/**
 * announcement-banner.js
 *
 * Include on every page that already includes authguard.js, right after
 * a `<div id="announcementBanner"></div>` placeholder (on Home, that
 * placeholder sits below the brand marquee; everywhere else it sits
 * right below the topbar — see each page's own markup).
 *
 * Fetches GET /api/announcements (already filtered server-side to only
 * what's effectively active right now — see _shared/announcements.js)
 * and renders it as a dismissible reminder bar:
 *   - 0 active  -> renders nothing
 *   - 1 active  -> shown, static
 *   - 2+ active -> auto-rotates one at a time (see ROTATE_MS), with a
 *     "(2/3)" counter and small dots so it's clear more than one exists
 *
 * Dismiss (✕) is per-announcement and per-browser (localStorage), same
 * scope as threads.html's own "have I seen this" unread tracking — it
 * hides THAT announcement on THIS device only; other agents, and this
 * same agent on another device, still see it until it's turned off or
 * expires server-side. Re-checks every POLL_MS so a newly-published
 * announcement shows up without a page refresh.
 */
(function () {
  const POLL_MS = 60000;
  const DISMISSED_KEY = "dismissedAnnouncements";
  let rotateMs = 5000; // overwritten by the server's configured value once loaded — see Settings tab

  function getDismissed() {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]")); } catch { return new Set(); }
  }
  function dismiss(id) {
    const set = getDismissed();
    set.add(id);
    // Keep this list from growing forever — expired/deleted announcements
    // don't need to stay remembered, so cap it generously and drop the
    // oldest entries first.
    const arr = Array.from(set);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr.slice(-50)));
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  let items = [];
  let rotateIndex = 0;
  let rotateTimer = null;

  function paint() {
    const slot = document.getElementById("announcementBanner");
    if (!slot) return;
    clearInterval(rotateTimer);
    const dismissed = getDismissed();
    const visible = items.filter((a) => !dismissed.has(a.id));
    if (!visible.length) { slot.innerHTML = ""; return; }
    if (rotateIndex >= visible.length) rotateIndex = 0;

    const render = () => {
      const a = visible[rotateIndex];
      const counter = visible.length > 1 ? ` (${rotateIndex + 1}/${visible.length})` : "";
      const dots = visible.length > 1
        ? `<div class="announcement-banner-dots">${visible.map((_, i) => `<span class="${i === rotateIndex ? "on" : ""}"></span>`).join("")}</div>`
        : "";
      slot.innerHTML = `
        <div class="announcement-banner">
          <span class="announcement-banner-icon breathing">📢</span>
          <div class="announcement-banner-body">
            <div class="announcement-banner-label breathing">REMINDER${counter}</div>
            <div class="announcement-banner-text">${escapeHtml(a.text)}</div>
            ${dots}
          </div>
          <button type="button" class="announcement-banner-close" title="Dismiss">✕</button>
        </div>
      `;
      slot.querySelector(".announcement-banner-close").addEventListener("click", () => {
        dismiss(a.id);
        paint();
      });
    };
    render();
    if (visible.length > 1) {
      rotateTimer = setInterval(() => { rotateIndex = (rotateIndex + 1) % visible.length; render(); }, rotateMs);
    }
  }

  async function load() {
    try {
      const res = await window.AgentAuth.authFetch("/api/announcements", { cache: "no-store" });
      const data = await res.json();
      items = data.ok ? (data.announcements || []) : [];
      if (data.ok && Number.isFinite(data.rotateIntervalMs) && data.rotateIntervalMs > 0) rotateMs = data.rotateIntervalMs;
    } catch {
      // Network hiccup — leave whatever was already showing, try again next poll.
      return;
    }
    paint();
  }

  load();
  setInterval(load, POLL_MS);
  // Lets a page that just changed something (Save/Delete on
  // announcements.html, or the rotation-speed setting in the Settings
  // tab) refresh THIS device's banner immediately instead of waiting up
  // to POLL_MS — other agents still catch up on their own next poll.
  window.refreshAnnouncementBanner = load;
})();
