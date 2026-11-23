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
  extensions/             Extensions Directus (versionnées, dist/ compris)
    ohana-connexions/     Module « Connexions » : OAuth Google/Instagram + synchros planifiées
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
| `pnpm ext:build` | Compile l'extension Directus `ohana-connexions` (committer `dist/`) |

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

- **Google** : note, nombre d'avis et 50 derniers avis importés chaque nuit (Business Profile API). Le site affiche
  les 6 plus récents notés 4 ou 5 étoiles.
- **Booking et Tripadvisor** : notes saisies à la main dans Directus (Accueil › Avis), avec la date du relevé
  (« Notes Booking/Tripadvisor relevées le »). Leurs pages refusent la lecture automatique et l'API Tripadvisor
  interdit de stocker ou de trier ses avis.
- Règles Google à respecter : avis conservés 30 jours au plus après leur dernière synchronisation (le site ignore
  les plus anciens si la synchro s'arrête), texte jamais modifié. Mention légale sous les avis (Code de la consommation,
  art. L111-7-2) : critères de sélection et absence de vérification.

## Photos Instagram

Les 12 dernières publications du compte (photos, 1re image des carrousels, couverture des vidéos) sont importées
chaque lundi dans la médiathèque Directus (dossier « Instagram ») ; les plus anciennes sont retirées avec leur image.
La galerie « Le lieu en images » de l'accueil affiche les 5 plus récentes, chacune liée à sa publication. Moins de
5 photos → la galerie saisie à la main (Accueil › Galerie) reprend sa place. La propriétaire peut masquer une photo
(Contenu du site › Photos Instagram › « Afficher ») et donner un texte alternatif (description dans la médiathèque).
Le lien « Suivre sur Instagram » est rempli automatiquement s'il est vide (Réglages › Coordonnées).

## Connexions Google et Instagram

Module **Connexions** du back-office (extension `directus/extensions/ohana-connexions`) : la propriétaire clique sur
« Connecter Google » et se connecte avec le compte qui gère la fiche ; pour Instagram, elle colle l'adresse d'un flux
Behold (ou, option, « Connecter via Instagram » si une app Meta est configurée). Le module affiche
l'état et la dernière synchro, avec « Synchroniser maintenant », « Reconnecter » et « Déconnecter ».
Les synchros tournent dans Directus (heure UTC) : avis Google chaque nuit à 3 h, photos Instagram le lundi à 4 h.
Les accès sont gardés dans les collections masquées `google_auth` / `instagram_auth`, sans aucune permission :
seule l'extension les lit (ni le site ni la propriétaire).

Seul le développeur crée, une fois, l'application OAuth Google ; ses identifiants vont dans les variables
du service **directus** (Coolify et `.env`), puis redéployer.

### Application Google (une fois)

Déjà créée : projet Google Cloud « Ohana Lodge » (n° 93374596090, compte loustaunaupaul@gmail.com), application
OAuth publiée « En production », client « Directus Connexions ». Reste la demande d'accès (étape 3), à envoyer depuis
un compte qui gère la fiche. Étapes complètes, pour mémoire :

1. Prérequis : fiche de l'établissement validée depuis plus de 60 jours, avec le site renseigné.
2. [Google Cloud](https://console.cloud.google.com) : créer un projet, noter son **numéro**.
3. Demander l'accès : [formulaire Business Profile API](https://support.google.com/business/contact/api_default) ›
   « Application for Basic API Access » (numéro de projet, e-mail du compte qui gère la fiche). Accordé quand le quota
   de « Google My Business API » passe de 0 à 300 requêtes/minute (API et services › Quotas). Quelques jours.
4. API et services › Bibliothèque : activer Google My Business API, My Business Account Management API,
   My Business Business Information API.
5. Écran de consentement OAuth (Google Auth Platform) : type « Externe », scope
   `https://www.googleapis.com/auth/business.manage`, puis **publier l'application (« En production »)** : en mode
   test, l'accès expire au bout de 7 jours. Google affichera « application non validée » à la connexion :
   « Paramètres avancés › Continuer ».
6. Identifiants › ID client OAuth › **Application Web**, URI de redirection autorisés :
   `https://admin.ohanalodge.com/connexions/google/callback` (et `http://localhost:8055/connexions/google/callback`
   pour le dev) → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

### Instagram via Behold (recommandé, aucune app Meta)

1. Compte Instagram du lodge en **compte professionnel** (Paramètres › Type de compte, gratuit) : Behold n'accepte
   que les comptes Entreprise ou Créateur.
2. [behold.so](https://behold.so) : créer un compte (offre gratuite : 1 flux, 6 publications, mise à jour quotidienne,
   1 200 lectures/mois ; la synchro en consomme ~5), connecter le compte Instagram, créer un flux **JSON**.
3. Directus › **Connexions** › Photos Instagram : coller l'adresse `https://feeds.behold.so/…` › Enregistrer.

Les images sont recopiées dans la médiathèque Directus : le site ne dépend pas de Behold pour les afficher.

### Instagram via l'API officielle (option, si une app Meta existe)

Nécessite un compte Facebook et un compte Meta for Developers. App avec le cas d'usage « Gérer les messages et le
contenu sur Instagram », URI de redirection `https://admin.ohanalodge.com/connexions/instagram/callback`,
**ID et clé secrète de l'app Instagram** → `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (service `directus`). En mode
développement, ajouter le compte Instagram comme testeur. Le module affiche alors « Connecter via Instagram » ; le
jeton (60 jours) est prolongé à chaque synchro.

### Mise en service

1. Variables du service `directus` : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (et `INSTAGRAM_APP_*` seulement pour l'option API) ; redéployer.
2. `DIRECTUS_PUBLIC_URL=https://admin… pnpm cms:bootstrap` (collections, module dans la barre de gauche).
3. Dans Directus › **Connexions** : « Connecter Google » (compte qui gère la fiche) et l'adresse du flux Behold.
4. Directus › Accueil › Avis › Notes › Google : renseigner le lien vers les avis Google de la fiche.

### Modifier l'extension

Sources dans `src/` (`google.ts`, `instagram.ts`, `endpoint.ts`, `hook.ts`, `module/`). `pnpm ext:build` puis
committer `dist/` : la production charge `dist/` tel quel (pas de build côté serveur). En dev, Directus recharge
l'extension automatiquement (`EXTENSIONS_AUTO_RELOAD`).
