// @ts-check
import { defineConfig, envField } from "astro/config";
import node from "@astrojs/node";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // À remplacer par le domaine définitif (sert au sitemap et aux URL canoniques)
  site: "https://ohana-lodge.fr",

  // Rendu serveur : le contenu Directus est à jour dès l'enregistrement,
  // indispensable pour l'éditeur visuel. Les pages fixent leur propre Cache-Control.
  output: "server",
  adapter: node({ mode: "standalone" }),

  i18n: { defaultLocale: "fr", locales: ["fr"] },
  integrations: [sitemap()],

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
    },
  },

  vite: {
    // Un seul .env à la racine du monorepo
    envDir: "../..",
    plugins: [tailwindcss()],
  },
});
