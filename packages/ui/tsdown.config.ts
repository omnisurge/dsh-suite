import { defineConfig } from "tsdown";

/** Library consumed at build time. React stays external (ADR-028 single-React). */
export default defineConfig({
  entry: { index: "src/index.ts", "intercept-method": "src/intercept-method.ts" },
  tsconfig: "tsconfig.json",
  format: ["esm"],
  outDir: "lib",
  dts: false,
  sourcemap: true,
  deps: { neverBundle: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"] },
  outExtensions: () => ({ js: ".js" }),
});
