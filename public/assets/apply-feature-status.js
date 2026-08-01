/**
 * Client-side "gray out + badge + block click" for any card/link whose
 * feature is currently Maintenance/Coming soon. Pair with
 * feature-status.css. This is UX only — the real enforcement happens
 * server-side in submit.js/threads.js/promo-search.js/deposit-issue/
 * deposit-backup (see functions/_shared/featureStatus.js) — anyone can
 * skip this and hit the API directly, so it changes nothing security-wise.
 *
 * Usage: add data-feature-item="<id>" to any element (see the ids in
 * functions/_shared/featureStatus.js's FEATURE_STATUS_ITEMS), then call:
 *   applyFeatureStatuses();
 * after the elements exist in the DOM. Requires authguard.js loaded
 * first (uses window.AgentAuth.authFetch).
 */
async function applyFeatureStatuses(opts) {
  opts = opts || {};
  try {
    const res = await window.AgentAuth.authFetch("/api/feature-status");
    const data = await res.json();
    if (!data.ok) return;

    const badgeHtml = (status) => status === "coming_soon"
      ? '<span class="feature-status-badge fs-coming">🔜 Coming soon</span>'
      : '<span class="feature-status-badge fs-maint">🚧 Maintenance</span>';

    const applyTo = (el) => {
      const itemId = el.dataset.featureItem;
      const item = itemId && data.items[itemId];
      el.classList.remove("feature-status-dim");
      el.querySelector(".feature-status-badge")?.remove();
      if (el._featureStatusBlockHandler) {
        el.removeEventListener("click", el._featureStatusBlockHandler);
        el._featureStatusBlockHandler = null;
      }
      if (!item || item.status === "active") return;
      el.classList.add("feature-status-dim");
      el.insertAdjacentHTML("beforeend", badgeHtml(item.status));
      if (item.blocked) {
        el._featureStatusBlockHandler = (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          const msg = item.status === "coming_soon"
            ? "🔜 Not available yet, please check back later."
            : "⚠️ Under maintenance, please try again later.";
          if (opts.onBlocked) opts.onBlocked(msg);
          else alert(msg);
        };
        el.addEventListener("click", el._featureStatusBlockHandler, { capture: true });
      }
    };

    document.querySelectorAll("[data-feature-item]").forEach(applyTo);
  } catch {
    // Non-fatal — elements just show without a status badge; the real
    // block still happens server-side if someone clicks/submits through.
  }
}
