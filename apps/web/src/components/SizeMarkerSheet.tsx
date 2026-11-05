/**
 * Size-marker sheet (bottom sheet) for the recipe editor.
 *
 * A size marker is display-only equipment in a step's prose
 * (`{{1 26 cm Backring|size}}`): it scales with the recipe's size but never
 * enters the ingredient list. This sheet edits the *written* arrangement — the
 * number of molds and the nominal size of one mold. The recipe renderer derives
 * the arrangement for every other serving count (e.g. 8 → 12 servings turns
 * `1 26er Backring` into `2 22er Backringe`).
 *
 * The form deliberately offers no precision: a size marker has no BQ/AQ
 * candidate to score. Its scaling law and allowed sizes come from the marker's
 * master data (`docs/size_markers.csv`).
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useState } from 'react';

import {
  allSizeMarkers,
  formatDecimal,
  resolveSizeMarker,
  sizeMarkerFallbackText,
  sizeMarkerFor,
  type SizeArtifact,
} from '@cookbook/core';

import { useSaveShortcut } from '../hooks/useSaveShortcut';

interface SizeMarkerSheetProps {
  mode: 'add' | 'edit';
  /** Existing artifact when editing; a fresh insert starts at the marker's default size. */
  initial?: SizeArtifact;
  onConfirm: (artifact: SizeArtifact, action: 'add' | 'update') => void;
  onClose: () => void;
  /**
   * False while another sheet (e.g. the ingredient master data) owns Ctrl+S on
   * top of this one.
   */
  shortcutEnabled?: boolean;
}

/** The marker the sheet opens with: the edited one, or the first master row. */
function initialMarker(initial: SizeArtifact | undefined) {
  return (initial === undefined ? undefined : sizeMarkerFor(initial.marker)) ?? allSizeMarkers()[0];
}

function SizeMarkerSheet({
  mode,
  initial,
  onConfirm,
  onClose,
  shortcutEnabled = true,
}: SizeMarkerSheetProps) {
  const markerOptions = allSizeMarkers();
  const openingMarker = initialMarker(initial);
  const [marker, setMarker] = useState(openingMarker?.marker ?? '');
  const definition = sizeMarkerFor(marker) ?? openingMarker;
  const [countText, setCountText] = useState(String(initial?.count ?? 1));
  const [size, setSize] = useState(() => {
    if (initial !== undefined && openingMarker?.sizes.includes(initial.size)) {
      return initial.size;
    }
    return openingMarker?.defaultSize ?? openingMarker?.sizes[0] ?? 0;
  });
  const [error, setError] = useState<string | null>(null);

  const count = /^\d+$/.test(countText.trim()) ? Number(countText.trim()) : NaN;
  const countValid = Number.isSafeInteger(count) && count >= 1;
  const sizeValid = definition?.sizes.includes(size) ?? false;
  const preview =
    definition === undefined || !countValid || !sizeValid
      ? null
      : (resolveSizeMarker({ marker: definition.marker, count, size }, 1)?.text ??
        sizeMarkerFallbackText({
          marker: definition.marker,
          count,
          size,
          unit: definition.unit,
        }));

  /** Switches the marker and keeps the selected size valid for the new one. */
  const handleMarkerChange = (nextMarker: string): void => {
    setMarker(nextMarker);
    setError(null);
    const nextDefinition = sizeMarkerFor(nextMarker);
    if (nextDefinition !== undefined && !nextDefinition.sizes.includes(size)) {
      setSize(nextDefinition.defaultSize);
    }
  };

  const handleConfirm = (): void => {
    if (definition === undefined) {
      setError('Bitte eine Form wählen.');
      return;
    }
    if (!countValid) {
      setError('Bitte eine ganze Anzahl ab 1 eingeben.');
      return;
    }
    if (!sizeValid) {
      setError('Bitte eine zulässige Größe wählen.');
      return;
    }
    onConfirm(
      {
        kind: 'size',
        marker: definition.marker,
        count,
        size,
        unit: definition.unit,
      },
      mode === 'edit' ? 'update' : 'add',
    );
  };

  useSaveShortcut(handleConfirm, shortcutEnabled);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} role="presentation" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'add' ? 'Größe zum Text hinzufügen' : 'Größe im Text bearbeiten'}
      >
        <div className="sheet-head">
          <h3 className="sheet-title">
            {mode === 'add' ? 'Größe zum Text hinzufügen' : 'Größe im Text bearbeiten'}
          </h3>
          <p className="sheet-subtitle">
            Skaliert mit der Gesamtmenge, aber erscheint nicht in der Liste für das gesamte Rezept.
          </p>
        </div>

        <div className="field">
          <span className="field-label">Form</span>
          <div className="quantity-chips" role="group" aria-label="Form wählen">
            {markerOptions.map((candidate) => (
              <button
                key={candidate.marker}
                type="button"
                className={candidate.marker === marker ? 'chip chip-active' : 'chip'}
                onClick={() => handleMarkerChange(candidate.marker)}
              >
                {candidate.singular}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Anzahl</span>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={countText}
            onChange={(event) => {
              setCountText(event.target.value);
              setError(null);
            }}
            aria-describedby={error !== null ? 'size-marker-error' : undefined}
            aria-invalid={error !== null}
          />
        </label>

        <div className="field">
          <span className="field-label">Größe</span>
          {definition === undefined ? (
            <p className="field-error">Keine Größenmarker in den Stammdaten.</p>
          ) : (
            <div className="quantity-chips" role="group" aria-label="Größe wählen">
              {definition.sizes.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={candidate === size ? 'chip chip-active' : 'chip'}
                  onClick={() => {
                    setSize(candidate);
                    setError(null);
                  }}
                >
                  {formatDecimal(candidate)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <span className="field-label">Vorschau</span>
          <p className="aqs-preview" aria-live="polite">
            <span className="aqs-preview-value">{preview ?? 'Bitte Anzahl und Größe prüfen.'}</span>
          </p>
        </div>

        {error !== null && (
          <div className="field-errors" id="size-marker-error">
            <p className="field-error" role="alert">
              {error}
            </p>
          </div>
        )}

        <div className="sheet-actions">
          <button type="button" className="text-button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="primary-button" onClick={handleConfirm}>
            {mode === 'add' ? 'Einfügen' : 'Übernehmen'}
          </button>
        </div>
      </div>
    </>
  );
}

export default SizeMarkerSheet;
