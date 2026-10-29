import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

// Electron 메인/프리로드는 CommonJS(.cjs)로 빌드한다 (package.json이 "type": "module"이므로).
// 메인은 lib 모드, 프리로드는 rollup input 모드로 빌드되므로 각각 형식을 지정한다.
const mainCjs = { build: { lib: { entry: "electron/main.ts", formats: ["cjs" as const], fileName: () => "main.cjs" } } };
const preloadCjs = { build: { rollupOptions: { output: { format: "cjs" as const, entryFileNames: "[name].cjs", inlineDynamicImports: true } } } };

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    electron({
      main: { entry: "electron/main.ts", vite: mainCjs },
      preload: { input: "electron/preload.ts", vite: preloadCjs },
    }),
  ],
  server: { watch: { ignored: ["**/REA/**", "**/release/**"] } },
  optimizeDeps: { entries: ["index.html"] },
});
