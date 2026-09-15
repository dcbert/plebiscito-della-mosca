import { defineConfig } from "vite";

export default defineConfig({
  root: "app",
  publicDir: "public",
  base: process.env.BASE || "/",
  server: { port: 5173, host: true },
  preview: { port: 5173, host: true },
  worker: { format: "es" },
  build: { outDir: "../dist", emptyOutDir: true },
});
