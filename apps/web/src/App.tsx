import { useState } from 'react';

import { getAccessToken, requestAccessToken, revokeAccessToken } from './auth/googleAuth';
import { listFiles, type DriveFile } from './drive/driveClient';

/**
 * Root component of the web app.
 *
 * Neutral placeholder: it proves the Google Drive connection (OAuth login →
 * token → first Drive API call) end to end. The actual UI (smartphone +
 * smart display layout, custom typography) is designed in a later roadmap
 * task together with the user. The UI language is German
 * (see docs/CODING_CONVENTIONS.md).
 */
function App() {
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Logs in and immediately checks the Drive connection. */
  const handleConnect = async (): Promise<void> => {
    setError(null);
    try {
      const newToken = await requestAccessToken();
      setToken(newToken);
      await refreshFiles(newToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** Logs out and clears the session state. */
  const handleDisconnect = async (): Promise<void> => {
    setError(null);
    await revokeAccessToken();
    setToken(null);
    setFiles(null);
  };

  /** Refreshes the file list via the Drive API. */
  const refreshFiles = async (activeToken: string): Promise<void> => {
    setError(null);
    try {
      setFiles(await listFiles(activeToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="app">
      <h1>Cookbook</h1>
      <p>Grundgerüst der Web-App — Design und Funktionen folgen.</p>

      <section className="drive-connect" aria-label="Google Drive">
        {token ? (
          <>
            <p>Mit Google Drive verbunden.</p>
            <button type="button" onClick={() => refreshFiles(token)}>
              Dateien aktualisieren
            </button>
            <button type="button" onClick={handleDisconnect}>
              Trennen
            </button>
            {files &&
              (files.length === 0 ? (
                <p>Noch keine Dateien in der App.</p>
              ) : (
                <ul>
                  {files.map((file) => (
                    <li key={file.id}>{file.name}</li>
                  ))}
                </ul>
              ))}
          </>
        ) : (
          <>
            <p>Noch nicht verbunden.</p>
            <button type="button" onClick={handleConnect}>
              Mit Google verbinden
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}

export default App;
