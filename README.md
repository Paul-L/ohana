# Ohana Lodge — site web

Astro 7 (SSR Node) + Directus 12 (auto-hébergé, Postgres) + widget de réservation Elloha.
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
  src/components/EllohaWidget.astro  Barre de réservation Elloha (widget officiel, habillé à notre charte)
  src/pages/              accueil, chambres, [slug] (pages libres)
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
| `settings` (singleton) | Nom, accroche, coordonnées, photo d'accueil, infos séjour |
| `pages` | Accueil (`slug = accueil`) + pages libres (à propos, mentions légales…) |
| `rooms` (+ `rooms_files`) | Chambres, photo principale, galerie |
| `home`, `seasons`, `faq` | Textes de l'accueil, tarifs, questions fréquentes |
| `reviews` | Avis Google, importés chaque nuit (la propriétaire peut en masquer) |
| `instagram_posts` | Dernières photos Instagram, importées chaque semaine : remplacent la galerie de l'accueil |

Rôles : **Propriétaire** (contenu, pas de réglages techniques), **Site web** (token statique du serveur Astro).

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
| `pnpm reviews:sync` | Synchronise les avis Google (lancé chaque nuit en production) |
| `pnpm google:auth` | Autorisation unique de l'accès aux avis Google |
| `pnpm instagram:sync` | Importe les dernières photos Instagram (lancé chaque semaine en production) |

## Déploiement (Coolify)

1. Nouvelle ressource **Docker Compose** → ce repo, fichier `docker-compose.prod.yml`.
2. Domaines : `web` → `ohanalodge.com` (port 4321), `directus` → `admin.ohanalodge.com` (port 8055).
3. Variables : celles de `.env.example` avec `DIRECTUS_PUBLIC_URL=https://admin…`, `SITE_URL=https://ohanalodge.com`.
4. Premier déploiement, puis en local : `DIRECTUS_PUBLIC_URL=https://admin… pnpm cms:bootstrap`.
5. Créer l'utilisateur de la propriétaire (rôle **Propriétaire**) dans Directus.
6. Sauvegardes : activer les backups Postgres planifiés de Coolify + le volume `uploads`.

## Réservation (Elloha)

La barre de réservation de l'accueil (`#reserver`) est le widget officiel Elloha : le script Elloha injecte son
formulaire dans la page, puis ouvre le moteur Elloha (disponibilités, paiement) dans un nouvel onglet.
Ses feuilles de style sont neutralisées et remplacées par les nôtres (`EllohaWidget.astro`). Si le code
d'intégration change dans le back-office Elloha, reporter les identifiants (`WIDGET_ID`, `ESTABLISHMENT_ID`) dans ce composant.
Les disponibilités, prix et couleurs du moteur lui-même se règlent dans le back-office Elloha.

## Notes et avis

- **Google** : note, nombre d'avis et 50 derniers avis importés chaque nuit par `scripts/sync-reviews.ts`
  (Business Profile API, accès propriétaire). Le site affiche les 6 plus récents notés 4 ou 5 étoiles.
- **Booking et Tripadvisor** : notes saisies à la main dans Directus (Accueil › Avis), avec la date du relevé
  (« Notes Booking/Tripadvisor relevées le »). Leurs pages refusent la lecture automatique et l'API Tripadvisor
  interdit de stocker ou de trier ses avis.
- Règles Google à respecter : avis conservés 30 jours au plus après leur dernière synchronisation (le site ignore
  les plus anciens si la synchro s'arrête), texte jamais modifié. Mention légale sous les avis (Code de la consommation,
  art. L111-7-2) : critères de sélection et absence de vérification.

### Mise en place de la synchro Google (une fois)

1. Prérequis Google : fiche de l'établissement validée depuis plus de 60 jours, avec le site renseigné.
2. [Google Cloud](https://console.cloud.google.com) : créer un projet et noter son **numéro**.
3. Demander l'accès : [formulaire Business Profile API](https://support.google.com/business/contact/api_default) ›
   « Application for Basic API Access », avec le numéro de projet et l'e-mail propriétaire de la fiche.
   Accès accordé quand le quota de « Google My Business API » passe de 0 à 300 requêtes/minute.
4. Activer les API : Google My Business API, My Business Account Management API, My Business Business Information API.
5. Écran de consentement OAuth : type « Externe », ajouter le scope `https://www.googleapis.com/auth/business.manage`,
   puis **publier l'application (« En production »)** : en mode test, l'autorisation expire au bout de 7 jours.
6. Identifiants › ID client OAuth › « Application de bureau » → `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans `.env`.
7. `pnpm google:auth` : la propriétaire se connecte avec le compte qui gère la fiche (Google signale une application
   non validée : « Paramètres avancés › Continuer »). Reporter `GOOGLE_REFRESH_TOKEN` et `GOOGLE_LOCATION` dans `.env`.
8. `DIRECTUS_SYNC_TOKEN` (`openssl rand -hex 32`) dans `.env`, puis `pnpm cms:bootstrap` (crée l'utilisateur « Synchro avis »).
9. Tester : `pnpm reviews:sync`.
10. Production : reporter les 5 variables dans Coolify, relancer le bootstrap contre la prod, puis ajouter une
    **tâche planifiée** sur le service `web` : commande `node scripts/sync-reviews.ts`, fréquence `0 4 * * *`.
11. Dans Directus (Accueil › Avis › Notes › Google), renseigner le lien vers les avis Google de la fiche.

## Photos Instagram

`scripts/sync-instagram.ts` importe chaque semaine les 12 dernières publications du compte (photos, 1re image des
carrousels, couverture des vidéos) dans la médiathèque Directus (dossier « Instagram »). Les plus anciennes sont
retirées avec leur image : la galerie « Le lieu en images » de l'accueil affiche les 5 plus récentes, chacune liée à
sa publication. Moins de 5 photos disponibles → la galerie saisie à la main dans Accueil › Galerie reprend sa place.
La propriétaire peut masquer une photo (Contenu du site › Photos Instagram › « Afficher ») et donner un texte
alternatif à chaque image (description dans la médiathèque). Le lien « Suivre sur Instagram » est rempli
automatiquement s'il est vide (Réglages › Coordonnées).

### Mise en place (une fois)

1. Compte Instagram du lodge en **compte professionnel** (Instagram › Paramètres › Type de compte, gratuit).
2. [Meta for Developers](https://developers.facebook.com/apps) : créer une app, cas d'usage
   « Gérer les messages et le contenu sur Instagram » (API Instagram avec connexion Instagram).
3. Rôles de l'app › ajouter le compte Instagram comme **testeur Instagram**, puis accepter l'invitation depuis
   Instagram (Paramètres › Apps et sites web › Invitations). L'app peut rester en mode développement : elle ne lit
   que ce compte, pas besoin d'examen par Meta.
4. Configuration de l'API › « Générer des jetons d'accès » : ajouter le compte, générer le jeton (permission
   `instagram_business_basic`) → `INSTAGRAM_TOKEN` dans `.env` et dans Coolify.
5. `pnpm cms:bootstrap` (avec `DIRECTUS_SYNC_TOKEN`, partagé avec la synchro des avis), puis tester : `pnpm instagram:sync`.
6. Production : **tâche planifiée** sur le service `web` : commande `node scripts/sync-instagram.ts`, fréquence `0 5 * * 1`
   (lundi 5 h).

Le jeton dure 60 jours ; chaque passage le renouvelle et le garde dans Directus (collection masquée `instagram_auth`).
Si la synchro s'arrête plus de 60 jours, générer un nouveau jeton (étape 4).
