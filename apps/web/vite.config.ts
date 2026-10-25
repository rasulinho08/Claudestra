import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const server = process.env.CLAUDESTRA_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": { target: server, changeOrigin: true } },
  },
});
