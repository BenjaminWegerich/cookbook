/**
 * The one bottom sheet behind the whole master data.
 *
 * Four flows render this component:
 * - „Zutat bearbeiten“ — the ingredient's fields except name and base unit
 *   (both are the entry's identity and shown disabled);
 * - „Neue Zutat anlegen“ — the same sheet with the name and base unit editable;
 * - „Einkaufsartikel verwalten“ — only the name, the shopping stop and the
 *   synonyms of an existing item;
 * - „Einkaufsartikel anlegen“ — the same item form with an editable name.
 *
 * The shared component is the reason the four flows cannot drift: the name
 * field, the „Einkauf“ field, the synonym editor, the disabled-field look and
 * the validation messages are one implementation. The two kinds differ only in
 * which sections they show: an ingredient carries the display forms, the base
 * unit, the additional-unit mappings, the precision and the reorder point in
 * addition to the shopping data.
 *
 * Creating an ingredient whose name already exists as a shopping item adopts
 * that item's stop and synonyms when the name field is left (or on open, when
 * the create flow already carries a name). The user's resulting Einkauf/
 * Synonyme values are handed to the parent, which writes them to the item row —
 * creating an ingredient never silently forks a second route for the same name.
 *
 * The ingredient's „Einkauf“ field is **optional**: an ingredient without an
 * item row is simply never bought (docs/storage_format.md §10). The item form
 * still requires it — that row *is* the route. Once a store is picked, a section
 * is required, because the pair is the key and a section belongs to exactly one
 * store. The „× Entfernen“ chip beside the store chips clears the pick; it also
 * clears the synonyms, because a synonym can only live on an item row, and the
 * save then deletes the row — its notice's „Rückgängig“ restores stop and
 * synonyms.
 *
 * A duplicate name is reported **under the name field** as soon as the field is
 * left, not at the bottom of the sheet: the field is where the user can fix it.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useRef, useState } from 'react';

import {
  allShoppingItems,
  allShoppingSynonyms,
  formatDecimal,
  masterIngredientNames,
  mappingsFor,
  shoppingNameKey,
  shoppingSections,
  shoppingStores,
  shoppingVariantsFor,
  validateShoppingVariant,
  type IngredientEntry,
  type PrecisionLevel,
  type ShoppingStop,
  type ShoppingSynonyms,
} from '@cookbook/core';

import IngredientMappingsField from './IngredientMappingsField';
import PrecisionChips from './PrecisionChips';
import QuantityInput from './QuantityInput';
import { CloseIcon } from './icons';
import {
  buildMappingRows,
  displayFormsFromValues,
  mappingEntriesFromRows,
  mappingFormFromEntry,
  validateDisplayForms,
  validateMappingRows,
} from './ingredientMasterForm';
import { useSaveShortcut } from '../hooks/useSaveShortcut';

/** Which master-data record the sheet edits. */
export type MasterDataSheetKind = 'ingredient' | 'item';

/** The values one ingredient save hands to the parent. */
export interface IngredientSheetResult {
  readonly kind: 'ingredient';
  readonly name: string;
  readonly bu: 'g' | 'ml';
  readonly singular: string | null;
  readonly plural: string | null;
  readonly reorderPoint: number;
  readonly entries: ReadonlyArray<{ au: string; factor: number }>;
  readonly precision: PrecisionLevel;
  /** The chosen shopping stop, or null when the ingredient is not bought. */
  readonly stop: ShoppingStop | null;
  /** The complete synonym list the item should carry. */
  readonly variants: readonly string[];
}

/** The values one item save hands to the parent. */
export interface ShoppingItemSheetResult {
  readonly kind: 'item';
  readonly name: string;
  readonly stop: ShoppingStop;
  readonly variants: readonly string[];
}

/** The consumed form values of one save, tagged by the sheet kind. */
export type MasterDataSheetResult = IngredientSheetResult | ShoppingItemSheetResult;

interface MasterDataSheetProps {
  /** Ingredient form or shopping-item form. */
  kind: MasterDataSheetKind;
  /** True while the sheet creates a record; false while it edits one. */
  creating: boolean;
  /** The name the form opens with (the create flow's typed name, or the row's key). */
  initialName: string;
  /** The ingredient entry being edited. Required for an ingredient edit. */
  entry?: IngredientEntry;
  /** Which write is running, if any; both actions are unavailable meanwhile. */
  busy: 'save' | 'delete' | null;
  /** Drive error of the last save attempt (German, from the storage layer). */
  error: string | null;
  /** Called with the validated values; the parent persists them. */
  onSave: (result: MasterDataSheetResult) => void;
  /** Called by „Einkaufsartikel löschen“; only an item edit passes this. */
  onDelete?: () => void;
  /** Called when the user edits any field — the parent forgets a stale error. */
  onEdited: () => void;
  onClose: () => void;
}

/** The two base-unit families (kg/l exist only in display). */
const BASE_UNITS = ['g', 'ml'] as const;

/** One existing shopping item found by a name, with its stored spelling. */
interface FoundItem {
  readonly name: string;
  readonly stop: ShoppingStop;
  readonly variants: readonly string[];
}

/**
 * Finds the shopping item a typed name points at, case-folded like the item
 * matching itself. Returns the stored spelling so a save can update the row the
 * user already has instead of creating a case-variant duplicate.
 */
function findItem(name: string): FoundItem | null {
  const key = shoppingNameKey(name);
  if (key === '') return null;
  const stored = Object.keys(allShoppingItems()).find(
    (candidate) => shoppingNameKey(candidate) === key,
  );
  if (stored === undefined) return null;
  return {
    name: stored,
    stop: allShoppingItems()[stored]!,
    variants: shoppingVariantsFor(stored),
  };
}

/** The draft synonym table the candidate is checked against (see EditSheet). */
function draftSynonyms(item: string, variants: readonly string[]): ShoppingSynonyms {
  const next: Record<string, string> = {};
  for (const [variant, owner] of Object.entries(allShoppingSynonyms())) {
    if (shoppingNameKey(owner) !== shoppingNameKey(item)) {
      next[variant] = owner;
    }
  }
  for (const variant of variants) {
    next[variant] = item;
  }
  return next;
}

/**
 * The shared master-data sheet (see file header). The parent mounts it with a
 * `key`, so opening another record starts from that record's values.
 */
function MasterDataSheet({
  kind,
  creating,
  initialName,
  entry,
  busy,
  error,
  onSave,
  onDelete,
  onEdited,
  onClose,
}: MasterDataSheetProps) {
  const ingredientMode = kind === 'ingredient';
  /**
   * The item the create flow starts from, if the typed name already names one.
   * An ingredient edit reads the same lookup, so a missing item simply starts
   * with an empty „Einkauf“ field (an ingredient that is never bought).
   */
  const initialItem = findItem(initialName);

  const [name, setName] = useState(initialName);
  const [bu, setBu] = useState<'g' | 'ml'>(entry?.bu === 'ml' ? 'ml' : 'g');
  const [singular, setSingular] = useState(entry?.singular ?? '');
  const [plural, setPlural] = useState(entry?.plural ?? '');
  const [reorderPoint, setReorderPoint] = useState(entry?.reorderPoint ?? 0);
  const [factors, setFactors] = useState<Record<string, string>>(() =>
    entry === undefined ? {} : mappingFormFromEntry(entry).factors,
  );
  const [precision, setPrecision] = useState<PrecisionLevel>(entry?.precision ?? 'medium');
  /** The chosen store — level 1 of the shopping route; null = nothing picked. */
  const [store, setStore] = useState<string | null>(initialItem?.stop.store ?? null);
  /** The section input text — level 2 of the route. */
  const [sectionQuery, setSectionQuery] = useState(initialItem?.stop.section ?? '');
  /** The complete desired synonym list of the item. */
  const [variants, setVariants] = useState<readonly string[]>(initialItem?.variants ?? []);
  /** The text of the „Synonym“ field, still waiting to be added. */
  const [variantQuery, setVariantQuery] = useState('');
  /**
   * True once the user touched the shopping fields themselves. A name blur then
   * no longer adopts another item's stop/synonyms over their edits.
   */
  const [shoppingTouched, setShoppingTouched] = useState(false);
  /** The name field's own message (mandatory or duplicate). */
  const [nameError, setNameError] = useState<string | null>(null);
  /** The synonym field's own message (validation or duplicate). */
  const [variantError, setVariantError] = useState<string | null>(null);
  /**
   * True after the first failed save attempt. Before it, an edit form is
   * pristine (the entry is valid by construction), so no field error shows;
   * after it, the messages update live while the user fixes their cause.
   */
  const [attempted, setAttempted] = useState(false);
  /** The copy-source autocomplete text in the create form ("" = nothing typed). */
  const [copyQuery, setCopyQuery] = useState('');

  const nameInputRef = useRef<HTMLInputElement>(null);
  const singularInputRef = useRef<HTMLInputElement>(null);
  const pluralInputRef = useRef<HTMLInputElement>(null);
  const mappingFieldRef = useRef<HTMLDivElement>(null);
  const stopFieldRef = useRef<HTMLDivElement>(null);

  const trimmedName = name.trim();
  /** Whether the name field is an input (create) or a disabled identity (edit). */
  const nameEditable = creating;

  const rows = buildMappingRows(factors);
  const displayError = validateDisplayForms(singular, plural);
  const mappingError = validateMappingRows(rows);
  const showDisplayError = attempted && displayError !== null;
  const showMappingError = attempted && mappingError !== null;

  /** The rows that would actually be saved (a finite positive factor). */
  const entries = mappingEntriesFromRows(rows).filter(
    (entry_) => Number.isFinite(entry_.factor) && entry_.factor > 0,
  );

  /**
   * The name message for the current state. For an existing record only the
   * mandatory check applies (the name is the row's key); a create form also
   * rejects a name that is taken **in the same category** — an existing shopping
   * item is not a conflict for an ingredient (it is adopted instead).
   */
  const nameErrorNow = ((): string | null => {
    if (!creating) return trimmedName === '' ? 'Bitte einen Namen angeben.' : null;
    if (trimmedName === '') return 'Bitte einen Namen angeben.';
    if (ingredientMode) {
      const taken = masterIngredientNames().some(
        (candidate) => shoppingNameKey(candidate) === shoppingNameKey(trimmedName),
      );
      return taken ? `„${trimmedName}“ existiert bereits in den Stammdaten.` : null;
    }
    return findItem(trimmedName) !== null
      ? `„${trimmedName}“ existiert bereits als Einkaufsartikel.`
      : null;
  })();

  const stores = shoppingStores();
  const sections = store === null ? [] : shoppingSections(store);
  const section = sectionQuery.trim();

  /**
   * The stop the picker currently names, or null while it is incomplete. The
   * section must be one of this store's sections — the pair is the key, so free
   * text is not a valid stop.
   */
  const chosenStop: ShoppingStop | null =
    store !== null && sections.includes(section) ? { store, section } : null;

  /**
   * Whether this form needs a stop. An item always does (its row is the route).
   * An ingredient is optional: it may stay unbought, and clearing an existing
   * row is a sanctioned change (the write deletes the row). Synonyms are the one
   * exception — they exist only on an item row, so the stop is required while
   * the form carries any.
   */
  const stopRequired = !ingredientMode || variants.length > 0;

  /** The message the „Einkauf“ field would report for the current state. */
  const stopError = ((): string | null => {
    if (stores.length === 0) {
      if (!ingredientMode) {
        return 'Kein Einkaufsweg hinterlegt — der Einkaufsort kann nicht gewählt werden.';
      }
      return variants.length > 0
        ? 'Ohne Einkaufsweg lässt sich kein Einkaufsartikel für die Synonyme anlegen.'
        : null;
    }
    if (store === null) {
      return stopRequired ? 'Bitte einen Markt auswählen.' : null;
    }
    if (section === '') {
      return `Bitte einen Bereich für „${store}“ auswählen.`;
    }
    if (!sections.includes(section)) {
      return `„${section}“ steht nicht im Einkaufsweg für „${store}“ — bitte einen der angebotenen Bereiche wählen.`;
    }
    return null;
  })();

  /**
   * The banner for a form with several problems (DESIGN §5.3): the field
   * messages name each one, the banner says that more than one field needs
   * attention. One field alone stays at its field, without a banner.
   */
  const showSummary =
    (showDisplayError ? 1 : 0) +
      (showMappingError ? 1 : 0) +
      (attempted && stopError !== null ? 1 : 0) +
      (attempted && nameErrorNow !== null ? 1 : 0) >
    1;

  /** Reports a form edit to the parent, which drops a stale Drive error. */
  const markEdited = (): void => onEdited();

  /** Marks the shopping fields as user-edited (stops name-blur prefill). */
  const markShoppingEdited = (): void => {
    setShoppingTouched(true);
    markEdited();
  };

  /**
   * Adopts the stop and synonyms of an existing shopping item into the create
   * form. Runs when the name field is left (and is already applied on open for
   * a create flow that carries a name), and only while the user has not edited
   * the shopping fields themselves.
   */
  const adoptItemForName = (nextName: string): void => {
    const match = findItem(nextName);
    setStore(match?.stop.store ?? null);
    setSectionQuery(match?.stop.section ?? '');
    setVariants(match?.variants ?? []);
    setVariantError(null);
  };

  /**
   * Leaves the name field: the duplicate message appears now (not only on a
   * save attempt), and a create ingredient adopts the matching item's data.
   */
  const handleNameBlur = (): void => {
    if (!creating) return;
    setNameError(nameErrorNow);
    setVariantError(null);
    if (nameErrorNow === null && ingredientMode && !shoppingTouched) {
      adoptItemForName(name);
    }
  };

  /** Picks a store. A section belongs to exactly one store, so it is cleared. */
  const chooseStore = (next: string): void => {
    setStore(next);
    setSectionQuery('');
    markShoppingEdited();
  };

  /** Adopts a section option into the search field (same tap-to-apply). */
  const adoptSection = (next: string): void => {
    setSectionQuery(next);
    markShoppingEdited();
  };

  /**
   * Drops the whole shopping stop — the „× Entfernen“ chip's action. A section
   * needs its store, so it goes with it. The synonyms go too: a variant only
   * exists on an item row, and this form is now describing an ingredient that is
   * not bought. The save deletes the row, and its notice restores stop and
   * synonyms with one „Rückgängig“.
   */
  const removeStop = (): void => {
    setStore(null);
    setSectionQuery('');
    setVariants([]);
    setVariantError(null);
    markShoppingEdited();
  };

  /**
   * Adds the typed synonym to the form. The candidate is checked against the
   * draft table, so a removed-and-retyped variant is allowed and a duplicate or
   * shadowed article name is refused with the exact reason under the field.
   */
  const addVariant = (): void => {
    if (busy !== null) return;
    // A synonym belongs to an article, so the name has to exist first. Without
    // this guard the draft table would be keyed by "" and a later name change
    // could leave variants that never had an owner.
    if (trimmedName === '') {
      setVariantError('Bitte zuerst einen Namen angeben.');
      return;
    }
    const check = validateShoppingVariant(
      variantQuery,
      trimmedName,
      allShoppingItems(),
      draftSynonyms(trimmedName, variants),
    );
    if (!check.ok) {
      setVariantError(check.message);
      return;
    }
    setVariants([...variants, check.variant]);
    setVariantQuery('');
    setVariantError(null);
    markShoppingEdited();
  };

  /** Removes one synonym chip from the form (the save writes the new set). */
  const removeVariant = (variant: string): void => {
    setVariants(variants.filter((candidate) => candidate !== variant));
    setVariantError(null);
    markShoppingEdited();
  };

  /**
   * Copies the mappings of `source` into the form (AU rows are overwritten).
   * Factors enter the inputs with the German decimal comma ("7,5").
   */
  const applyCopy = (source: string): void => {
    const sourceEntry = mappingsFor(source);
    if (sourceEntry === undefined) return;
    const nextFactors = { ...factors };
    for (const mapping of sourceEntry.entries) {
      nextFactors[mapping.au] = formatDecimal(mapping.factor);
    }
    setFactors(nextFactors);
    markEdited();
  };

  /** Adopts a copy suggestion and clears the autocomplete (tap-to-apply). */
  const adoptCopy = (candidate: string): void => {
    applyCopy(candidate);
    setCopyQuery('');
  };

  /**
   * Validates and saves. A failure shows the field errors and moves focus to the
   * first problem; the form's values stay untouched, so the user can correct one
   * thing without losing the rest.
   */
  const handleSave = (): void => {
    if (busy !== null) return;

    if (nameErrorNow !== null) {
      setNameError(nameErrorNow);
      setAttempted(true);
      nameInputRef.current?.focus();
      return;
    }

    if (ingredientMode) {
      if (displayError !== null) {
        setAttempted(true);
        if (singular.trim() === '') {
          singularInputRef.current?.focus();
        } else {
          pluralInputRef.current?.focus();
        }
        return;
      }
      if (mappingError !== null) {
        setAttempted(true);
        mappingFieldRef.current?.focus();
        return;
      }
    }

    if (stopError !== null) {
      setAttempted(true);
      stopFieldRef.current?.focus();
      return;
    }

    setAttempted(false);

    if (!ingredientMode) {
      // `stopError` is null and the item form always requires a stop, so the
      // picker names a valid pair here.
      if (chosenStop === null) return;
      onSave({ kind: 'item', name: trimmedName, stop: chosenStop, variants });
      return;
    }

    const forms = displayFormsFromValues(singular, plural);
    onSave({
      kind: 'ingredient',
      name: trimmedName,
      bu,
      singular: forms.singular,
      plural: forms.plural,
      reorderPoint,
      entries,
      precision,
      stop: chosenStop,
      variants,
    });
  };

  // Ctrl+S is the keyboard equivalent of the „Speichern“ button. The sheet is
  // only ever mounted while it is the topmost layer, so the shortcut is enabled.
  useSaveShortcut(handleSave);

  /** The options under the section field: all of the store's sections while
   *  nothing is typed, the matching ones while a part is typed, none once the
   *  text names one exactly (the pick moved into the field). */
  const sectionSuggestions = sections.includes(section)
    ? []
    : sections.filter((candidate) => candidate.toLowerCase().includes(section.toLowerCase()));

  /**
   * Ingredients whose mappings can be copied: master-data ingredients with at
   * least one mapping and the same base-unit family. Read every render so a
   * just-created ingredient appears once it is registered.
   */
  const copyCandidates = ingredientMode
    ? masterIngredientNames().filter((candidate) => {
        if (candidate.toLowerCase() === trimmedName.toLowerCase()) return false;
        const candidateEntry = mappingsFor(candidate);
        return (
          candidateEntry !== undefined &&
          candidateEntry.bu === bu &&
          candidateEntry.entries.length > 0
        );
      })
    : [];
  const copyNeedle = copyQuery.trim().toLowerCase();
  const copySuggestions =
    copyNeedle === ''
      ? []
      : copyCandidates
          .filter((candidate) => candidate.toLowerCase().includes(copyNeedle))
          .slice(0, 6);

  /**
   * Whether the name input takes the focus when the sheet opens. A focused input
   * pops up the phone keyboard, so an edit or a prefilled create flow does not
   * steal the focus; only a genuinely blank create flow does.
   */
  const focusNameOnOpen = creating && initialName.trim() === '';

  const title = ingredientMode
    ? creating
      ? 'Neue Zutat anlegen'
      : 'Zutat bearbeiten'
    : creating
      ? 'Einkaufsartikel anlegen'
      : 'Einkaufsartikel verwalten';

  return (
    <>
      <div
        className="sheet-backdrop"
        onClick={busy !== null ? undefined : onClose}
        role="presentation"
        aria-hidden={busy !== null}
      />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h3 className="sheet-title">{title}</h3>

        {/* A Drive failure belongs to no field: it is the save itself that
            failed, so it is reported once above the form (DESIGN §5.3). */}
        {error !== null && (
          <p className="master-banner" role="alert">
            {error}
          </p>
        )}

        {showSummary && (
          <p className="master-banner" role="alert">
            Bitte die markierten Felder prüfen.
          </p>
        )}

        {/* The name. An edit shows the record's identity in a disabled field
            (the user asked for it below the title, replacing the old subtitle
            that carried name and base unit). */}
        <label className="field">
          <span className="field-label">Name</span>
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            disabled={!nameEditable}
            autoFocus={focusNameOnOpen}
            aria-invalid={nameError !== null || undefined}
            aria-describedby={nameError !== null ? 'master-name-error' : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(null);
              setVariantError(null);
              markEdited();
            }}
            onBlur={handleNameBlur}
          />
          {nameError !== null && (
            <span className="field-error" id="master-name-error" role="alert">
              {nameError}
            </span>
          )}
        </label>

        {ingredientMode && (
          <>
            {/* Optional Singular/Plural display forms. The two sub-captions are
                quiet hint text, not field captions (decided with the user). */}
            <fieldset className="field display-form-field">
              <legend className="field-label">
                Anzeigeform <span className="optional-mark">(optional)</span>
              </legend>
              <label className="field">
                <span className="field-hint">Singular</span>
                <input
                  ref={singularInputRef}
                  type="text"
                  value={singular}
                  aria-invalid={showDisplayError || undefined}
                  aria-describedby={showDisplayError ? 'display-form-error' : undefined}
                  onChange={(event) => {
                    setSingular(event.target.value);
                    markEdited();
                  }}
                />
              </label>
              <label className="field">
                <span className="field-hint">Plural</span>
                <input
                  ref={pluralInputRef}
                  type="text"
                  value={plural}
                  aria-invalid={showDisplayError || undefined}
                  aria-describedby={showDisplayError ? 'display-form-error' : undefined}
                  onChange={(event) => {
                    setPlural(event.target.value);
                    markEdited();
                  }}
                />
              </label>
              <p className="field-hint">
                Beide ausfüllen oder beide leer lassen — leer gilt der Name für jede Anzahl.
              </p>
              {showDisplayError && (
                <p className="field-error" id="display-form-error" role="alert">
                  {displayError}
                </p>
              )}
            </fieldset>

            {/* The base unit is a card toggle like the create sheet's; in an
                edit it is disabled because it decides how every stored quantity
                is read. */}
            <div className="field">
              <span className="field-label">Basis-Einheit</span>
              <div className="segmented" role="radiogroup" aria-label="Basis-Einheit">
                {BASE_UNITS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={bu === option}
                    className={bu === option ? 'segmented-active' : undefined}
                    disabled={!creating || busy !== null}
                    onClick={() => {
                      setBu(option);
                      markEdited();
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            {/* The mapping group: the caption names the field, the grid renders
                one row per known unit. A failed save focuses the group, because
                the exact invalid input is one of several rows. */}
            <div
              className="field"
              role="group"
              aria-labelledby="mapping-field-label"
              aria-describedby={showMappingError ? 'mapping-error' : undefined}
              tabIndex={-1}
              ref={mappingFieldRef}
            >
              <span className="field-label" id="mapping-field-label">
                Zusatz-Einheiten <span className="optional-mark">(optional)</span>
              </span>

              {creating && copyCandidates.length > 0 && (
                <>
                  <p className="field-hint">Von bekannter Zutat übernehmen:</p>
                  <input
                    type="text"
                    value={copyQuery}
                    onChange={(event) => setCopyQuery(event.target.value)}
                    aria-label="Von bekannter Zutat übernehmen"
                  />
                  {copySuggestions.length > 0 && (
                    <ul className="suggestions">
                      {copySuggestions.map((candidate) => (
                        <li key={candidate}>
                          <button
                            type="button"
                            className="chip"
                            onClick={() => adoptCopy(candidate)}
                          >
                            {candidate}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="field-hint">Manuell anpassen:</p>
                </>
              )}

              <IngredientMappingsField
                bu={bu}
                factors={factors}
                onFactorChange={(au, value) => {
                  setFactors((current) => ({ ...current, [au]: value }));
                  markEdited();
                }}
              />
              {showMappingError && (
                <p className="field-error" id="mapping-error" role="alert">
                  {mappingError}
                </p>
              )}
            </div>

            {/* Ingredient-level precision: a display preference, not a scale.
                The hint follows the chips, where it explains the choice. */}
            <div className="field">
              <span className="field-label">Genauigkeit</span>
              <PrecisionChips
                value={precision}
                onChange={(next) => {
                  setPrecision(next);
                  markEdited();
                }}
                ariaLabel="Genauigkeit der Zutat"
              />
              <p className="field-hint">
                Je niedriger die Genauigkeit, desto stärker wird auf glatte Zahlen gerundet. Der
                hier gewählte Zutat-Standard kann auf Rezept-Ebene übersteuert werden.
              </p>
            </div>

            {/* The reorder point: what is on the shelf after a shopping trip.
                Same picker as a recipe quantity, plus 0 and ∞; the value is
                stored as entered, without quantity optimization. */}
            <div className="field">
              <span className="field-label">Vorrat</span>
              <QuantityInput
                value={reorderPoint}
                onChange={(next) => {
                  setReorderPoint(next);
                  markEdited();
                }}
                family={bu}
                allowZero
                allowInfinite
              />
              <p className="field-hint">
                Menge auswählen, auf die du den Vorrat beim Einkaufen mindestens ausfüllst, auch
                wenn kein eingeplantes Gericht die Zutat braucht.
              </p>
            </div>
          </>
        )}

        {/* Where the record is bought (docs/storage_format.md §10): level 1 the
            store („Markt“ in the UI, one tap on a chip), level 2 the section
            („Bereich“ in the UI) as a search field with that store's sections
            listed below it. The sub-captions use the quiet hint style. */}
        <div
          className="field"
          role="group"
          aria-labelledby="shopping-stop-label"
          aria-describedby={attempted && stopError !== null ? 'shopping-stop-error' : undefined}
          tabIndex={-1}
          ref={stopFieldRef}
        >
          <span className="field-label" id="shopping-stop-label">
            Einkauf
            {/* The item row is the route, so only the ingredient form may leave
                the field empty — and only while it carries no synonyms, which
                cannot live without a row (see the file header). */}
            {ingredientMode && !stopRequired && <span className="optional-mark">optional</span>}
          </span>

          {stores.length === 0 ? (
            <p className="field-hint">
              {ingredientMode
                ? 'Kein Einkaufsweg hinterlegt (einkaufsweg.csv) — die Zutat wird ohne Einkaufsort gespeichert.'
                : 'Kein Einkaufsweg hinterlegt (einkaufsweg.csv) — der Einkaufsort kann nicht gewählt werden.'}
            </p>
          ) : (
            <>
              <p className="field-hint">Markt</p>
              <div className="store-chips" role="group" aria-label="Markt">
                {stores.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={store === candidate ? 'chip chip-active' : 'chip'}
                    aria-pressed={store === candidate}
                    onClick={() => chooseStore(candidate)}
                    disabled={busy !== null}
                  >
                    {candidate}
                  </button>
                ))}
                {/* The way back to "not bought": the chip row has no empty
                    slot, so the ingredient form needs its own clear action
                    (the same dashed clear chip as the optional fields in the
                    quantity sheet). The item form omits it — its row is the
                    route and a missing store would be a dead end. */}
                {ingredientMode && store !== null && (
                  <button
                    type="button"
                    className="chip chip-clear"
                    onClick={removeStop}
                    title="Einkauf entfernen"
                    disabled={busy !== null}
                  >
                    <CloseIcon className="chip-icon" optical={20} />
                    <span>Entfernen</span>
                  </button>
                )}
              </div>

              {/* The section field follows the store: without a store there is
                  no option to offer, and a section belongs to exactly one store. */}
              {store !== null && (
                <>
                  <p className="field-hint">Bereich</p>
                  <input
                    type="text"
                    value={sectionQuery}
                    onChange={(event) => {
                      setSectionQuery(event.target.value);
                      markShoppingEdited();
                    }}
                    aria-label={`Bereich in ${store}`}
                    placeholder="Suchen oder wählen"
                    disabled={busy !== null}
                  />
                  {sectionSuggestions.length > 0 && (
                    <ul className="suggestions">
                      {sectionSuggestions.map((candidate) => (
                        <li key={candidate}>
                          <button
                            type="button"
                            className="chip"
                            onClick={() => adoptSection(candidate)}
                            disabled={busy !== null}
                          >
                            {candidate}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Nothing matches: the established bare em dash, suppressed
                      while the field names a section exactly. */}
                  {section !== '' &&
                    !sections.includes(section) &&
                    sectionSuggestions.length === 0 && (
                      <p className="field-hint" role="status">
                        —
                      </p>
                    )}
                </>
              )}
            </>
          )}

          {attempted && stopError !== null && (
            <p className="field-error" id="shopping-stop-error" role="alert">
              {stopError}
            </p>
          )}
        </div>

        {/* What else the item is called (docs/shopping_item_identity.md §1):
            one chip per variant and a field that adds the next one. */}
        <div className="field">
          <span className="field-label">Synonyme</span>
          <p className="field-hint">
            Weitere Schreibweisen auf der Einkaufsliste, die auf diesen Artikel verweisen. Groß- und
            Kleinschreibung wird ignoriert.
          </p>

          {variants.length === 0 ? (
            <p className="field-hint">Noch keine Synonyme.</p>
          ) : (
            <ul className="suggestions">
              {variants.map((variant) => (
                <li key={variant}>
                  <button
                    type="button"
                    className="chip chip-clear"
                    onClick={() => removeVariant(variant)}
                    aria-label={`Synonym „${variant}“ entfernen`}
                    disabled={busy !== null}
                  >
                    <span>{variant}</span>
                    <CloseIcon className="chip-icon" optical={20} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="synonym-add">
            <input
              type="text"
              value={variantQuery}
              onChange={(event) => {
                setVariantQuery(event.target.value);
                setVariantError(null);
                markEdited();
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addVariant();
              }}
              placeholder="Synonym"
              aria-label="Neues Synonym"
              aria-describedby={variantError === null ? undefined : 'shopping-variant-error'}
              disabled={busy !== null}
            />
            <button
              type="button"
              className="add-button"
              onClick={addVariant}
              disabled={busy !== null}
            >
              Hinzufügen
            </button>
          </div>

          {variantError !== null && (
            <p className="field-error" id="shopping-variant-error" role="alert">
              {variantError}
            </p>
          )}
        </div>

        <div className="sheet-actions master-sheet-actions">
          {!creating && !ingredientMode && onDelete !== undefined && (
            <button
              type="button"
              className="danger-button"
              onClick={onDelete}
              disabled={busy !== null}
              aria-busy={busy === 'delete'}
            >
              {busy === 'delete' ? 'Löscht …' : 'Einkaufsartikel löschen'}
            </button>
          )}
          <button type="button" className="text-button" onClick={onClose} disabled={busy !== null}>
            Abbrechen
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleSave}
            disabled={busy !== null}
            aria-busy={busy === 'save'}
          >
            {busy === 'save' ? 'Speichert …' : 'Speichern'}
          </button>
        </div>
      </div>
    </>
  );
}

export default MasterDataSheet;
