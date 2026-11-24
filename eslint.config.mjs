import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  // Taste-skill vendor kit under public/assets is plain JS (not React); keep eslint off it.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/assets/**", ".agents/**", ".taste-skill/**"]),
]);

