// @ts-check
import { defineConfig, envField, fontProviders } from "astro/config";
import node from "@astrojs/node";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Domaine de production (sert au sitemap et aux URL canoniques)
  site: "https://ohanalodge.com",

  // Rendu serveur : le contenu Directus est à jour dès l'enregistrement,
  // indispensable pour l'éditeur visuel. Les pages fixent leur propre Cache-Control.
  output: "server",
  adapter: node({ mode: "standalone" }),

  i18n: { defaultLocale: "fr", locales: ["fr"] },
  integrations: [sitemap()],

  // Polices auto-hébergées (téléchargées au build) : pas d'appel à Google Fonts côté visiteur
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: "Inter",
      cssVariable: "--font-inter",
      weights: [400, 500, 600],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["system-ui", "sans-serif"],
    },
    {
      provider: fontProviders.fontsource(),
      name: "Inter Tight",
      cssVariable: "--font-inter-tight",
      weights: [300, 500],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["system-ui", "sans-serif"],
    },
  ],

  image: {
    // Autorise <Image> à optimiser les images servies par Directus
    remotePatterns: [{ protocol: "http" }, { protocol: "https" }],
  },

  env: {
    schema: {
      DIRECTUS_URL: envField.string({ context: "server", access: "secret" }),
      DIRECTUS_PUBLIC_URL: envField.string({ context: "server", access: "public", default: "http://localhost:8055" }),
      DIRECTUS_WEB_TOKEN: envField.string({ context: "server", access: "secret" }),
      RESEND_API_KEY: envField.string({ context: "server", access: "secret" }),
      MAIL_FROM: envField.string({ context: "server", access: "secret" }),
      PUBLIC_TURNSTILE_SITE_KEY: envField.string({ context: "server", access: "public", default: "1x00000000000000000000AA" }),
      TURNSTILE_SECRET_KEY: envField.string({ context: "server", access: "secret" }),
      // Elloha (disponibilités + paiement en ligne). Vides = la page de réservation reste en mode « demande ».
      ELLOHA_API_URL: envField.string({ context: "server", access: "secret", default: "https://api.elloha.com" }),
      ELLOHA_CLIENT_ID: envField.string({ context: "server", access: "secret", optional: true }),
      ELLOHA_BOOKING_ENGINE_ID: envField.string({ context: "server", access: "secret", optional: true }),
      ELLOHA_PRODUCT_ID: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },

  vite: {
    // Un seul .env à la racine du monorepo
    envDir: "../..",
    plugins: [tailwindcss()],
  },
});
