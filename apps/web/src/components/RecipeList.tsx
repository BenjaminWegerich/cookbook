import { useMemo, useState } from 'react';

import type { StoredRecipe } from '../drive/recipeStorage';
import RecipeThumb from './RecipeThumb';

interface RecipeListProps {
  recipes: StoredRecipe[];
  /** Drive access token, forwarded to the thumbnails for photo downloads. */
  token: string;
  /** Called when the user taps a recipe row (opens the recipe editor). */
  onOpenRecipe: (recipe: StoredRecipe) => void;
}

/**
 * Home-screen recipe list (single column, phone-first layout that scales to
 * desktop widths): a sticky search
 * field above the list, one row per recipe with a small thumbnail and the
 * title. The search filters recipes by title as you type (case-insensitive);
 * tapping a row opens the recipe editor. UI language is German
 * (see docs/CODING_CONVENTIONS.md).
 */
function RecipeList({ recipes, token, onOpenRecipe }: RecipeListProps) {
  const [query, setQuery] = useState('');

  // Normalized once so the per-render filter below only repeats the cheap
  // startsWith/includes comparisons, not the normalization. Empty query and
  // thus an empty trim collapse to the same "show everything" state, so a
  // query of only spaces is treated as no query at all.
  const trimmedQuery = query.trim();
  const needle = trimmedQuery.toLowerCase();

  const filtered = useMemo(() => {
    if (needle === '') return recipes;
    return recipes.filter((recipe) => recipe.title.toLowerCase().includes(needle));
  }, [recipes, needle]);

  return (
    <>
      <div className="recipe-search" role="search">
        <input
          type="search"
          className="recipe-search-input"
          placeholder="Rezepte suchen"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Rezepte durchsuchen"
        />
        {query !== '' && (
          <button
            type="button"
            className="recipe-search-clear"
            aria-label="Suche löschen"
            onClick={() => setQuery('')}
          >
            ×
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="recipe-search-empty" role="status">
          {trimmedQuery === ''
            ? 'Keine Rezepte im Cookbook-Ordner.'
            : `Kein Rezept für „${trimmedQuery}“ gefunden.`}
        </p>
      ) : (
        <ul className="recipe-list">
          {filtered.map((recipe) => (
            <li key={recipe.fileId}>
              <button type="button" className="recipe-row" onClick={() => onOpenRecipe(recipe)}>
                <RecipeThumb recipe={recipe} token={token} />
                <span className="recipe-title">{recipe.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default RecipeList;
