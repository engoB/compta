import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Compta — tableau de bord",
        short_name: "Compta",
        description: "Comptabilité automatisée : dépose tes relevés, vérifie, exporte.",
        lang: "fr",
        start_url: ".",
        display: "standalone",
        background_color: "#fcfcfb",
        theme_color: "#2a78d6",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Les données viennent de l'API GitHub et sont mises en cache par l'app (IndexedDB), pas par le SW.
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1200 },
});
