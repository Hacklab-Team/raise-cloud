import { defineConfig } from "vite";

// Served from the kiosk site at /admin/ (see README: Deploy).
export default defineConfig({ base: "/admin/", server: { port: 5173 } });
