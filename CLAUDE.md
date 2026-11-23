# CLAUDE.md — Ohana Lodge

Site vitrine + réservation directe pour un lodge de chambres d'hôtes à Moliets-et-Maâ : barre de réservation Elloha (widget officiel) sur l'accueil, disponibilités et paiement chez Elloha.
Priorités : performance, mobile-first, SEO/GEO, simplicité d'administration pour une propriétaire non technique, durée de vie longue (10+ ans).

## Stack
- `apps/web` : Astro 7, `output: "server"` (adapter Node standalone), Tailwind 4, TypeScript strict, env typées via `astro:env`.
- Directus 12.6 (Docker, Postgres 17), éditeur visuel via `@directus/visual-editing`.
- Réservation : widget Elloha (`src/components/EllohaWidget.astro`, ancre `/#reserver`). Elloha a refusé l'accès à son API : pas d'intégration serveur.
- Un seul `.env` à la racine (Vite `envDir: "../.."`).

## Commandes
- `pnpm dev` · `pnpm check` (doit rester à 0 erreur) · `pnpm build`
- `pnpm cms:up` · `pnpm cms:bootstrap` (idempotent)
- `pnpm ext:build` : compile l'extension Directus `ohana-connexions` ; **committer `dist/`** (la prod le charge tel quel)
- `pnpm check:contrast [photo|id]` : contraste du texte sur la photo d'accueil (voile réglé dans `src/lib/hero-overlay.ts`, partagé avec la page)

## Règles
- Tout accès Directus passe par `src/lib/directus.ts`, côté serveur uniquement (le token ne doit jamais atteindre le client).
- Toujours filtrer par `published` sur `pages` et `rooms` : Directus (licence gratuite) ne peut pas le faire côté permissions.
- Modifier le schéma = mettre à jour **à la fois** `scripts/bootstrap-directus.ts` et les types de `src/lib/directus.ts`. Ajouts uniquement (le script ne supprime rien).
- Chaque élément éditable reçoit `{...editable(Astro.locals.visualEditing, collection, id, fields)}` ; rien de plus pour l'éditeur visuel.
- Images : `assetUrl(id, { width })` (transformations Directus, format auto) + `srcset`, `loading="lazy"` sauf l'image LCP (`fetchpriority="high"`).
- Zéro JS client par défaut (exception : le widget Elloha, chargé à l'approche de la barre). Pas de framework UI (React/Vue) sans raison forte.
- Textes de l'interface en français. Données structurées schema.org dans `layouts/Base.astro`.
- Ne jamais committer `.env`, `directus/uploads`, `backups/`.
- Elloha : les styles Elloha sont neutralisés (les `<template id="CoWidgetCss…">` occupent leurs id) ; tout l'habillage est dans `EllohaWidget.astro`, à vérifier si Elloha change son HTML. Si Elloha ne répond pas, la barre affiche téléphone et e-mail. Tous les boutons « Réserver » pointent vers `/#reserver` (`/reserver` y redirige).
- Avis Google (`reviews`) : règles Business Profile API → 50 avis max, conservés 30 jours au plus après leur dernière synchro, texte jamais modifié (champs en lecture seule ; seule la case « visible » est éditable). Garder la mention de sélection sous les avis. Pas de scraping (Google, Booking) ni de stockage d'avis Tripadvisor (interdit par leur API) : notes Booking/Tripadvisor saisies à la main.
- Google et Instagram : connexion OAuth et synchros dans l'extension `directus/extensions/ohana-connexions` (module « Connexions », synchros planifiées dans Directus). Les accès (`google_auth`, `instagram_auth`) n'ont aucune permission : seule l'extension les lit. Identifiants des apps OAuth dans les variables du service `directus`.
- Photos Instagram (`instagram_posts`) : API Instagram officielle, jamais de scraping. Images copiées dans la médiathèque (les URL Instagram expirent), roulement sur les 12 dernières ; la galerie de l'accueil n'utilise Instagram qu'à partir de 5 photos, sinon la galerie manuelle.
