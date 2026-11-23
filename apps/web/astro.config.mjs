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

  // Ancienne page de réservation, remplacée par le widget Elloha de l'accueil
  redirects: { "/reserver": "/#reserver" },

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
      // Hôte dédié aux images (ex. https://media.ohanalodge.com) : même Directus, mais le navigateur n'y envoie
      // jamais le cookie de session de l'admin (un cookie périmé fait répondre 401 à /assets). Vide = DIRECTUS_PUBLIC_URL.
      DIRECTUS_ASSETS_URL: envField.string({ context: "server", access: "public", optional: true }),
      DIRECTUS_WEB_TOKEN: envField.string({ context: "server", access: "secret" }),
    },
  },

  vite: {
    // Un seul .env à la racine du monorepo
    envDir: "../..",
    plugins: [tailwindcss()],
  },
});
