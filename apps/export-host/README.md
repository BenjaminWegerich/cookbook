# Export host

A tiny Google Apps Script web app that serves a recipe's HTML export as the cooking view, so the
export's own script runs and the meal plan's promised size reaches the page.

## Why it exists

The HTML export (docs/ARCHITECTURE.md, "HTML share export") is a self-contained file in Google
Drive whose size picker and step navigation are an embedded script. A Drive link renders that file
**without letting the script run** — Google Keep's in-app browser shows the page but every button
stays dead — and it does not pass the URL's fragment through, so the size the meal plan promised is
lost too. Both were observed on Ben's phone: the same Drive link works when Chrome proper opens it,
and fails when Keep's own tab does.

This web app reads the export from the cookbook owner's Drive and serves it as an ordinary page, so
the script runs, and it reads the promised size from the query string. It runs on Google's side:
nothing to host, no credentials in the web app, and the recipes stay out of public repositories.

## Request shape

The web app builds these URLs (`packages/core/src/planLink.ts`); the meal-plan entry carries one,
and the export's own sub-recipe links use the same host without a size.

```
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?f=<exportFileId>
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?f=<exportFileId>&portionen=6
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?f=<exportFileId>&menge=500g
```

- `f` — the export file's Drive id (`<title>.html` in the Cookbook folder).
- `portionen` — a finished dish's serving count.
- `menge` — an ingredient recipe's yield in the family base unit (`g` / `ml`; `kg` / `l` are
  accepted and normalized). `packages/core/src/planLink.ts` owns these names, and
  `Code.gs` spells them out again because Apps Script has no bundler — **change both together.**

The size is served two ways: injected as `window.__COOKBOOK_PLAN_SIZE__` (the page's script reads
it — an Apps Script page runs in a sandbox iframe that hides the outer URL) and as a `<style>`
element that shows only the promised view until that script takes over. Without the style, a page
whose script never runs would open at the written size instead of the planned one.

## What it will serve

Only a `*.html` file whose parent folder is named `Cookbook`. A known file id is not enough, so the
service cannot be used as a general reader for the owner's Drive. Every other request answers with a
short German error page.

The deployed access is **anyone who has the link**, which is the same trust level as the "anyone
with the link" Drive sharing the export would need — the URL is unguessable, and the file ids in it
are the only secret.

## Deployment (one-time, ~5 minutes)

1. Open <https://script.google.com> and click **New project**.
2. Rename the project (top left) to `cookbook-export-host`.
3. In **Project Settings** (gear icon), tick **Show `appsscript.json` manifest file in editor**.
4. Back in **Editor**, replace the contents of `Code.gs` with this repository's
   [`Code.gs`](Code.gs) and the contents of `appsscript.json` with
   [`appsscript.json`](appsscript.json). Save (disk icon).
5. **Deploy → New deployment**, click the gear next to "Select type" and choose **Web app**.
   - Description: `cookbook export host`
   - **Execute as: Me**
   - **Who has access: Anyone**
   - **Deploy**.
6. Google asks for authorisation: **Authorize access** → choose the cookbook Google account →
   "Google hasn't verified this app" → **Advanced** → **Go to cookbook-export-host (unsafe)** →
   **Allow**. The scope is read-only Drive access.
7. Copy the **Web app URL** (ends in `/exec`) from the deployment dialog.

## Wiring it into the web app

The URL is public data (it ships in the browser bundle), so it lives in the build configuration:

- **GitHub Pages build:** repository → Settings → Secrets and variables → Actions → **Variables** →
  **New repository variable**, name `VITE_EXPORT_HOST_URL`, value the `/exec` URL.
- **Local development:** add `VITE_EXPORT_HOST_URL=<the /exec URL>` to `apps/web/.env`.

With the variable unset, the app keeps using the Drive viewer link — the app works, the Keep
buttons do not.

## Testing

1. Open the export of any saved recipe in Drive and copy the id from its URL
   (`drive.google.com/file/d/<id>/view`).
2. Open `<the /exec URL>?f=<id>` in a browser. The cooking view must render, the size picker and the
   step buttons must work, and `…&portionen=6` (or `&menge=500g`) must open on that size.
3. Plan that recipe in the app and tap the link in Google Keep. This is the case the host exists
   for: the buttons must work inside Keep's own tab.

## Updating the code

Apps Script does not deploy from git. After editing `Code.gs` here: paste it into the editor, save,
then **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**. The `/exec`
URL stays the same.

## Honest limits

- **Cold requests are slower** than a static file; Apps Script adds a few hundred milliseconds.
- **A cached response is possible.** A recipe's export is regenerated in place under the same file
  id, so a browser or Google's front end may briefly serve the previous version. Re-planning the
  dish re-opens the link; if a stale page persists, open the URL with a trailing `&t=1`.
- **`Code.gs` is duplicated knowledge.** The parameter names and the preselect element id also live
  in `packages/core/src/planLink.ts`, and the folder name in
  `apps/web/src/drive/recipeStorage.ts`. There is no way to share them across the two runtimes.
- **The web app is per account.** A second cookbook owner needs their own deployment and their own
  `VITE_EXPORT_HOST_URL`.
