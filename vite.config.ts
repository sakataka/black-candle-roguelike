import { defineConfig } from "vite";

export default defineConfig({
  base: "/black-candle-roguelike/",
  build: {
    target: "esnext",
  },
  clearScreen: false,
  server: {
    strictPort: true,
    port: 1420,
  },
});
