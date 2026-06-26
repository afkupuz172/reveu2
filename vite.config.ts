import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend dev server on :5173, proxies /api to the local Express API on :3000
// so the browser never holds HubSpot/Stripe keys and there is no CORS to fight.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
