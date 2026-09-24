import type { CSSProperties } from 'react';

/** Number of letter-avatar variants in tokens.css (--avatar-0 … --avatar-3). */
const AVATAR_VARIANT_COUNT = 4;

/**
 * Deterministic avatar variant for a text (stable across renders, so the
 * same title always gets the same color).
 */
function avatarVariant(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return hash % AVATAR_VARIANT_COUNT;
}

interface TitleThumbProps {
  /** Text the placeholder is derived from (a recipe title or a plan entry). */
  title: string;
}

/**
 * Square letter-avatar media area derived from a text: the first letter on a
 * deterministic warm color from tokens.css. It is the one placeholder-image
 * logic of the app, shared by the recipe card's photo fallback (RecipeThumb)
 * and by the meal-plan cards that have no recipe at all — a plan entry that
 * Cookbook does not recognize still gets a card, with its placeholder image
 * derived from the entry text.
 */
function TitleThumb({ title }: TitleThumbProps) {
  const variant = avatarVariant(title);
  const style: CSSProperties = {
    backgroundColor: `var(--avatar-${variant})`,
    color: `var(--avatar-${variant}-fg)`,
  };
  return (
    <span className="recipe-thumb" style={style} aria-hidden="true">
      {title.charAt(0).toUpperCase()}
    </span>
  );
}

export default TitleThumb;
