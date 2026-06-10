import { defineConfig } from "vitest/config";

// Tests de la SIMULATION uniquement : code pur, environnement node, AUCUN Babylon ni DOM.
// (Critère §11 : `npm run test` doit faire tourner les tests de sim/ sans lancer le rendu.)
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
