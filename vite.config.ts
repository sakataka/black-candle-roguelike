import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
  },
  clearScreen: false,
  server: {
    // port は LocalWeb が `localweb dev` の --port で渡す。
    strictPort: true,
  },
});
