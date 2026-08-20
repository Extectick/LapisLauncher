import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({})] },
  preload: { plugins: [externalizeDepsPlugin({})] },
  // Electron production loads the renderer through file://. Relative output URLs
  // keep public assets inside the packaged renderer instead of resolving at disk root.
  renderer: { base: "./", plugins: [react({})] },
});
