import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted UI typeface (bundled at build time, no runtime font fetch).
import '@fontsource-variable/source-sans-3';
// Export-shortlist typefaces (DESIGN §4.8) — bundled so the recipe editor's
// theme chips and preview render each face faithfully.
import '@fontsource-variable/bitter';
import '@fontsource-variable/caveat';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import '@fontsource-variable/montserrat';
import '@fontsource-variable/nunito';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/source-serif-4';
// The IBM Plex faces ship only as static weights.
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-sans-condensed/400.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
