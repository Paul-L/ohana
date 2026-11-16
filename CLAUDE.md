# CLAUDE.md — Ohana Lodge

Site vitrine + demande de réservation directe (sans paiement en ligne) pour un lodge de chambres d'hôtes à Moliets-et-Maâ.
Priorités : performance, mobile-first, SEO/GEO, simplicité d'administration pour une propriétaire non technique, durée de vie longue (10+ ans).

## Stack
- `apps/web` : Astro 7, `output: "server"` (adapter Node standalone), Tailwind 4, TypeScript strict, env typées via `astro:env`.
- Directus 12.6 (Docker, Postgres 17), éditeur visuel via `@directus/visual-editing`.
- Emails : Resend. Anti-spam : Turnstile + honeypot.
- Un seul `.env` à la racine (Vite `envDir: "../.."`).

## Commandes
- `pnpm dev` · `pnpm check` (doit rester à 0 erreur) · `pnpm build`
- `pnpm cms:up` · `pnpm cms:bootstrap` (idempotent)

## Règles
- Tout accès Directus passe par `src/lib/directus.ts`, côté serveur uniquement (le token ne doit jamais atteindre le client).
- Toujours filtrer par `published` sur `pages` et `rooms` : Directus (licence gratuite) ne peut pas le faire côté permissions.
- Modifier le schéma = mettre à jour **à la fois** `scripts/bootstrap-directus.ts` et les types de `src/lib/directus.ts`. Ajouts uniquement (le script ne supprime rien).
- Chaque élément éditable reçoit `{...editable(Astro.locals.visualEditing, collection, id, fields)}` ; rien de plus pour l'éditeur visuel.
- Images : `assetUrl(id, { width })` (transformations Directus, format auto) + `srcset`, `loading="lazy"` sauf l'image LCP (`fetchpriority="high"`).
- Zéro JS client par défaut. Pas de framework UI (React/Vue) sans raison forte.
- Textes de l'interface en français. Données structurées schema.org dans `layouts/Base.astro`.
- Ne jamais committer `.env`, `directus/uploads`, `backups/`.
