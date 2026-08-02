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
 *   - 2+ active -> auto-rotates one at a time (interval from the
 *     Settings tab's rotation-speed control, default 5s), with a
 *     "(2/3)" counter and small dots so it's clear more than one exists.
 *     Rotating between two announcements fades the outgoing text out in
 *     place while the incoming one slides in as full text from the
 *     right (TRANSITION_MS) — no per-character typing, no page-load
 *     jump: the text wrap uses a CSS grid overlap (see style.css) so
 *     both messages share one auto-sized box instead of a fixed height.
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
  const TRANSITION_MS = 2200;
  const DISMISSED_KEY = "dismissedAnnouncements";
  let rotateMs = 6000; // overwritten by the server's configured value once loaded — see Settings tab

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

  let items = [];
  let visible = [];
  let rotateIndex = 0;
  let rotateTimer = null;

  // Builds the banner's DOM shell fresh — called whenever the visible
  // set changes (new data from a poll, or a dismiss). Rotation itself
  // (see showItem below) never rebuilds this, it only touches the two
  // text nodes inside it, which is what makes the slide transition
  // possible in the first place (a full innerHTML replace every tick
  // would just snap instantly, no transition to animate).
  function buildSkeleton(slot) {
    slot.innerHTML = `
      <div class="announcement-banner">
        <span class="announcement-banner-icon breathing">📢</span>
        <div class="announcement-banner-body">
          <div class="announcement-banner-label breathing">REMINDER<span id="annCounter"></span></div>
          <div class="announcement-banner-textwrap">
            <div class="announcement-banner-text" id="annTextA"></div>
            <div class="announcement-banner-text" id="annTextB"></div>
          </div>
          <div class="announcement-banner-dots" id="annDots"></div>
        </div>
        <button type="button" class="announcement-banner-close" title="Dismiss">✕</button>
      </div>
    `;
    slot.querySelector(".announcement-banner-close").addEventListener("click", () => {
      dismiss(visible[rotateIndex].id);
      paint();
    });
  }

  function renderDotsAndCounter(i) {
    const counterEl = document.getElementById("annCounter");
    if (counterEl) counterEl.textContent = visible.length > 1 ? ` (${i + 1}/${visible.length})` : "";
    const dotsEl = document.getElementById("annDots");
    if (dotsEl) {
      dotsEl.innerHTML = visible.length > 1
        ? visible.map((_, di) => `<span class="${di === i ? "on" : ""}"></span>`).join("")
        : "";
    }
  }

  // animate=false is used for the very first paint of a given skeleton
  // (nothing to transition FROM yet); animate=true is the actual
  // rotation tick — outgoing text fades out in place, incoming text
  // slides in as a complete block from the right.
  function showItem(i, animate) {
    rotateIndex = i;
    const a = visible[i];
    renderDotsAndCounter(i);
    const front = document.getElementById("annTextA");
    const back = document.getElementById("annTextB");
    if (!front || !back) return;
    if (!animate) {
      front.textContent = a.text;
      front.style.transition = "none"; front.style.opacity = "1"; front.style.transform = "none";
      back.style.opacity = "0"; back.style.transform = "translateX(50px)";
      return;
    }
    back.textContent = a.text;
    back.style.transition = "none";
    back.style.transform = "translateX(50px)";
    back.style.opacity = "0";
    requestAnimationFrame(() => {
      front.style.transition = `opacity ${TRANSITION_MS}ms ease`;
      front.style.opacity = "0";
      back.style.transition = `transform ${TRANSITION_MS}ms ease, opacity ${TRANSITION_MS}ms ease`;
      back.style.transform = "translateX(0)";
      back.style.opacity = "1";
    });
    setTimeout(() => {
      // Settle: A becomes the resting "front" copy again so the next
      // rotation always fades FROM a clean, non-transitioning element.
      front.textContent = a.text;
      front.style.transition = "none"; front.style.opacity = "1"; front.style.transform = "none";
      back.style.opacity = "0"; back.style.transform = "translateX(50px)";
    }, TRANSITION_MS + 20);
  }

  function paint() {
    const slot = document.getElementById("announcementBanner");
    if (!slot) return;
    clearInterval(rotateTimer);
    const dismissed = getDismissed();
    visible = items.filter((a) => !dismissed.has(a.id));
    if (!visible.length) { slot.innerHTML = ""; return; }
    if (rotateIndex >= visible.length) rotateIndex = 0;
    buildSkeleton(slot);
    showItem(rotateIndex, false);
    if (visible.length > 1) {
      rotateTimer = setInterval(() => {
        showItem((rotateIndex + 1) % visible.length, true);
      }, rotateMs);
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
