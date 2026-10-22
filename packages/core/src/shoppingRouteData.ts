/**
 * AUTO-GENERATED from docs/shopping_route.csv, docs/shopping_items.csv and
 * docs/shopping_synonyms.csv by scripts/generate-shopping-route.mjs.
 * Do not edit by hand — re-run 'npm run generate:shopping-route' (packages/core) after a CSV change.
 */

import type { ShoppingItems, ShoppingRoute, ShoppingSynonyms } from './shoppingRouteCsv.js';

/** The seed route: the stops in the order the shops are visited and the sections are walked (docs/shopping_route.csv). */
export const SEED_SHOPPING_ROUTE: ShoppingRoute = [
  { store: 'Lidl', section: 'Obst und Gemüse' },
  { store: 'Lidl', section: 'Molkerei' },
  { store: 'Lidl', section: 'Trockensortiment' },
  { store: 'REWE', section: 'Obst und Gemüse' },
  { store: 'REWE', section: 'Molkerei' },
  { store: 'REWE', section: 'TK-Obst' },
  { store: 'REWE', section: 'Trockensortiment' },
  { store: 'dm', section: 'Drogerie' },
  { store: 'Blumenladen', section: 'Blumen' },
];

/** The seed item table: item name → stop (docs/shopping_items.csv); the name set is a superset of the ingredient list. */
export const SEED_SHOPPING_ITEMS: ShoppingItems = {
  Joghurt: { store: 'Lidl', section: 'Molkerei' },
  Butter: { store: 'Lidl', section: 'Molkerei' },
  Milch: { store: 'Lidl', section: 'Molkerei' },
  Sahne: { store: 'Lidl', section: 'Molkerei' },
  Karotten: { store: 'Lidl', section: 'Obst und Gemüse' },
  Mehl: { store: 'Lidl', section: 'Trockensortiment' },
  Zucker: { store: 'Lidl', section: 'Trockensortiment' },
  Olivenöl: { store: 'REWE', section: 'Trockensortiment' },
  Honig: { store: 'REWE', section: 'Trockensortiment' },
  Haferflocken: { store: 'REWE', section: 'Trockensortiment' },
  Cashews: { store: 'REWE', section: 'Trockensortiment' },
  Zitronensaft: { store: 'REWE', section: 'Obst und Gemüse' },
  'TK-Blaubeeren': { store: 'REWE', section: 'TK-Obst' },
  Klopapier: { store: 'dm', section: 'Drogerie' },
  Seife: { store: 'dm', section: 'Drogerie' },
  Blumen: { store: 'Blumenladen', section: 'Blumen' },
  'Hokkaido-Kürbis': { store: 'Lidl', section: 'Obst und Gemüse' },
  Feta: { store: 'REWE', section: 'Molkerei' },
  Walnüsse: { store: 'Lidl', section: 'Trockensortiment' },
  Ahornsirup: { store: 'dm', section: 'Drogerie' },
  Wasser: { store: 'Lidl', section: 'Obst und Gemüse' },
  Trockenhefe: { store: 'Lidl', section: 'Trockensortiment' },
  Walnusskerne: { store: 'Lidl', section: 'Trockensortiment' },
  Hackfleisch: { store: 'Lidl', section: 'Molkerei' },
  'gekochte Kidneybohnen mit Aquafaba': { store: 'Lidl', section: 'Trockensortiment' },
  'brauner Zucker': { store: 'Lidl', section: 'Trockensortiment' },
  Gemüsebrühe: { store: 'REWE', section: 'Trockensortiment' },
  Reis: { store: 'REWE', section: 'Trockensortiment' },
  Rosinen: { store: 'Lidl', section: 'Trockensortiment' },
  Sojaschnetzel: { store: 'REWE', section: 'Trockensortiment' },
  Tahin: { store: 'dm', section: 'Drogerie' },
  Süßkartoffeln: { store: 'Lidl', section: 'Obst und Gemüse' },
  Tortillas: { store: 'REWE', section: 'Trockensortiment' },
};

/** The seed synonym table: variant text → item name (docs/shopping_synonyms.csv). */
export const SEED_SHOPPING_SYNONYMS: ShoppingSynonyms = {};
