/**
 * GET /api/attachment/<fileId>  -> the actual image/file bytes, proxied
 * live from Telegram — nothing is stored on our side.
 *
 * WHY THIS EXISTS: an agent's reply attachment (sent via
 * functions/api/threads/[id].js's "reply" action) is only ever uploaded
 * to Telegram — no copy of it lives anywhere in R2 or KV, by deliberate
 * choice (business owner wanted the "click to view" feature WITHOUT
 * using any of our own storage). What DOES get saved is Telegram's own
 * `file_id` for that upload (see attachmentFileId on the message
 * record). This route is what turns that file_id back into real,
 * viewable bytes, on demand, only at the moment someone actually clicks
 * to look — nothing is fetched or cached ahead of time.
 *
 * How it works: Telegram's Bot API splits "get a file" into two calls —
 * `getFile` (resolves a file_id to a temporary `file_path`) then a
 * separate download endpoint using that path. Both calls need
 * TELEGRAM_BOT_TOKEN, which must NEVER reach the browser (the download
 * URL's path literally embeds the token: .../bot<TOKEN>/<file_path>) —
 * so this proxies the actual response body straight through instead of
 * ever redirecting the browser to a Telegram URL. Same reasoning as why
 * R2 attachments are served through /api/screenshot/<key> rather than a
 * raw bucket URL — the browser only ever talks to our own domain.
 *
 * Login-gated like every other thread-related endpoint — this doesn't
 * separately check which brand the file "belongs to" (a file_id alone
 * doesn't carry that info without a KV lookup this route deliberately
 * skips for simplicity), so treat this as "any logged-in agent can view
 * any attachment if they somehow get its file_id" — acceptable since
 * file_ids aren't guessable/enumerable (they're long opaque Telegram-
 * issued strings) and are only ever handed out via the thread data an
 * agent could already see.
 *
 * Trade-off worth knowing: Telegram file_ids are generally retrievable
 * for as long as the file exists on Telegram's own servers (no fixed
 * expiry like the temporary download URL has), but that's Telegram's
 * behavior, not a guarantee this code makes — if Telegram ever can't
 * resolve an old file_id, this route surfaces that as a clean error
 * rather than a broken image, see the response below.
 */
import { verifyRequest } from "../../_shared/accounts.js";

export async function onRequestGet(context) {
  try {
    return await handleGet(context);
  } catch (e) {
    return new Response(`Unexpected server error: ${String((e && e.message) || e)}`, { status: 500 });
  }
}

async function handleGet({ request, env, params }) {
  const account = await verifyRequest(request, env);
  if (!account) return new Response("Login required.", { status: 401 });

  const fileId = params.fileId;
  if (!fileId) return new Response("Missing file id.", { status: 400 });
  if (!env.TELEGRAM_BOT_TOKEN) return new Response("Server is missing TELEGRAM_BOT_TOKEN.", { status: 500 });

  const infoRes = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const info = await infoRes.json();
  if (!info.ok) {
    // Most common real-world cause: the file's genuinely no longer
    // resolvable on Telegram's side (very old, or the source message
    // was deleted) — surfaced as 404 rather than a generic 502, since
    // that's the accurate meaning for the person clicking the link.
    return new Response(info.description || "Telegram couldn't resolve this file.", { status: 404 });
  }

  const filePath = info.result.file_path;
  const fileRes = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!fileRes.ok || !fileRes.body) {
    return new Response("Telegram couldn't deliver this file.", { status: 502 });
  }

  const contentType = fileRes.headers.get("Content-Type") || guessContentType(filePath);
  return new Response(fileRes.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Private + short-lived — this is a live proxy, not a stable asset
      // URL; no reason for a shared/public cache to hold onto it, but a
      // brief cache is harmless if someone reopens the same image within
      // a few minutes (e.g. re-opening the lightbox).
      "Cache-Control": "private, max-age=300",
    },
  });
}

function guessContentType(filePath) {
  const ext = (filePath || "").split(".").pop().toLowerCase();
  const map = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" };
  return map[ext] || "application/octet-stream";
}
