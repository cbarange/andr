// Copie le WASM de Havok dans public/ pour que `locateFile` le serve à la racine.
// Pourquoi : le package @babylonjs/havok n'expose pas son .wasm via son champ "exports",
// donc un import `?url` est bloqué. Le placer dans public/ marche en dev ET au build
// (Vite sert public/ à la racine en dev et le copie tel quel dans dist/).
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm");
const destDir = resolve(root, "public");
const dest = resolve(destDir, "HavokPhysics.wasm");

if (!existsSync(src)) {
  console.warn("[copy-havok-wasm] WASM introuvable (deps installées ?):", src);
  process.exit(0); // ne pas casser un `npm install` partiel
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log("[copy-havok-wasm] ->", dest);
