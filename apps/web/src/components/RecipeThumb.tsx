import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { loadRecipePhoto } from '../drive/recipePhoto';
import type { StoredRecipe } from '../drive/recipeStorage';

/** Number of letter-avatar variants in tokens.css (--avatar-0 … --avatar-3). */
const AVATAR_VARIANT_COUNT = 4;

/**
 * Deterministic avatar variant for a title (stable across renders, so the
 * same recipe always gets the same color).
 */
function avatarVariant(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return hash % AVATAR_VARIANT_COUNT;
}

interface RecipeThumbProps {
  recipe: StoredRecipe;
  /** Drive access token, needed to download the photo. */
  token: string;
}

/**
 * Recipe photo area of a home-screen card: the recipe photo when one exists
 * (§2, optional sibling file), otherwise a warm letter avatar (initial letter
 * on a deterministic color from tokens.css). The photo is downloaded through
 * the shared photo cache (../drive/recipePhoto) and shown as an object URL, so
 * the overview sheet and the editor preview reuse the same download. The square
 * format of the media area is set in CSS (aspect-ratio 1/1, see
 * recipe-list.css).
 *
 * The currently shown object URL is tracked in a ref so it is only revoked
 * when it is actually replaced (or on unmount): a failed re-download must
 * never leave the previous photo revoked and thus broken — it simply keeps
 * showing the old photo, or the avatar when nothing has loaded yet.
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
      // Replace the previously shown URL only on success; on failure the
      // old photo (or avatar) stays visible instead of a broken image.
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

  if (photoUrl !== null) {
    return (
      <span className="recipe-thumb" aria-hidden="true">
        <img src={photoUrl} alt="" />
      </span>
    );
  }

  const variant = avatarVariant(recipe.title);
  const style: CSSProperties = {
    backgroundColor: `var(--avatar-${variant})`,
    color: `var(--avatar-${variant}-fg)`,
  };
  return (
    <span className="recipe-thumb" style={style} aria-hidden="true">
      {recipe.title.charAt(0).toUpperCase()}
    </span>
  );
}

export default RecipeThumb;
