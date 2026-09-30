/**
 * AUTO-GENERATED from docs/shopping_route.csv and docs/shopping_items.csv by
 * scripts/generate-shopping-route.mjs.
 * Do not edit by hand — re-run 'npm run generate:shopping-route' (packages/core) after a CSV change.
 */

import type { ShoppingAssignments, ShoppingRoute } from './shoppingRouteCsv.js';

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

/** The seed item assignment: item name → stop (docs/shopping_items.csv); the name set is a superset of the ingredient list. */
export const SEED_SHOPPING_ASSIGNMENTS: ShoppingAssignments = {
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
};
