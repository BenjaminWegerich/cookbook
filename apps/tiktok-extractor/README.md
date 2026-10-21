# TikTok caption extractor

A small Cloudflare Worker that returns the caption of a TikTok video as JSON. It
is the backend half of the Android share flow: TikTok → Share → **Cookbook**
opens the AI-create screen with the caption already in the „Quelltext“ field.

**Why this exists.** The Cookbook PWA cannot read `tiktok.com` from the browser
(CORS), and Gemini's URL context tool is blocked by TikTok. Every other recipe
link works directly in the AI prompt; TikTok needs this one fetch done
server-side.

**Why a Worker and not the keep-gateway.** The endpoint needs no credential and
serves only public pages, so it is deliberately isolated from the service that
holds the Keep credential and the budget guardrail (see
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)).

## Contract

```
GET /?url=https://vm.tiktok.com/ZGdx3pwoV/
→ 200 { "caption": "…", "videoId": "7678702828122131744",
        "author": "annibacktvegan", "url": "https://www.tiktok.com/@…/video/…" }

GET /health
→ 200 { "ok": true }
```

Errors are JSON with a stable code:

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `invalid_url` | Missing `url`, or not an `https` TikTok host |
| 405 | `method_not_allowed` | Anything but `GET` / `OPTIONS` |
| 422 | `no_caption` | The page has no description (e.g. a captcha page) |
| 429 | `upstream_rate_limited` | TikTok rate-limited the Worker |
| 502 | `upstream_failed` | TikTok answered with an error |

CORS is `*` on purpose: the response is public data and the Worker holds no
credential. The host allowlist in `src/extract.js` is what keeps the endpoint
from becoming an open fetch proxy (SSRF).

## How the caption is found

TikTok ships the full caption in the page's hydration JSON
(`__UNIVERSAL_DATA_FOR_REHYDRATION__` → `__DEFAULT_SCOPE__` →
`webapp.reflow.video.detail` or `webapp.video-detail` → `itemInfo.itemStruct.desc`).
No API, no login, no oEmbed — TikTok's oEmbed endpoint returns no caption and
rate-limits aggressively.

## Deploy (one-time)

1. Create a free Cloudflare account: <https://dash.cloudflare.com/sign-up>.
2. In this folder, log in (opens the browser; works from WSL2):

   ```bash
   cd apps/tiktok-extractor
   npx wrangler login
   ```

   If the browser callback does not reach WSL, create an API token instead
   (My Profile → API Tokens → *Edit Cloudflare Workers*) and export it:

   ```bash
   export CLOUDFLARE_API_TOKEN=…
   ```

3. Deploy:

   ```bash
   npm run deploy
   ```

   Wrangler prints the URL, e.g.
   `https://cookbook-tiktok.<account>.workers.dev`.

4. Smoke-test it:

   ```bash
   curl "https://cookbook-tiktok.<account>.workers.dev/?url=https://vm.tiktok.com/ZGdx3pwoV/"
   ```

5. Point the app at it: in the GitHub repository settings, add the **repository
   variable** `VITE_TIKTOK_EXTRACTOR_URL` with that URL (Settings → Secrets and
   variables → Actions → Variables). The next Pages deploy picks it up. For a
   local `.env`, the same name goes into `apps/web/.env`.

Without the variable the app still works: a shared TikTok link opens the AI
screen, but the caption has to be pasted by hand.

## Local development

```bash
cd apps/tiktok-extractor
npm test        # parser + URL allowlist, no network
npm run dev     # wrangler dev on http://localhost:8787, real fetches
```

`wrangler dev` needs the login from above (or `CLOUDFLARE_API_TOKEN`); the tests
do not.

## Cost

Free plan: 100,000 requests per day, no cold starts. One share is one request.
