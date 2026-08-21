import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site under the repository sub-path
  // (https://BenjaminWegerich.github.io/cookbook/), so all assets are
  // resolved relative to "/cookbook/".
  base: '/cookbook/',
});
