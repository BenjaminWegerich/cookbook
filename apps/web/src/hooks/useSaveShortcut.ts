/**
 * Binds Ctrl+S (⌘S on macOS) as the keyboard equivalent of a screen's primary
 * save / confirm button („Speichern" / „Übernehmen").
 *
 * Why a shared hook: the save button exists on three layers that can be open at
 * once in a stack — the recipe editor, the ingredient sheet on top of it, and
 * the new-ingredient sheet on top of that. Each layer registers the shortcut
 * for its *own* save action and disables it while it is not the visible topmost
 * layer, so exactly one layer reacts when Ctrl+S is pressed (the same rule the
 * Escape trigger follows: a hidden-but-mounted layer never reacts).
 *
 * The listener is registered on `window` only while `enabled` is true.
 * `preventDefault` suppresses the browser's own "Save Page" dialog, and
 * `event.repeat` is ignored so holding the shortcut does not fire the write
 * repeatedly while it is already running (the save handlers additionally guard
 * against a second in-flight write).
 *
 * The callback is read through a ref, so an inline arrow at the call site does
 * not re-register the listener on every render while the latest state is still
 * seen when the key is pressed (same pattern as `useEscapeTrigger`).
 */

import { useEffect, useRef } from 'react';

export function useSaveShortcut(onSave: () => void, enabled = true): void {
  const handlerRef = useRef(onSave);

  useEffect(() => {
    handlerRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // Ctrl+S on Windows/Linux, ⌘S on macOS. The key check is case-insensitive
      // so a keyboard with Caps Lock on still triggers the shortcut.
      if (event.key.toLowerCase() !== 's') return;
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.repeat) return;
      event.preventDefault();
      handlerRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
