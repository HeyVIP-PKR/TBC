# Deposit Issue module — now merged into your real repo

This version is merged directly into the actual `pkr-issue-hub` project you
sent (using your real `functions/_shared/accounts.js`, `authguard.js`, and
`index.html` — not placeholders anymore). Everything below is already done
for you in this zip; you just need to fill in the 2 placeholders and deploy.

## What changed vs. the first draft
- ✅ **Login gate wired for real** — `search.js` and `update.js` now import
  `verifyRequest` from your actual `functions/_shared/accounts.js` and
  reject with 401 if not logged in, exactly like `submit.js` does.
- ✅ **Frontend uses your real auth** — `deposit-issue.html` now loads
  `/assets/authguard.js` (redirects to login if not authenticated) and
  calls the two new APIs via `window.AgentAuth.authFetch(...)`, which
  automatically attaches the `X-Agent-Token` header and bounces back to
  login on a 401 (account locked, IP changed, token expired, etc.) — same
  behavior as every other page in your hub.
- ✅ **Real home page card added** — `public/index.html` now has a
  "Deposit Issue" tool-card next to "Promo Code Search", linking to
  `/deposit-issue.html`.
- ✅ **Restyled to match your real site** — `deposit-issue.html` now uses
  your actual `/assets/style.css` (same `--card-bg`/`--border`/`--ink`
  variables, `.topbar`, `.back-pill`, light/dark theme toggle, starfield
  background) instead of its own standalone dark theme. Same visual
  language as `promo.html`/`threads.html`, just with its own `dep-`
  prefixed classes for the parts unique to this page (brand dropdown,
  result cards, edit panel).
- ✅ **Tab-name mismatch is no longer silent** — this is what caused your
  "No results found" earlier: `search.js` now calls the Sheets API to get
  the sheet's REAL tab names first, and only queries tabs that actually
  match `TAB_NAMES` (same trick `promo-search.js` already used). If a
  configured tab doesn't exist, the page shows a yellow warning banner
  listing exactly what's missing and what the sheet's real tab names are
  — so a typo/rename shows up immediately instead of quietly returning 0
  results forever.

## Sheet ID & tab name — already filled in
```
SHEET_ID:  1HByPuZMuuYZL9S5fPPGjb8RAmCwNVgKXvuLgVBbVM-E
TAB_NAME:  CX PKR
```
`bjpkr2024@gmail.com` (the OAuth account) already has Editor access on this
Sheet, so no extra sharing step was needed — the code in this zip is ready
to deploy as-is, no placeholders left to fill in.

## 1. Confirm the 3 OAuth secrets are set
Already added earlier to Cloudflare Pages → Settings → Environment
variables — just confirm both **Production** and **Preview** have all three:
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`.

## 2. Deploy and test
1. Push/upload this whole zip's contents into your repo (merges cleanly —
   only new files + the two small edits inside `index.html`).
2. Open your site, log in normally, click the new **Deposit Issue** card.
3. Search a real Transaction ID / Reference / Username / Agent Number that
   exists in the sheet.
4. Click Edit, change a field, Submit — confirm the row updates in the
   real Google Sheet.
5. Confirm logging out and hitting `/deposit-issue.html` directly redirects
   to login (proves the gate is actually enforced, not just hidden in the UI).

## Notes / things you may want to revisit later
- **Brand filter**: the dropdown (9 PKR brands, real logos) is fully wired
  on the frontend, but `search.js` doesn't filter by brand server-side yet
  — it searches the whole sheet regardless of which brand is selected.
  Your sample data was all Crickex — worth confirming with the other
  department whether this Sheet is single-brand (in which case the
  dropdown could just be removed) or covers multiple brands (in which case
  I can wire real filtering once we know how brand is represented in the
  sheet — a column? separate tabs?).
- **Per-account access control**: submit.js also checks `canSeeBrand` /
  `canSeeModule` so an agent scoped to specific brands/modules can't act
  outside them. This module doesn't have an equivalent yet — right now
  any logged-in agent can search/update anything in this sheet. Worth
  adding once you decide whether Deposit Issue should be scoped per-agent
  like the ticket modules are.
- **Search matches** Transaction ID (A), Reference (K), Username (E), and
  Agent Number (D) — substring, case-insensitive.
- **Performance**: reads the whole tab on every search — fine for a few
  thousand rows, may need optimizing if this sheet gets very large.
