import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  root: "app",
  publicDir: "public",
  base: mode === "pages" ? "/plebiscito-della-mosca/" : "/",
  server: { port: 5173, host: true },
  preview: { port: 5173, host: true },
  worker: { format: "es" },
  build: { outDir: "../dist", emptyOutDir: true },
}));
