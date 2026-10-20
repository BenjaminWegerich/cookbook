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

import { beforeEach, describe, expect, it } from 'vitest';

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

  /** The script maintains `aria-checked` and the roving `tabindex` (§8). */
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
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

  checked = false;
  private handlers: Record<string, ((event: unknown) => void)[]> = {};

  addEventListener(type: string, handler: (event: unknown) => void): void {
    (this.handlers[type] ??= []).push(handler);
  }

  /** Fires a registered handler, as a click on the element would. */
  fire(type: string, event: unknown = {}): void {
    for (const handler of this.handlers[type] ?? []) handler(event);
  }

  focus(): void {
    // Arrow-key focus movement is not what is under test.
  }

  /** The checkboxes inside a check list (used by the size-change reset). */
  boxes: ElementStub[] = [];

  /** The steps inside a step wrap (the node model counts them). */
  steps: ElementStub[] = [];

  /** The stub has no other children: unrelated queries come back empty. */
  querySelectorAll(selector = ''): ElementStub[] {
    if (selector.indexOf('input') === 0) return this.boxes ?? [];
    if (selector === '.step') return this.steps;
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

/** The state one history entry carries (written by the export's script). */
interface EntryState {
  cookbook?: number;
  node?: string;
}

/**
 * A `history` stand-in that models the tab's session history: a list of entries
 * plus a pointer, where `back()` / `forward()` move the pointer and deliver the
 * reached entry's `popstate` — which is the browser's whole part of §6.6.
 * `calls` records the traversals the page asked for, so a test can prove that an
 * in-page move reused an entry instead of pushing a second one for the same
 * node. Entry 0 is the entry the page loaded on; a real Back from it leaves the
 * document, which this model cannot reproduce, so tests stay above it.
 */
const HISTORY = {
  calls: [] as string[],
  stack: [] as { state: EntryState | null }[],
  pointer: 0,
  /** The page under test, which receives the `popstate` of each traversal. */
  page: null as Page | null,
  /** The state the browser hands the page as `history.state` on load. */
  get state(): EntryState | null {
    return HISTORY.stack[HISTORY.pointer]?.state ?? null;
  },
  replaceState(state: EntryState): void {
    HISTORY.stack[HISTORY.pointer] = { state };
  },
  pushState(state: EntryState): void {
    HISTORY.stack.length = HISTORY.pointer + 1;
    HISTORY.stack.push({ state });
    HISTORY.pointer = HISTORY.stack.length - 1;
  },
  /** Delivers the `popstate` of the entry the pointer now rests on. */
  deliver(): void {
    const state = HISTORY.stack[HISTORY.pointer]?.state ?? null;
    HISTORY.page?.popstate.forEach((handler) => handler({ state }));
  },
  forward(): void {
    HISTORY.calls.push('forward');
    if (HISTORY.pointer < HISTORY.stack.length - 1) {
      HISTORY.pointer += 1;
      HISTORY.deliver();
    }
  },
  back(): void {
    HISTORY.calls.push('back');
    if (HISTORY.pointer > 0) {
      HISTORY.pointer -= 1;
      HISTORY.deliver();
    }
  },
};

/** The parsed generated page with the elements the script queries. */
interface Page {
  document: unknown;
  window: unknown;
  /** The size-scoped check lists, in document order. */
  checkLists: ElementStub[];
  /** The size chips, so a test can press one. */
  chips: ElementStub[];
  /** The bar's two buttons, so a test can press them. */
  backButton: ElementStub;
  forwardButton: ElementStub;
  /** The three screens, whose `active` class is the node on screen (§5.11). */
  screens: Record<'intro' | 'zutaten' | 'zubereitung', ElementStub>;
  /** The step title, so a test can read which step is shown. */
  stepTitle: ElementStub;
  /** The window's `popstate` listeners, so a test can deliver a browser Back. */
  popstate: ((event: unknown) => void)[];
}

/** Scrapes the generated HTML into the stub page the script runs against. */
function buildPage(html: string, hash: string, injected?: string): Page {
  const checkLists = [...html.matchAll(/<ul class="check-list size-scoped[^"]*"[^>]*>/g)].map(
    (match) => stubFromTag(match[0]),
  );
  const servingChips = [...html.matchAll(/<button[^>]*class="[^"]*serving-chip[^"]*"[^>]*>/g)].map(
    (match) => stubFromTag(match[0]),
  );
  const yieldChips = [...html.matchAll(/<button[^>]*class="[^"]*yield-chip[^"]*"[^>]*>/g)].map(
    (match) => stubFromTag(match[0]),
  );

  const backButton = stubFromTag(
    /<button class="btn prev"[^>]*>/.exec(html)?.[0] ?? '<button class="btn prev">',
  );
  const forwardButton = stubFromTag(
    /<button class="btn next"[^>]*>/.exec(html)?.[0] ?? '<button class="btn next">',
  );

  const activeChip =
    servingChips.find((chip) => chip.hasClass('active')) ??
    yieldChips.find((chip) => chip.hasClass('active')) ??
    null;
  const writtenView = checkLists.find(
    (list) => list.hasClass('is-written') && list.getAttribute('data-yield') !== null,
  );
  const yieldLists = checkLists.filter((list) => list.getAttribute('data-yield') !== null);

  // One stub per screen: `render` toggles `active` and the slide class on them.
  const screens = {
    intro: new ElementStub(),
    zutaten: new ElementStub(),
    zubereitung: new ElementStub(),
  };
  const stepTitle = new ElementStub();
  const counter = new ElementStub();
  // The flow's step count: every baked size repeats the same steps, so the
  // highest data-step is the number of nodes after Zutaten.
  const stepNumbers = [...html.matchAll(/class="step" data-step="(\d+)"/g)].map((match) =>
    Number(match[1]),
  );
  const firstWrap = new ElementStub();
  firstWrap.steps = Array.from(
    { length: stepNumbers.length === 0 ? 0 : Math.max(...stepNumbers) },
    () => new ElementStub(),
  );
  // Every check list's boxes, so the size-change reset can be observed.
  const allBoxes = checkLists.flatMap((list) => (list.boxes = [new ElementStub()]));
  const popstate: ((event: unknown) => void)[] = [];
  const document = {
    querySelectorAll: (selector: string): ElementStub[] => {
      switch (selector) {
        case '.size-scoped':
          return checkLists;
        case '.check-list input[type="checkbox"]':
          return allBoxes;
        case '.check-list[data-yield]':
          return yieldLists;
        case '.serving-chip':
          return servingChips;
        case '.yield-chip':
          return yieldChips;
        case '.step-wrap':
          return [firstWrap];
        default:
          return [];
      }
    },
    querySelector: (selector: string): ElementStub | null => {
      switch (selector) {
        case '.step-wrap':
          return firstWrap;
        case '[data-screen="intro"]':
          return screens.intro;
        case '[data-screen="zutaten"]':
          return screens.zutaten;
        case '[data-screen="zubereitung"]':
          return screens.zubereitung;
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
      // exist so `render()` can touch them — and the two bar buttons must be the
      // very stubs a test presses, or the script's click listeners land elsewhere.
      switch (id) {
        case 'cookbook-preselect':
          return null;
        case 'btn-back':
          return backButton;
        case 'btn-next':
          return forwardButton;
        case 'step-title':
          return stepTitle;
        case 'counter':
          return counter;
        default:
          return new ElementStub();
      }
    },
    addEventListener: (): void => {},
  };
  const window = {
    location: { hash, search: '' },
    addEventListener: (type: string, handler: (event: unknown) => void): void => {
      if (type === 'popstate') popstate.push(handler);
    },
    ...(injected === undefined ? {} : { __COOKBOOK_PLAN_SIZE__: injected }),
  };
  return {
    document,
    window,
    checkLists,
    chips: [...servingChips, ...yieldChips],
    backButton: backButton ?? new ElementStub(),
    forwardButton: forwardButton ?? new ElementStub(),
    screens,
    stepTitle,
    popstate,
  };
}

/**
 * The `data-servings` / `data-yield` values of the check lists that stay
 * visible after the script runs.
 *
 * `injected` is the size the export host passes to the page as
 * `window.__COOKBOOK_PLAN_SIZE__`; `hash` stands in for the page's own URL,
 * which a bare Drive link uses. `restored` is the state of the entry the page
 * loads on — a reload keeps the state the flow wrote into it before, a fresh
 * load has none.
 */
function runPage(
  recipe: Recipe,
  hash: string,
  injected?: string,
  restored: EntryState | null = null,
): Page {
  const html = generateRecipeHtml(recipe);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (script === undefined) throw new Error('the export embeds no script');
  const page = buildPage(html, hash, injected);
  // The tab stands on one entry when the document starts.
  HISTORY.stack = [{ state: restored }];
  HISTORY.pointer = 0;
  HISTORY.page = page;
  new Function('document', 'window', 'history', script)(page.document, page.window, HISTORY);
  return page;
}

function visibleSizes(recipe: Recipe, hash: string, injected?: string): (string | null)[] {
  const page = runPage(recipe, hash, injected);
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

beforeEach(() => {
  HISTORY.calls.length = 0;
  HISTORY.stack = [];
  HISTORY.pointer = 0;
  HISTORY.page = null;
});

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

describe('embedded script — the bar and the browser history (§6.6)', () => {
  it('traverses an already-visited step instead of pushing a second entry', () => {
    const page = runPage(DISH, '');
    page.forwardButton.fire('click'); // intro → zutaten: a new node, so it pushes
    HISTORY.calls.length = 0;
    page.backButton.fire('click'); // zutaten → intro: visited, so it must traverse
    expect(HISTORY.calls).toEqual(['back']);
    expect(page.screens.intro.hasClass('active')).toBe(true);
  });

  it('pushes a new entry only for a node the flow does not hold yet', () => {
    const page = runPage(DISH, '');
    HISTORY.calls.length = 0;
    page.forwardButton.fire('click'); // intro → zutaten
    page.forwardButton.fire('click'); // zutaten → the first step
    expect(HISTORY.calls).toEqual([]);
  });

  it('shows the previous node, with the back slide, on a device Back', () => {
    const page = runPage(DISH, '');
    page.forwardButton.fire('click'); // intro → zutaten
    page.forwardButton.fire('click'); // zutaten → step 1
    expect(page.screens.zubereitung.hasClass('active')).toBe(true);
    HISTORY.calls.length = 0;
    HISTORY.back(); // the device-back gesture: the browser pops one entry
    expect(HISTORY.calls).toEqual(['back']);
    expect(page.screens.zutaten.hasClass('active')).toBe(true);
    expect(page.screens.zutaten.hasClass('slide-back')).toBe(true);
    expect(page.screens.zutaten.hasClass('slide-fwd')).toBe(false);
  });

  it('lands a bar Zurück exactly where a device Back lands', () => {
    const page = runPage(DISH, '');
    page.forwardButton.fire('click'); // intro → zutaten
    HISTORY.calls.length = 0;
    page.backButton.fire('click');
    // The bar asks the browser for the previous entry; the popstate renders it,
    // so the button and the device gesture cannot drift apart.
    expect(HISTORY.calls).toEqual(['back']);
    expect(page.screens.intro.hasClass('active')).toBe(true);
    expect(page.screens.intro.hasClass('slide-back')).toBe(true);
  });

  it('reuses a step entry after device back → Weiter → device back', () => {
    // The regression this guards: after a Back, the forward node was no longer
    // recognised as already visited, so Weiter pushed a second entry on top of
    // the old one and the next Back landed on the wrong node.
    const page = runPage(DISH, '');
    page.forwardButton.fire('click'); // → zutaten
    page.forwardButton.fire('click'); // → step 1
    HISTORY.back(); // device Back → zutaten
    page.forwardButton.fire('click'); // Weiter → step 1
    HISTORY.back(); // device Back → zutaten
    HISTORY.calls.length = 0;
    page.forwardButton.fire('click'); // Weiter must traverse, not push a copy
    expect(HISTORY.calls).toEqual(['forward']);
    expect(page.screens.zubereitung.hasClass('active')).toBe(true);
  });

  it('resumes the node of the entry a reload lands on', () => {
    // The entry the page loads on carries the state the flow wrote last. A
    // reload must show that node: restarting at the intro over a stack that
    // points deeper would make the next Back walk forward.
    const page = runPage(DISH, '', undefined, { cookbook: 1, node: 'step-1' });
    expect(page.screens.zubereitung.hasClass('active')).toBe(true);
    expect(page.stepTitle.textContent).toBe('Schritt 1 von 1');
    expect(page.forwardButton.hidden).toBe(true);
  });
});

describe('embedded script — a size change discards the checks (§5.11)', () => {
  it('clears every checkbox when another size is chosen, but not on a re-tap', () => {
    const page = runPage(DISH, '');
    const boxes = page.checkLists.flatMap((list) => list.boxes);
    boxes.forEach((box) => {
      box.checked = true;
    });
    const chipAt = (servings: number): ElementStub =>
      page.chips.find((chip) => chip.getAttribute('data-servings') === String(servings))!;
    // Re-tapping the size that is already shown is not a change.
    chipAt(4).fire('click');
    expect(boxes.some((box) => box.checked)).toBe(true);
    // Choosing another size discards them.
    chipAt(6).fire('click');
    expect(boxes.some((box) => box.checked)).toBe(false);
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
