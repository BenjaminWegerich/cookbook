import type { StoredRecipe } from '../drive/recipeStorage';
import RecipeThumb from './RecipeThumb';

interface RecipeListProps {
  recipes: StoredRecipe[];
  /** Drive access token, forwarded to the thumbnails for photo downloads. */
  token: string;
  /** Called when the user taps a recipe row. */
  onOpenRecipe: (title: string) => void;
}

/**
 * Home-screen recipe list (single column, smartphone layout): one row per
 * recipe with a small thumbnail and the title. UI language is German.
 */
function RecipeList({ recipes, token, onOpenRecipe }: RecipeListProps) {
  return (
    <ul className="recipe-list">
      {recipes.map((recipe) => (
        <li key={recipe.fileId}>
          <button type="button" className="recipe-row" onClick={() => onOpenRecipe(recipe.title)}>
            <RecipeThumb recipe={recipe} token={token} />
            <span className="recipe-title">{recipe.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default RecipeList;
