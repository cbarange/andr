import { defineConfig } from "vite";

// Build/serveur de dev. Choix documentés dans le README :
// - cible esnext : bundle moderne léger.
// - @babylonjs/havok exclu de l'optimizeDeps : son .wasm est servi depuis public/
//   et localisé via `locateFile` (voir src/render/physics.ts + scripts/copy-havok-wasm.mjs).
// - port fixe 5173 : Playwright (tests e2e) s'y connecte de façon déterministe.
export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  // Havok exclu du pré-bundling : son .wasm est servi depuis public/ via locateFile.
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
  },
  build: { target: "esnext" },
});
