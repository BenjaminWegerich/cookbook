import { useEffect, useRef, useState } from 'react';

import { loadRecipePhoto } from '../drive/recipePhoto';
import type { StoredRecipe } from '../drive/recipeStorage';

interface RecipeThumbProps {
  recipe: StoredRecipe;
  /** Drive access token, needed to download the photo. */
  token: string;
}

/**
 * Recipe photo of a home-screen card or of the overview hero. Renders nothing
 * while the recipe has no photo — the list's cards are text-only then (decided
 * with the user), and the overview mounts this component only for a recipe
 * whose `image` exists. That is also why no placeholder is drawn any more: a
 * missing or failed photo leaves the title alone instead of an empty media area
 * or a broken-image glyph.
 *
 * The photo is downloaded through the shared photo cache
 * (../drive/recipePhoto) and shown as an object URL, so the overview sheet and
 * the editor preview reuse the same download. The landscape 4:3 format of the
 * media area is set in CSS (aspect-ratio 4/3, see recipe-list.css).
 *
 * The currently shown object URL is tracked in a ref so it is only revoked
 * when it is actually replaced (or on unmount): a failed re-download must
 * never leave the previous photo revoked and thus broken — it simply keeps
 * showing the old photo, and a recipe that never had a photo keeps rendering
 * nothing. Until the first photo arrives this component renders nothing as
 * well, so a card grows from text-only to text-and-photo when the download
 * finishes.
 */
function RecipeThumb({ recipe, token }: RecipeThumbProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  /** Object URL currently displayed, so it can be revoked when replaced. */
  const photoUrlRef = useRef<string | null>(null);
  /** Photo file id of the recipe (undefined = no photo). */
  const imageFileId = recipe.image?.fileId;

  useEffect(() => {
    if (imageFileId === undefined) {
      // No photo: drop a stale photo if one was displayed (e.g. the photo
      // sibling was deleted on Drive).
      if (photoUrlRef.current !== null) {
        URL.revokeObjectURL(photoUrlRef.current);
        photoUrlRef.current = null;
        setPhotoUrl(null);
      }
      return;
    }
    let cancelled = false;
    void (async () => {
      const blob = await loadRecipePhoto(token, imageFileId);
      if (cancelled || blob === null) return;
      const url = URL.createObjectURL(blob);
      // Replace the previously shown URL only on success; on failure the old
      // photo stays visible instead of a broken image.
      if (photoUrlRef.current !== null) URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = url;
      setPhotoUrl(url);
    })();
    return () => {
      // Cancel an in-flight download; the object URL itself is revoked on
      // unmount (below) or when replaced on a later successful download.
      cancelled = true;
    };
    // `recipe.image` (not its id) is the dependency on purpose: a list refresh
    // hands over a fresh object after a save, so a photo that was replaced in
    // place (same file id) is picked up from the updated cache. The cache
    // makes that re-run free — no second download.
  }, [recipe.image, imageFileId, token]);

  // Revoke the object URL on unmount so a long-lived app session does not
  // leak them.
  useEffect(
    () => () => {
      if (photoUrlRef.current !== null) {
        URL.revokeObjectURL(photoUrlRef.current);
        photoUrlRef.current = null;
      }
    },
    [],
  );

  if (photoUrl === null) return null;

  return (
    <span className="recipe-thumb" aria-hidden="true">
      {/* `draggable={false}`: a native image drag would start the browser's
          own drag ghost instead of scrolling the card grid, so a mouse drag
          over a photo has to stay a scroll gesture. */}
      <img src={photoUrl} alt="" draggable={false} />
    </span>
  );
}

export default RecipeThumb;
