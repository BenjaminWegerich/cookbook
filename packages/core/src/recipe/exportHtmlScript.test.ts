/**
 * Runtime tests for the export's embedded navigation script.
 *
 * The other export tests check the generated markup; this one executes the
 * script itself, because the file's first paint is script behaviour:
 *
 * - it must show exactly *one* size view. It used to define `selectServing`
 *   and never call it, so a finished dish stacked all 30 serving views until a
 *   button was tapped — a bug no markup assertion catches;
 * - it must open on the size the URL's fragment asks for (`#portionen=6`,
 *   `#menge=500g`), because that fragment is what the meal-plan link promises,
 *   and fall back to the recipe's written size when there is no such view.
 *
 * A full DOM environment (jsdom / happy-dom) is deliberately not a dependency
 * of the framework-free core module, so `ElementStub` implements only what the
 * script touches. The elements are scraped from the generated HTML, so the
 * stub cannot drift from the real markup without failing here.
 */

import { describe, expect, it } from 'vitest';

import { generateRecipeHtml } from './exportHtml.js';
import { parseRecipe } from './parse.js';
import type { Recipe } from './types.js';

/** Minimal element: attributes, `hidden`, `disabled`, classes and text. */
class ElementStub {
  hidden = false;
  disabled = false;
  textContent = '';
  innerHTML = '';
  offsetWidth = 0;
  private readonly attributes: Record<string, string>;
  private readonly classes = new Set<string>();

  constructor(className = '', attributes: Record<string, string> = {}) {
    this.attributes = attributes;
    for (const name of className.split(/\s+/)) {
      if (name !== '') this.classes.add(name);
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  hasClass(name: string): boolean {
    return this.classes.has(name);
  }

  readonly classList = {
    toggle: (name: string, on?: boolean): void => {
      if (on === undefined ? !this.classes.has(name) : on) {
        this.classes.add(name);
      } else {
        this.classes.delete(name);
      }
    },
    add: (...names: string[]): void => {
      names.forEach((name) => this.classes.add(name));
    },
    remove: (...names: string[]): void => {
      names.forEach((name) => this.classes.delete(name));
    },
  };

  addEventListener(): void {
    // Event binding is not what is under test.
  }

  /** The stub has no children: step navigation is not what is under test. */
  querySelectorAll(): ElementStub[] {
    return [];
  }

  querySelector(): ElementStub | null {
    return null;
  }
}

/** Collects one attribute set from a tag string. */
function attributesOf(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([a-z-]+)="([^"]*)"/g)) {
    attributes[match[1]!] = match[2]!;
  }
  return attributes;
}

/** Builds a stub element from a scraped tag (its class + attributes). */
function stubFromTag(tag: string): ElementStub {
  return new ElementStub(/class="([^"]*)"/.exec(tag)?.[1] ?? '', attributesOf(tag));
}

/** A no-op `history` stand-in for the script's pushState/replaceState. */
const HISTORY = { replaceState: (): void => {}, pushState: (): void => {} };

/** The parsed generated page with the elements the script queries. */
interface Page {
  document: unknown;
  window: unknown;
  /** The size-scoped check lists, in document order. */
  checkLists: ElementStub[];
}

/** Scrapes the generated HTML into the stub page the script runs against. */
function buildPage(html: string, hash: string, injected?: string): Page {
  const checkLists = [...html.matchAll(/<ul class="check-list size-scoped[^"]*"[^>]*>/g)].map(
    (match) => stubFromTag(match[0]),
  );
  const servingChips = [
    ...html.matchAll(/<button[^>]*class="[^"]*serving-chip[^"]*"[^>]*>/g),
  ].map((match) => stubFromTag(match[0]));
  const yieldChips = [
    ...html.matchAll(/<button[^>]*class="[^"]*yield-chip[^"]*"[^>]*>/g),
  ].map((match) => stubFromTag(match[0]));

  const activeChip =
    servingChips.find((chip) => chip.hasClass('active')) ??
    yieldChips.find((chip) => chip.hasClass('active')) ??
    null;
  const writtenView = checkLists.find(
    (list) => list.hasClass('is-written') && list.getAttribute('data-yield') !== null,
  );
  const yieldLists = checkLists.filter((list) => list.getAttribute('data-yield') !== null);

  // Generic non-null stubs so the render step (screens, buttons, counter) can
  // run without a DOM; the size selection happens before and is what we read.
  const screen = (): ElementStub => new ElementStub();
  const document = {
    querySelectorAll: (selector: string): ElementStub[] => {
      switch (selector) {
        case '.size-scoped':
          return checkLists;
        case '.check-list[data-yield]':
          return yieldLists;
        case '.serving-chip':
          return servingChips;
        case '.yield-chip':
          return yieldChips;
        default:
          return [];
      }
    },
    querySelector: (selector: string): ElementStub | null => {
      switch (selector) {
        case '[data-screen="intro"]':
        case '[data-screen="zutaten"]':
        case '[data-screen="zubereitung"]':
          return screen();
        case '.chip.active':
          return activeChip;
        case '.serving-chip':
          return servingChips[0] ?? null;
        case '.check-list.is-written[data-yield]':
          return writtenView ?? null;
        default:
          return null;
      }
    },
    getElementById: (id: string): ElementStub | null => {
      // The export's script removes the host's preselect style; the stub serves
      // a page without one. The bar controls and the step title just need to
      // exist so `render()` can touch them.
      switch (id) {
        case 'cookbook-preselect':
          return null;
        default:
          return new ElementStub();
      }
    },
    addEventListener: (): void => {},
  };
  const window = {
    location: { hash, search: '' },
    addEventListener: (): void => {},
    ...(injected === undefined ? {} : { __COOKBOOK_PLAN_SIZE__: injected }),
  };
  return { document, window, checkLists };
}

/**
 * The `data-servings` / `data-yield` values of the check lists that stay
 * visible after the script runs.
 *
 * `injected` is the size the export host passes to the page as
 * `window.__COOKBOOK_PLAN_SIZE__`; `hash` stands in for the page's own URL,
 * which a bare Drive link uses.
 */
function visibleSizes(recipe: Recipe, hash: string, injected?: string): (string | null)[] {
  const html = generateRecipeHtml(recipe);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (script === undefined) throw new Error('the export embeds no script');
  const page = buildPage(html, hash, injected);
  new Function('document', 'window', 'history', script)(page.document, page.window, HISTORY);
  return page.checkLists
    .filter((list) => !list.hidden)
    .map((list) => list.getAttribute('data-servings') ?? list.getAttribute('data-yield'));
}

const DISH: Recipe = parseRecipe(`---
title: Testgericht
type: finished_dish
servings: 4
prep_time: 5 min
---
## Zubereitung
1. Etwas tun.
`);

const SAUCE: Recipe = parseRecipe(`---
title: Testsoße
type: ingredient_recipe
yield: 500
yield_unit: ml
prep_time: 5 min
---
## Zubereitung
1. - 25 g Butter
   Rühren.
`);

describe('embedded script — finished dish', () => {
  it('shows exactly the written serving view without a fragment', () => {
    expect(visibleSizes(DISH, '')).toEqual(['4']);
  });

  it('opens on the serving view the fragment asks for', () => {
    expect(visibleSizes(DISH, '#portionen=9')).toEqual(['9']);
  });

  it('falls back to the written view when the fragment names no view', () => {
    expect(visibleSizes(DISH, '#portionen=11')).toEqual(['4']);
  });
});

describe('embedded script — size injected by the export host', () => {
  it('takes the host-injected serving size over the page URL', () => {
    // The Apps Script host injects window.__COOKBOOK_PLAN_SIZE__ because its
    // sandbox iframe hides the outer URL; the page then has no query to read.
    expect(visibleSizes(DISH, '', 'portionen=9')).toEqual(['9']);
  });

  it('takes the host-injected yield size', () => {
    expect(visibleSizes(SAUCE, '', 'menge=2.5l')).toEqual(['2500']);
  });
});

describe('embedded script — ingredient recipe', () => {
  it('shows exactly the written yield view without a fragment', () => {
    expect(visibleSizes(SAUCE, '')).toEqual(['500']);
  });

  it('opens on the fragment yield, normalized to the family base unit', () => {
    expect(visibleSizes(SAUCE, '#menge=500g')).toEqual(['500']);
    expect(visibleSizes(SAUCE, '#menge=2.5l')).toEqual(['2500']);
  });

  it('falls back to the written view for a yield outside the baked range', () => {
    expect(visibleSizes(SAUCE, '#menge=99999g')).toEqual(['500']);
  });
});
