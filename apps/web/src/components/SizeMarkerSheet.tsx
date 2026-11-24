/**
 * Size-marker sheet (bottom sheet) for the recipe editor.
 *
 * A size marker is display-only equipment in a step's prose
 * (`{{1 26 cm Backring|size|case:akk}}`): it scales with the recipe's size but
 * never enters the ingredient list. This sheet edits the *written* arrangement —
 * the number of molds, the nominal size of one mold and the grammatical case
 * of the sentence slot. The recipe renderer derives the arrangement for every
 * other serving count (e.g. 8 → 12 servings turns `einen 26er Backring` into
 * `zwei 22er Backringe`); the reference readout shows the bare label (`26er
 * Backring`, `2 22er Backringe`).
 *
 * The form deliberately offers no precision: a size marker has no BQ/AQ
 * candidate to score. Its scaling law, allowed sizes and grammatical gender
 * come from the marker's master data (`docs/size_markers.csv`).
 *
 * It does offer the reference role: a flagged marker is shown in the recipe's
 * size readout (e.g. "12 Portionen (26er Backring)"), because the equipment is
 * often the best sanity check of a portion size and it never enters the
 * ingredient list, where the reference star lives.
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
  type SizeMarkerCase,
} from '@cookbook/core';

import InfoHint from './InfoHint';
import { StarFilledIcon, StarIcon } from './icons';
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
  /**
   * The grammatical case of the prose slot. A fresh marker starts in the
   * accusative (the common "für einen / in einen" recipe phrasing); a legacy
   * artifact without a case also starts there and is upgraded on confirm.
   */
  const [grammaticalCase, setGrammaticalCase] = useState<SizeMarkerCase>(
    initial?.grammaticalCase ?? 'akk',
  );
  /** The reference role; restored when editing and written on confirm. */
  const [reference, setReference] = useState(initial?.reference === true);
  const [error, setError] = useState<string | null>(null);

  const count = /^\d+$/.test(countText.trim()) ? Number(countText.trim()) : NaN;
  const countValid = Number.isSafeInteger(count) && count >= 1;
  const sizeValid = definition?.sizes.includes(size) ?? false;
  const preview =
    definition === undefined || !countValid || !sizeValid
      ? null
      : (resolveSizeMarker({ marker: definition.marker, count, size, grammaticalCase }, 1, {
          surface: 'prose',
        })?.text ??
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
        grammaticalCase,
        ...(reference ? { reference: true as const } : {}),
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

        {/* The case rule is read once and would cost a line on every visit;
            the caption's (i) toggle keeps it available without pushing the
            preview down (docs/ui_patterns.md §3). */}
        <InfoHint
          className="field"
          label="Fall"
          hintLabel="Hinweis zum grammatischen Fall"
          hint={<>Der Fall folgt dem Satz: „in einen“ (Akkusativ) oder „in einem“ (Dativ).</>}
        >
          <div className="quantity-chips" role="group" aria-label="Grammatischen Fall wählen">
            {(
              [
                ['nom', 'Nominativ'],
                ['akk', 'Akkusativ'],
                ['dat', 'Dativ'],
              ] as const
            ).map(([candidate, label]) => (
              <button
                key={candidate}
                type="button"
                className={candidate === grammaticalCase ? 'chip chip-active' : 'chip'}
                aria-pressed={candidate === grammaticalCase}
                onClick={() => {
                  setGrammaticalCase(candidate);
                  setError(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </InfoHint>

        <div className="field">
          <span className="field-label">Vorschau</span>
          <p className="aqs-preview" aria-live="polite">
            <span className="aqs-preview-value">{preview ?? 'Bitte Anzahl und Größe prüfen.'}</span>
          </p>
        </div>

        <div className="field">
          <span className="field-label">Referenz</span>
          <div className="quantity-chips" role="group" aria-label="Referenz">
            {/* Equipment never enters the master list where the ingredient
                reference star lives, so the size readout is where it shows. */}
            <button
              type="button"
              className={
                reference ? 'chip chip-reference chip-reference-on' : 'chip chip-reference'
              }
              aria-pressed={reference}
              aria-label={reference ? 'Nicht mehr als Referenz anzeigen' : 'Als Referenz anzeigen'}
              title={reference ? 'Nicht mehr als Referenz anzeigen' : 'Als Referenz anzeigen'}
              onClick={() => setReference((current) => !current)}
            >
              {reference ? (
                <StarFilledIcon className="chip-icon" optical={20} />
              ) : (
                <StarIcon className="chip-icon" optical={20} />
              )}
              <span>Referenz</span>
            </button>
          </div>
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
