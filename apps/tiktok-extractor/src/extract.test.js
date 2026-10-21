/**
 * Unit tests for the pure extractor (no Worker APIs, no network).
 *
 * Run with `npm test` in this folder, or `node --test`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractCaption, isTikTokUrl, videoIdFromUrl } from './extract.js';

/** Builds a TikTok-like page with one hydration script. */
function pageWithScope(scope) {
  return `<!doctype html><html><head></head><body>
    <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: scope,
    })}</script>
  </body></html>`;
}

const CAPTION = 'Vegane Snickers Torte\n\nBrownie: 150 g vegane Butter … #vegan';

test('reads the current page shape (webapp.reflow.video.detail)', () => {
  const html = pageWithScope({
    'webapp.reflow.video.detail': {
      itemInfo: {
        itemStruct: {
          id: '7678702828122131744',
          desc: CAPTION,
          author: { uniqueId: 'annibacktvegan' },
        },
      },
    },
  });
  assert.deepEqual(extractCaption(html), {
    caption: CAPTION,
    videoId: '7678702828122131744',
    author: 'annibacktvegan',
  });
});

test('reads the older page shape (webapp.video-detail)', () => {
  const html = pageWithScope({
    'webapp.video-detail': { itemInfo: { itemStruct: { desc: 'Ältere Seite' } } },
  });
  assert.equal(extractCaption(html).caption, 'Ältere Seite');
});

test('falls back to shareMeta when itemInfo is missing', () => {
  const html = pageWithScope({
    'webapp.reflow.video.detail': { shareMeta: { desc: 'Nur shareMeta' } },
  });
  assert.equal(extractCaption(html).caption, 'Nur shareMeta');
});

test('prefers the item caption over shareMeta', () => {
  const html = pageWithScope({
    'webapp.reflow.video.detail': {
      itemInfo: { itemStruct: { desc: 'Aus dem Video' } },
      shareMeta: { desc: 'Aus den Metadaten' },
    },
  });
  assert.equal(extractCaption(html).caption, 'Aus dem Video');
});

test('falls back to og:description on a page without hydration data', () => {
  const html =
    '<html><head><meta property="og:description" content="Kürbis &amp; Chili" /></head></html>';
  assert.equal(extractCaption(html).caption, 'Kürbis & Chili');
});

test('returns a null caption when the page carries none', () => {
  assert.deepEqual(extractCaption('<html><body>captcha</body></html>'), {
    caption: null,
    videoId: null,
    author: null,
  });
});

test('ignores an empty caption', () => {
  const html = pageWithScope({
    'webapp.reflow.video.detail': { itemInfo: { itemStruct: { desc: '   ' } } },
  });
  assert.equal(extractCaption(html).caption, null);
});

test('accepts TikTok share links and rejects everything else', () => {
  assert.equal(isTikTokUrl('https://vm.tiktok.com/ZGdx3pwoV/'), true);
  assert.equal(
    isTikTokUrl('https://www.tiktok.com/@annibacktvegan/video/7678702828122131744'),
    true,
  );
  assert.equal(isTikTokUrl('http://vm.tiktok.com/ZGdx3pwoV/'), false);
  assert.equal(isTikTokUrl('https://tiktok.com.evil.example/video/1'), false);
  assert.equal(isTikTokUrl('https://evil.example/?url=https://vm.tiktok.com/x'), false);
  assert.equal(isTikTokUrl('nonsense'), false);
});

test('reads the video id off a canonical URL', () => {
  assert.equal(
    videoIdFromUrl('https://www.tiktok.com/@x/video/7678702828122131744'),
    '7678702828122131744',
  );
  assert.equal(videoIdFromUrl('nonsense'), null);
});
