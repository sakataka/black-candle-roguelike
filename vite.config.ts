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
    strictPort: true,
    port: 1420,
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
