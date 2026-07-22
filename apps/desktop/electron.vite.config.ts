import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // Бандлим workspace-пакет в main (он ESM; Electron require иначе ломается).
    plugins: [
      externalizeDepsPlugin({ exclude: ["@service-monitor/core"] }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/main/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({ exclude: ["@service-monitor/core"] }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/preload/index.ts"),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src"),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/index.html"),
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src"),
        // Renderer: только browser-safe API (без node-зависимостей ядра).
        "@service-monitor/core": resolve(
          __dirname,
          "../../packages/core/src/browser.ts"
        ),
      },
    },
  },
});
