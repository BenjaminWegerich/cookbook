import { useMemo, useState } from 'react';

import type { StoredRecipe } from '../drive/recipeStorage';
import RecipeThumb from './RecipeThumb';

interface RecipeListProps {
  recipes: StoredRecipe[];
  /** Drive access token, forwarded to the card media areas for photo downloads. */
  token: string;
  /** Called when the user taps a recipe card (opens the recipe overview). */
  onOpenRecipe: (recipe: StoredRecipe) => void;
}

/**
 * Home-screen recipe list (adaptive card grid, phone-first layout that scales
 * to desktop widths): a sticky search field above the grid, one card per
 * recipe with a square photo and the title below. The search filters recipes
 * by title as you type (case-insensitive); tapping a card opens the recipe
 * overview sheet. UI language is German (see docs/CODING_CONVENTIONS.md).
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
        <div className="recipe-search-field">
          <svg className="recipe-search-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9.5 3a6.5 6.5 0 1 0 4.05 11.55l4.2 4.2 1.5-1.5-4.2-4.2A6.5 6.5 0 0 0 9.5 3zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z"
              fill="currentColor"
            />
          </svg>
          <input
            type="search"
            className="recipe-search-input"
            placeholder="Rezept suchen"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Rezept suchen"
          />
        </div>
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
              <button type="button" className="recipe-card" onClick={() => onOpenRecipe(recipe)}>
                <RecipeThumb recipe={recipe} token={token} />
                <span className="recipe-card-title">{recipe.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default RecipeList;
