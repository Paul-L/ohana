# CLAUDE.md — Ohana Lodge

Site vitrine + réservation directe pour un lodge de chambres d'hôtes à Moliets-et-Maâ : disponibilités et prix Elloha en direct sur le site, paiement chez Elloha ; demande sans paiement en secours.
Priorités : performance, mobile-first, SEO/GEO, simplicité d'administration pour une propriétaire non technique, durée de vie longue (10+ ans).

## Stack
- `apps/web` : Astro 7, `output: "server"` (adapter Node standalone), Tailwind 4, TypeScript strict, env typées via `astro:env`.
- Directus 12.6 (Docker, Postgres 17), éditeur visuel via `@directus/visual-editing`.
- Emails : Resend. Anti-spam : Turnstile + honeypot.
- Réservation en ligne : API Elloha (`src/lib/elloha.ts`, serveur uniquement, IP déclarée chez Elloha) via `/api/disponibilites` ; panier + paiement côté navigateur chez Elloha.
- Un seul `.env` à la racine (Vite `envDir: "../.."`).

## Commandes
- `pnpm dev` · `pnpm check` (doit rester à 0 erreur) · `pnpm build`
- `pnpm cms:up` · `pnpm cms:bootstrap` (idempotent)
- `pnpm elloha:offres [--appliquer]` : teste l'accès Elloha et relie les chambres (`rooms.elloha_offer_id`)
- `pnpm check:contrast [photo|id]` : contraste du texte sur la photo d'accueil (voile réglé dans `src/lib/hero-overlay.ts`, partagé avec la page)

## Règles
- Tout accès Directus passe par `src/lib/directus.ts`, côté serveur uniquement (le token ne doit jamais atteindre le client).
- Toujours filtrer par `published` sur `pages` et `rooms` : Directus (licence gratuite) ne peut pas le faire côté permissions.
- Modifier le schéma = mettre à jour **à la fois** `scripts/bootstrap-directus.ts` et les types de `src/lib/directus.ts`. Ajouts uniquement (le script ne supprime rien).
- Chaque élément éditable reçoit `{...editable(Astro.locals.visualEditing, collection, id, fields)}` ; rien de plus pour l'éditeur visuel.
- Images : `assetUrl(id, { width })` (transformations Directus, format auto) + `srcset`, `loading="lazy"` sauf l'image LCP (`fetchpriority="high"`).
- Zéro JS client par défaut. Pas de framework UI (React/Vue) sans raison forte.
- Textes de l'interface en français. Données structurées schema.org dans `layouts/Base.astro`.
- Ne jamais committer `.env`, `directus/uploads`, `backups/`.
- Elloha : jamais d'identifiant Elloha côté client (seules les `AddToCartUrl` publiques partent au navigateur). Sans les variables `ELLOHA_*`, ou si Elloha ne répond pas, `/reserver` doit rester fonctionnel en mode « demande ».
