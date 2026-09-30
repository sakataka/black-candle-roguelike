import { rm } from "node:fs/promises";
import { resolve } from "node:path";
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
  plugins: [
    {
      // SFX Forge の候補WAV（ライブラリ素材そのものを含む）は配布物に入れない
      name: "exclude-sfx-candidates",
      apply: "build",
      async closeBundle() {
        await rm(resolve(__dirname, "dist/sfx/_candidates"), { recursive: true, force: true });
      },
    },
  ],
});
