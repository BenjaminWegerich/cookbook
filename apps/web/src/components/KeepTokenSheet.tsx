/**
 * Keep token sheet (decided with the user: the app asks for the gateway token
 * automatically after the Google login, and the same sheet is reopened from the
 * "Essensplan" tab whenever the connection is missing).
 *
 * The browser cannot log into Google Keep itself — the master token that can
 * edit the notes lives in the Keep gateway (see docs/ARCHITECTURE.md). What the
 * app needs is only the shared gateway token, which the user keeps in Google
 * Passwords and pastes here. It is held in memory for the session and never
 * stored (N6, ./sessionToken), so a page reload asks again.
 *
 * UI language is German (docs/CODING_CONVENTIONS.md).
 */

import { useState, type FormEvent } from 'react';

import { keepErrorMessage } from '../keep/keepClient';
import { useEscapeTrigger } from '../hooks/useLeaveGuard';
import { CloseIcon } from './icons';

interface KeepTokenSheetProps {
  /** Closes the sheet without connecting (backdrop, close button, Escape). */
  onClose: () => void;
  /**
   * Stores the token and reads both Keep notes. Resolves on success; on failure
   * it throws, and the sheet shows the reason inline.
   */
  onConnect: (gatewayToken: string) => Promise<void>;
}

/**
 * The token sheet (see file header). It stays open on a failure so the reason
 * is visible next to the field; on success it closes itself, because the list
 * behind it re-renders with the meal plan.
 */
function KeepTokenSheet({ onClose, onConnect }: KeepTokenSheetProps) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape closes the sheet — the keyboard equivalent of the backdrop tap and
  // of the browser Back button (App's history integration). No confirmation:
  // nothing is entered yet that would be lost beyond the typed token.
  useEscapeTrigger(onClose);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || token.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await onConnect(token);
      onClose();
    } catch (err) {
      setError(keepErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} role="presentation" />
      <div
        className="sheet keep-token-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keep-token-title"
      >
        <div className="sheet-head">
          <h2 className="sheet-title" id="keep-token-title">
            Google Keep verbinden
          </h2>
          <p>
            Cookbook liest daraus deinen Essensplan und schreibt später die Einkaufsliste. Dafür
            braucht die App den Keep-Zugangscode.
          </p>
          <p className="keep-token-note">
            Der Code bleibt nur für diese Sitzung im Speicher und wird niemals dauerhaft
            gespeichert.
          </p>
        </div>

        <form className="keep-token-form" onSubmit={(event) => void handleSubmit(event)}>
          <input
            type="password"
            autoComplete="off"
            autoFocus
            className="keep-token-input"
            value={token}
            placeholder="Keep-Zugangscode einfügen"
            aria-label="Keep-Zugangscode"
            onChange={(event) => setToken(event.target.value)}
          />

          {error !== null && (
            <p className="keep-token-error" role="alert">
              {error}
            </p>
          )}

          <div className="sheet-actions">
            <button type="button" className="text-button" onClick={onClose}>
              <CloseIcon className="button-icon" />
              <span>Überspringen</span>
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={busy || token.trim() === ''}
              aria-busy={busy}
            >
              {busy ? 'Verbinden …' : 'Zugangscode verwenden'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

export default KeepTokenSheet;
