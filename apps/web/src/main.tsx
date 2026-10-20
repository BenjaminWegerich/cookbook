import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The UI typeface and the export-shortlist faces (DESIGN §4.2, §4.8), all
// self-hosted and bundled at build time — no runtime font fetch. The files and
// their two generated companions live in src/fonts (scripts/generate-noto-faces.mjs).
import './styles/fonts.css';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
