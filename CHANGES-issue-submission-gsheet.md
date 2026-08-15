# Issue Submission Gsheet (2026-08)

Added to Integration Portal, positioned right after TG Group / Channel
(per the reference screenshots). Same brand-sidebar + per-module-row
layout as TG Group/Channel, but each row is a **Google Sheet URL/ID +
Tab name** pair instead of Chat ID/Topic ID.

## What it covers

6 of the 7 issue-submission modules: **QA, Account Issue, Withdraw
Issue, Risk Issue, Daily Report, Genie Issue**. Each (brand, module)
pair can be pointed at a completely different spreadsheet/tab than the
brand's usual one, live from the browser — no redeploy.

**Promotion Request is deliberately excluded.** Its sheet is already
chosen per (brand, *promotion type*) via the separate
`PROMOTION_SHEET_CONFIG` in `routing.js` — a finer-grained system than
"one sheet per brand" that predates this feature and isn't part of it.

## Architecture

Previously every module for a brand shared ONE hardcoded spreadsheet
(`BRANDS[brandId].sheetId`) with a fixed tab name per module
(`SHEET_LAYOUT[moduleId].tab`, same tab name across every brand). This
adds a KV override layer on top — same "override in KV, hardcoded
default underneath" pattern as TG Group/Channel and Deposit Sheet Link:

- **New:** `functions/_shared/issueSubmissionSheets.js` — the KV layer,
  key shape `issue-sheet:<brandId>:<moduleId>` → `{sheetId, tabName}`.
- **New:** `functions/api/admin/issue-submission-sheets.js` — admin
  GET/POST, gated by the new `issueSubmissionSheet` admin section
  (View only / Can Edit, same as every other Integration Portal item).
- **Edited:** `functions/api/submit.js` — checks for a per-brand+module
  override before falling back to the old hardcoded
  `brand.sheetId`/`SHEET_LAYOUT[moduleId].tab`. Only the tab name is
  ever overridden — column layout (`startColumn`/`columns`) stays
  exactly as coded, since a different spreadsheet is still expected to
  have the same columns, just possibly a different tab name.
- **Edited:** `functions/_shared/accounts.js` — new `issueSubmissionSheet`
  section (superadmin-and-above default, same as its siblings).
- **Edited:** `public/index.html` / `public/assets/hub-nav.js` —
  sidebar item, modal (`loadIssueSheets`/`renderIssueSheets`/
  `saveIssueSheetRow`/`resetIssueSheetRow`, mode `"issuesheets"`), Agent
  Profile permission list, deep-link map.

## Bug fixed in the same pass

The Promo Code Gsheet panel added last session (`mode === "promosheet"`)
was accidentally left OUT of the `showFooterSave` exclusion list — its
shared modal footer "Save" button was visible and clickable but silently
did nothing (only the panel's own inline Save button actually worked).
Fixed alongside adding `"issuesheets"` to that same list.
