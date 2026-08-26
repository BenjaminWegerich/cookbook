import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted UI typeface (bundled at build time, no runtime font fetch).
import '@fontsource-variable/source-sans-3';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
