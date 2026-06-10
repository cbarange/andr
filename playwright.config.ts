import { defineConfig } from "@playwright/test";

// Vérification visuelle headless (§11 : capture d'écran committée).
// Chromium headless n'expose en général pas WebGPU et n'a pas de GPU matériel : on force
// un rendu logiciel (SwiftShader/ANGLE) pour que le canvas WebGL2 produise réellement une image.
// Le chemin WebGPU est, lui, vérifié manuellement dans un vrai navigateur (voir README).
export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    launchOptions: {
      args: [
        "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ],
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
