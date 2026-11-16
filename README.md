# Ohana Lodge — site web

Astro 7 (SSR Node) + Directus 12 (auto-hébergé, Postgres) + Resend.
Objectif : site rapide, mobile-first, optimisé SEO/GEO, administrable visuellement par la propriétaire.

## Démarrage (dev)

Prérequis : Node ≥ 22.18, pnpm (`corepack enable`), Docker.

```bash
cp .env.example .env          # puis remplir (secrets : openssl rand -hex 32)
pnpm install
pnpm cms:up                   # Postgres + Directus → http://localhost:8055
pnpm cms:bootstrap            # collections, rôles, éditeur visuel, contenu d'exemple
pnpm dev                      # site → http://localhost:4321
```

Éditeur visuel : Directus → module **Visual** (1er de la barre) → le site s'ouvre en mode édition.

## Structure

```
apps/web/                 Site Astro
  src/lib/directus.ts     Client + types du schéma (à tenir à jour avec le bootstrap)
  src/lib/visual-editing.ts  Attributs data-directus (seulement en mode édition)
  src/actions/            Formulaire de demande de réservation (Turnstile + Directus + Resend)
  src/pages/              accueil, chambres, [slug] (pages libres), reserver
directus/
  extensions/             Extensions Directus (versionnées)
  snapshots/              Snapshot du schéma (pnpm cms:snapshot)
  uploads/                Fichiers (ignorés par git)
scripts/bootstrap-directus.ts  Schéma + permissions, idempotent
docker-compose.yml        Dev (Postgres + Directus)
docker-compose.prod.yml   Prod Coolify (Postgres + Directus + web)
```

## Contenu (Directus)

| Collection | Rôle |
|---|---|
| `settings` (singleton) | Nom, accroche, coordonnées, photo d'accueil, email de notification |
| `pages` | Accueil (`slug = accueil`) + pages libres (à propos, mentions légales…) |
| `rooms` (+ `rooms_files`) | Chambres, photo principale, galerie |
| `booking_requests` | Demandes reçues par le formulaire |

Rôles : **Propriétaire** (contenu + demandes, pas de réglages techniques), **Site web** (token statique du serveur Astro).

> Directus 12 en licence gratuite n'autorise pas les permissions filtrées ni par champ :
> le filtre « publié » est donc appliqué dans les requêtes du site (`published` dans `lib/directus.ts`).

## Commandes

| | |
|---|---|
| `pnpm dev` / `build` / `check` | Site Astro |
| `pnpm cms:up` / `cms:down` / `cms:logs` | Conteneurs Directus |
| `pnpm cms:bootstrap` | (Re)applique schéma + permissions |
| `pnpm cms:snapshot` / `cms:apply` | Exporte / applique le schéma Directus (YAML versionné) |
| `pnpm db:backup` | Dump Postgres dans `backups/` |

## Déploiement (Coolify)

1. Nouvelle ressource **Docker Compose** → ce repo, fichier `docker-compose.prod.yml`.
2. Domaines : `web` → `ohana-lodge.fr` (port 4321), `directus` → `admin.ohana-lodge.fr` (port 8055).
3. Variables : celles de `.env.example` avec `DIRECTUS_PUBLIC_URL=https://admin…`, `SITE_URL=https://ohana-lodge.fr`.
4. Premier déploiement, puis en local : `DIRECTUS_PUBLIC_URL=https://admin… pnpm cms:bootstrap`.
5. Créer l'utilisateur de la propriétaire (rôle **Propriétaire**) dans Directus.
6. Sauvegardes : activer les backups Postgres planifiés de Coolify + le volume `uploads`.

## Emails

Resend : vérifier le domaine d'envoi (SPF/DKIM) avant la mise en prod. Turnstile : créer un widget Cloudflare
pour le domaine et remplacer les clés de test.
