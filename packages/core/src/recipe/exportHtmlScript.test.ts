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

/** Minimal element: attributes, `hidden`, classes and a class toggle. */
class ElementStub {
  hidden = false;
  disabled = false;
  textContent = '';
  private readonly attributes: Record<string, string>;
  private readonly classes = new Set<string>();
  private readonly listeners: Record<string, (() => void)[]> = {};

  constructor(className: string, attributes: Record<string, string>) {
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
  };

  addEventListener(type: string, listener: () => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  /** The stub has no children: step navigation is not what is under test. */
  querySelectorAll(): ElementStub[] {
    return [];
  }

  querySelector(): ElementStub | null {
    return null;
  }
}

/** The parsed generated file with the elements the script queries. */
interface Page {
  document: unknown;
  window: unknown;
  /** Every size view, in document order. */
  views: ElementStub[];
  /** The picker's current-value label. */
  valueLabel: ElementStub;
}

/** Collects one attribute set from a tag string. */
function attributesOf(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([a-z-]+)="([^"]*)"/g)) {
    attributes[match[1]!] = match[2]!;
  }
  return attributes;
}

/** Scrapes the generated HTML into the stub page the script runs against. */
function buildPage(html: string, hash: string): Page {
  const views: ElementStub[] = [];
  for (const match of html.matchAll(/<div class="(serving-view[^"]*)"([^>]*)>/g)) {
    views.push(new ElementStub(match[1]!, attributesOf(match[2]!)));
  }
  const buttons = [
    ...html.matchAll(/<button[^>]*class="(serving-button[^"]*)"[^>]*data-servings="(\d+)"/g),
  ].map((match) => new ElementStub(match[1]!, { 'data-servings': match[2]! }));
  const chips = [
    ...html.matchAll(/<button[^>]*class="(yield-chip[^"]*)"[^>]*data-yield="([^"]*)"/g),
  ].map((match) => new ElementStub(match[1]!, { 'data-yield': match[2]! }));
  const valueLabel = new ElementStub('yield-value', {});
  const stepDown = new ElementStub('yield-step-down', {});
  const stepUp = new ElementStub('yield-step-up', {});
  const servingViews = views.filter((view) => view.getAttribute('data-servings') !== null);
  const yieldViews = views.filter((view) => view.getAttribute('data-yield') !== null);
  const activeButton = buttons.find((button) => button.hasClass('active')) ?? null;
  const writtenView = views.find((view) => view.hasClass('is-written')) ?? null;

  const document = {
    querySelectorAll: (selector: string): ElementStub[] => {
      switch (selector) {
        case '.serving-view[data-servings]':
          return servingViews;
        case '.serving-view[data-yield]':
          return yieldViews;
        case '.serving-button':
          return buttons;
        case '.yield-chip':
          return chips;
        default:
          return [];
      }
    },
    querySelector: (selector: string): ElementStub | null => {
      switch (selector) {
        case '.serving-button.active':
          return activeButton;
        case '.yield-value':
          return valueLabel;
        case '.yield-step-down':
          return stepDown;
        case '.yield-step-up':
          return stepUp;
        case '.serving-view.is-written':
          return writtenView;
        default:
          return null;
      }
    },
  };
  return { document, window: { location: { hash } }, views, valueLabel };
}

/** The `data-servings` / `data-yield` values of the views that stay visible. */
function visibleSizes(recipe: Recipe, hash: string): (string | null)[] {
  const html = generateRecipeHtml(recipe);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (script === undefined) throw new Error('the export embeds no script');
  const page = buildPage(html, hash);
  new Function('document', 'window', script)(page.document, page.window);
  return page.views
    .filter((view) => !view.hidden)
    .map((view) => view.getAttribute('data-servings') ?? view.getAttribute('data-yield'));
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
