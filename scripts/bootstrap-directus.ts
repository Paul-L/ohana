/**
 * Initialise (ou met à niveau) Directus pour Ohana : collections, relations,
 * rôles/permissions, réglages de l'éditeur visuel et contenu d'exemple.
 *
 * Idempotent : peut être relancé sans risque, il n'ajoute que ce qui manque.
 * Usage : pnpm cms:bootstrap   (lit le .env de la racine)
 */
import { readFile } from "node:fs/promises";

const URL_ = process.env.DIRECTUS_PUBLIC_URL ?? "http://localhost:8055";
const SITE_URL = process.env.SITE_URL ?? "http://localhost:4321";
const ADMIN_EMAIL = must("DIRECTUS_ADMIN_EMAIL");
const ADMIN_PASSWORD = must("DIRECTUS_ADMIN_PASSWORD");
const WEB_TOKEN = must("DIRECTUS_WEB_TOKEN");

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable manquante : ${name}`);
  return v;
}

let token = "";

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.errors?.map((e) => e.message).join(", ")}`);
  return json.data as T;
}

async function exists(path: string) {
  try {
    await api("GET", path);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Helpers schéma

type Field = { field: string; type: string; meta?: Record<string, unknown>; schema?: Record<string, unknown> | null };

const f = {
  id: (): Field => ({ field: "id", type: "integer", meta: { hidden: true, readonly: true }, schema: { is_primary_key: true, has_auto_increment: true } }),
  status: (): Field => ({
    field: "status",
    type: "string",
    schema: { default_value: "draft", is_nullable: false },
    meta: {
      interface: "select-dropdown",
      display: "labels",
      width: "half",
      options: { choices: [
        { text: "Publié", value: "published", color: "#2f5d62" },
        { text: "Brouillon", value: "draft", color: "#a2a2a2" },
        { text: "Archivé", value: "archived", color: "#d9534f" },
      ] },
    },
  }),
  sort: (): Field => ({ field: "sort", type: "integer", meta: { hidden: true } }),
  dateCreated: (): Field => ({ field: "date_created", type: "timestamp", meta: { special: ["date-created"], readonly: true, width: "half", display: "datetime", display_options: { relative: true } } }),
  string: (field: string, note?: string, extra: Record<string, unknown> = {}): Field => ({ field, type: "string", meta: { interface: "input", note, ...extra } }),
  text: (field: string, note?: string): Field => ({ field, type: "text", meta: { interface: "input-multiline", note } }),
  rich: (field: string, note?: string): Field => ({
    field,
    type: "text",
    meta: { interface: "input-rich-text-html", note, options: { toolbar: ["bold", "italic", "h2", "h3", "bullist", "numlist", "link", "removeformat"] } },
  }),
  int: (field: string, note?: string, extra: Record<string, unknown> = {}): Field => ({ field, type: "integer", meta: { interface: "input", width: "half", note, ...extra } }),
  date: (field: string): Field => ({ field, type: "date", meta: { interface: "datetime", width: "half" } }),
  time: (field: string, note?: string): Field => ({ field, type: "time", meta: { interface: "datetime", width: "half", note } }),
  float: (field: string, note?: string): Field => ({ field, type: "float", meta: { interface: "input", width: "half", note } }),
  bool: (field: string, note?: string): Field => ({ field, type: "boolean", schema: { default_value: false }, meta: { interface: "boolean", width: "half", note } }),
  /** Liste répétable (JSON) éditée sous forme de formulaire dans Directus */
  repeater: (field: string, note: string, template: string, fields: Record<string, unknown>[]): Field => ({
    field,
    type: "json",
    meta: { interface: "list", special: ["cast-json"], note, options: { template, addLabel: "Ajouter", fields } },
  }),
  image: (field: string, note?: string): Field => ({ field, type: "uuid", meta: { interface: "file-image", special: ["file"], note } }),
  slug: (): Field => ({
    field: "slug",
    type: "string",
    schema: { is_unique: true, is_nullable: false },
    meta: { interface: "input", width: "half", note: "Adresse de la page (ex. chambre-ocean)", options: { slug: true, trim: true } },
  }),
};

async function ensureCollection(collection: string, meta: Record<string, unknown>, fields: Field[]) {
  if (!(await exists(`/collections/${collection}`))) {
    await api("POST", "/collections", { collection, meta, schema: {}, fields });
    console.log(`+ collection ${collection}`);
    return;
  }
  for (const field of fields) {
    if (!(await exists(`/fields/${collection}/${field.field}`))) {
      await api("POST", `/fields/${collection}`, field);
      console.log(`+ champ ${collection}.${field.field}`);
    }
  }
}

async function ensureField(collection: string, field: Field) {
  if (!(await exists(`/fields/${collection}/${field.field}`))) {
    await api("POST", `/fields/${collection}`, field);
    console.log(`+ champ ${collection}.${field.field}`);
  }
}

async function ensureRelation(rel: { collection: string; field: string; related_collection: string | null; meta?: Record<string, unknown>; schema?: Record<string, unknown> }) {
  if (!(await exists(`/relations/${rel.collection}/${rel.field}`))) {
    await api("POST", "/relations", rel);
    console.log(`+ relation ${rel.collection}.${rel.field} → ${rel.related_collection}`);
  }
}

async function fileRelation(collection: string, field: string) {
  await ensureRelation({ collection, field, related_collection: "directus_files", schema: { on_delete: "SET NULL" } });
}

/** Champ "plusieurs images" : M2M collection <-> directus_files via une table de jonction dédiée. */
async function filesField(collection: string, field: string, junction: string, note: string) {
  const fk = `${collection}_id`;
  await ensureCollection(junction, { hidden: true, icon: "import_export" }, [
    f.id(),
    { field: fk, type: "integer", meta: { hidden: true } },
    { field: "directus_files_id", type: "uuid", meta: { hidden: true } },
    { field: "sort", type: "integer", meta: { hidden: true } },
  ]);
  await ensureField(collection, { field, type: "alias", meta: { interface: "files", special: ["files"], note }, schema: null });
  await ensureRelation({
    collection: junction,
    field: "directus_files_id",
    related_collection: "directus_files",
    meta: { junction_field: fk },
    schema: { on_delete: "CASCADE" },
  });
  await ensureRelation({
    collection: junction,
    field: fk,
    related_collection: collection,
    meta: { one_field: field, junction_field: "directus_files_id", sort_field: "sort" },
    schema: { on_delete: "CASCADE" },
  });
}

const choice = (field: string, name: string, choices: [string, string][], width = "half") => ({
  field,
  name,
  type: "string",
  meta: { field, interface: "select-dropdown", width, options: { choices: choices.map(([value, text]) => ({ value, text })) } },
});
const input = (field: string, name: string, width = "half", type = "string", placeholder?: string) => ({
  field,
  name,
  type,
  meta: { field, interface: "input", width, options: placeholder ? { placeholder } : undefined },
});

// ---------------------------------------------------------------- Schéma

async function schema() {
  await ensureCollection(
    "settings",
    { singleton: true, icon: "tune", translations: [{ language: "fr-FR", translation: "Réglages du site" }], note: "Nom, coordonnées, image d'accueil" },
    [
      f.id(),
      f.string("site_name", "Nom affiché sur le site", { required: true }),
      f.string("tagline", "Accroche sous le titre de l'accueil"),
      f.text("seo_description", "Description pour Google et les IA (150 caractères environ)"),
      f.image("hero_image", "Grande photo de la page d'accueil"),
      f.string("contact_email", "Email affiché sur le site", { width: "half" }),
      f.string("notification_email", "Email qui reçoit les demandes de réservation", { width: "half" }),
      f.string("phone", undefined, { width: "half" }),
      f.text("address"),
    ],
  );
  await fileRelation("settings", "hero_image");

  await ensureCollection(
    "pages",
    { icon: "article", archive_field: "status", archive_value: "archived", unarchive_value: "draft", display_template: "{{title}}", translations: [{ language: "fr-FR", translation: "Pages" }] },
    [
      f.id(),
      f.status(),
      f.slug(),
      f.string("title", undefined, { required: true }),
      f.text("intro", "Chapeau, affiché en grand sous le titre"),
      f.rich("content"),
      f.image("cover"),
      f.text("seo_description", "Description pour Google et les IA"),
    ],
  );
  await fileRelation("pages", "cover");

  await ensureCollection(
    "rooms",
    { icon: "bed", sort_field: "sort", archive_field: "status", archive_value: "archived", unarchive_value: "draft", display_template: "{{name}}", translations: [{ language: "fr-FR", translation: "Chambres" }] },
    [
      f.id(),
      f.status(),
      f.sort(),
      f.string("name", undefined, { required: true, width: "half" }),
      f.slug(),
      f.text("summary", "Une phrase de présentation"),
      f.rich("description"),
      f.int("capacity", "Nombre de personnes max"),
      f.int("price_from", "Prix à partir de (€ / nuit)"),
      f.image("cover", "Photo principale"),
    ],
  );
  await fileRelation("rooms", "cover");

  // Galerie : M2M rooms <-> directus_files via la table de jonction rooms_files
  await ensureCollection("rooms_files", { hidden: true, icon: "import_export" }, [
    f.id(),
    { field: "rooms_id", type: "integer", meta: { hidden: true } },
    { field: "directus_files_id", type: "uuid", meta: { hidden: true } },
  ]);
  await ensureField("rooms", { field: "gallery", type: "alias", meta: { interface: "files", special: ["files"], note: "Photos supplémentaires" }, schema: null });
  await ensureRelation({
    collection: "rooms_files",
    field: "directus_files_id",
    related_collection: "directus_files",
    meta: { junction_field: "rooms_id" },
    schema: { on_delete: "CASCADE" },
  });
  await ensureRelation({
    collection: "rooms_files",
    field: "rooms_id",
    related_collection: "rooms",
    meta: { one_field: "gallery", junction_field: "directus_files_id" },
    schema: { on_delete: "CASCADE" },
  });

  await ensureCollection(
    "booking_requests",
    {
      icon: "event_available",
      display_template: "{{name}} — {{arrival}}",
      sort_field: null,
      translations: [{ language: "fr-FR", translation: "Demandes de réservation" }],
      note: "Demandes reçues via le formulaire du site",
    },
    [
      f.id(),
      {
        field: "status",
        type: "string",
        schema: { default_value: "new", is_nullable: false },
        meta: {
          interface: "select-dropdown",
          display: "labels",
          width: "half",
          options: { choices: [
            { text: "Nouvelle", value: "new", color: "#e8a23b" },
            { text: "Répondue", value: "answered", color: "#3b82f6" },
            { text: "Confirmée", value: "confirmed", color: "#2f5d62" },
            { text: "Refusée", value: "declined", color: "#a2a2a2" },
          ] },
        },
      },
      f.dateCreated(),
      f.string("name", undefined, { width: "half" }),
      f.string("email", undefined, { width: "half" }),
      f.string("phone", undefined, { width: "half" }),
      { field: "room", type: "integer", meta: { interface: "select-dropdown-m2o", width: "half", options: { template: "{{name}}" } } },
      f.date("arrival"),
      f.date("departure"),
      f.int("guests"),
      f.text("message"),
    ],
  );
  await ensureRelation({ collection: "booking_requests", field: "room", related_collection: "rooms", schema: { on_delete: "SET NULL" } });

  // --- Refonte (maquette 2026-11) : ajouts uniquement ---

  for (const field of [
    f.time("checkin_from", "Accueil à partir de"),
    f.time("checkin_to", "Accueil jusqu'à"),
    f.time("checkout_until", "Départ au plus tard"),
    f.float("tourist_tax", "Taxe de séjour (€ / nuit / personne)"),
    f.int("deposit_percent", "Acompte demandé à la confirmation (%)"),
    f.string("instagram_url", "Lien du compte Instagram", { width: "half" }),
    f.float("latitude", "Position sur la carte (ex. 43.85)"),
    f.float("longitude", "Position sur la carte (ex. -1.377)"),
  ]) await ensureField("settings", field);

  for (const field of [
    f.string("bed", "Literie, ex. 180 × 200", { width: "half" }),
    f.string("features", "Atout court, ex. terrasse privative", { width: "half" }),
    f.string("elloha_offer_id", "Identifiant de la chambre dans Elloha (liste : pnpm elloha:offres). Vide = chambre non réservable en ligne", { width: "half" }),
  ]) await ensureField("rooms", field);

  await ensureCollection(
    "home",
    { singleton: true, icon: "home", translations: [{ language: "fr-FR", translation: "Page d'accueil" }], note: "Infos clés, avis, photos de l'accueil" },
    [
      f.id(),
      f.string("hero_eyebrow", "Petite ligne au-dessus du grand titre"),
      f.repeater("key_facts", "Bandeau noir sous la photo", "{{label}} : {{value}}", [
        choice("icon", "Icône", [
          ["bed", "Lit"], ["arrival", "Arrivée"], ["departure", "Départ"], ["breakfast", "Petit-déjeuner"],
          ["beach", "Plage"], ["pool", "Piscine"], ["wifi", "Wi-Fi"], ["parking", "Parking"],
        ]),
        input("label", "Intitulé"),
        input("value", "Valeur", "full"),
      ]),
      f.repeater("ratings", "Notes affichées (copiées depuis chaque site)", "{{source}} {{score}}/{{scale}}", [
        choice("source", "Site", [["google", "Google"], ["booking", "Booking.com"], ["tripadvisor", "Tripadvisor"]]),
        input("score", "Note (ex. 4,9)", "half", "string", "4,9"),
        input("scale", "Sur", "half", "integer", "5"),
        input("count", "Nombre d'avis", "half", "integer"),
        input("label", "Mention (ex. Exceptionnel)"),
        input("url", "Lien vers les avis", "full"),
      ]),
      f.text("review_quote", "Extrait d'un avis réel, copié tel quel"),
      f.string("review_attribution", "Ex. Marie, France · avis Booking.com · juin 2026"),
      f.repeater("review_highlights", "Notes détaillées (ex. Propreté 9,8)", "{{label}} {{score}}", [
        input("label", "Critère"),
        input("score", "Note", "half", "string", "9,8"),
      ]),
      f.string("review_highlights_note", "Ex. Notes détaillées Booking.com, relevées le 1er juin 2026"),
      f.image("booking_image", "Photo de la section « Réserver en direct »"),
    ],
  );
  await fileRelation("home", "booking_image");
  await filesField("home", "lodge_images", "home_lodge_images", "Section « Le lodge » : 3 photos, la 1re en grand");
  await filesField("home", "gallery", "home_gallery", "Section « Le lieu en images » : 5 photos, la 1re en grand");

  await ensureCollection(
    "seasons",
    { icon: "calendar_month", sort_field: "sort", archive_field: "status", archive_value: "archived", unarchive_value: "draft", display_template: "{{name}}", translations: [{ language: "fr-FR", translation: "Saisons et tarifs" }], note: "Prix par nuit et par chambre, petit-déjeuner inclus" },
    [
      f.id(),
      f.status(),
      f.sort(),
      f.string("name", "Ex. Haute saison", { required: true, width: "half" }),
      f.bool("highlight", "Mettre en avant (carte foncée)"),
      f.repeater("periods", "Périodes, au format MM-JJ (ex. 07-07 → 08-31)", "{{from}} → {{to}}", [
        input("from", "Du (MM-JJ)", "half", "string", "07-07"),
        input("to", "Au (MM-JJ)", "half", "string", "08-31"),
      ]),
      f.string("periods_note", "Texte affiché à la place des dates si besoin (ex. [Ouverture] → 4 mai)"),
      f.int("price_double", "Prix 2 personnes (€ / nuit)"),
      f.int("price_single", "Prix 1 personne (€ / nuit)"),
      f.int("min_nights", "Séjour minimum (nuits)"),
      f.int("min_nights_weekend", "Séjour minimum le week-end (nuits)"),
      f.int("long_stay_nights", "Remise long séjour : à partir de (nuits)"),
      f.int("long_stay_discount", "Remise long séjour (%)"),
    ],
  );

  await ensureCollection(
    "faq",
    { icon: "help", sort_field: "sort", archive_field: "status", archive_value: "archived", unarchive_value: "draft", display_template: "{{question}}", translations: [{ language: "fr-FR", translation: "Questions fréquentes" }] },
    [f.id(), f.status(), f.sort(), f.string("question", undefined, { required: true }), f.rich("answer")],
  );

  // --- Textes de toutes les sections de l'accueil (titres, intros, listes) ---
  const ICONS: [string, string][] = [
    ["age", "Âge"], ["no", "Interdit"], ["group", "Groupe"], ["card", "Paiement"], ["bed", "Lit"], ["breakfast", "Petit-déjeuner"],
    ["pool", "Piscine"], ["wifi", "Wi-Fi"], ["parking", "Parking"], ["arrival", "Arrivée"], ["departure", "Départ"], ["beach", "Plage"],
  ];
  const multiline = "Un retour à la ligne = un retour à la ligne sur le site (grands écrans)";
  for (const field of [
    f.string("rooms_eyebrow", "Petit sur-titre (sert aussi de titre sur mobile)"),
    f.text("rooms_title", multiline),
    f.text("rooms_intro"),
    f.string("rates_eyebrow"),
    f.text("rates_title", multiline),
    f.text("rates_intro"),
    f.repeater("rates_notes", "Petites lignes sous les tarifs (la taxe de séjour s'ajoute automatiquement)", "{{text}}", [input("text", "Texte", "full")]),
    f.string("booking_eyebrow"),
    f.string("booking_title"),
    f.repeater("booking_steps", "Étapes numérotées", "{{title}}", [input("title", "Étape"), input("text", "Détail", "full")]),
    f.string("cancellation_title"),
    f.repeater("cancellation_tiers", "3 cases, de la plus claire à la plus foncée", "{{value}} {{label}}", [
      input("value", "Montant (ex. 30 %)"),
      input("label", "Période (ex. de J-60 à J-2)"),
    ]),
    f.text("cancellation_note"),
    f.string("good_to_know_title"),
    f.repeater("good_to_know", "Pastilles « Bon à savoir »", "{{text}}", [choice("icon", "Icône", ICONS), input("text", "Texte")]),
    f.string("lodge_eyebrow", "Le titre et le texte se modifient dans Pages > accueil"),
    f.string("gallery_eyebrow", "Petit sur-titre (sert aussi de titre sur mobile)"),
    f.string("gallery_title"),
    f.string("reviews_eyebrow"),
    f.string("faq_eyebrow", "Petit sur-titre (sert aussi de titre sur mobile)"),
    f.string("faq_title"),
    f.string("faq_intro", "Phrase avant le numéro de téléphone (ajouté automatiquement)"),
    f.string("access_eyebrow"),
  ]) await ensureField("home", field);

  await ensureCollection(
    "booking_form",
    { singleton: true, icon: "edit_calendar", translations: [{ language: "fr-FR", translation: "Page de réservation" }], note: "Textes du formulaire de demande de réservation" },
    [
      f.id(),
      f.string("title"),
      f.text("intro"),
      f.string("dates_title"),
      f.text("dates_note"),
      f.string("room_title"),
      f.text("room_note"),
      f.string("contact_title"),
      f.string("message_placeholder", "Texte d'exemple grisé dans le champ message"),
      f.string("submit_label", "Texte du bouton d'envoi"),
      f.repeater("reassurance", "Petites lignes ✓ sous le bouton", "{{text}}", [input("text", "Texte", "full")]),
      f.string("success_title"),
      f.text("success_text"),
    ],
  );
  // Textes du mode « réservation en ligne » (Elloha configuré)
  for (const field of [
    f.string("online_title", "Remplace le titre quand la réservation en ligne est active"),
    f.text("online_intro", "Remplace l'introduction quand la réservation en ligne est active"),
    f.string("online_submit_label", "Bouton qui mène au paiement"),
    f.text("online_note", "Petite ligne sous le bouton de paiement"),
    f.repeater("online_reassurance", "Petites lignes ✓ sous le bouton (réservation en ligne)", "{{text}}", [input("text", "Texte", "full")]),
    f.text("none_available", "Message si aucune chambre n'est libre aux dates choisies"),
    f.text("online_error", "Message si la réservation en ligne ne répond pas (le formulaire de demande prend le relais)"),
  ]) await ensureField("booking_form", field);
}

// ---------------------------------------------------------------- Présentation du back-office

type Layout = [label: string, fields: [field: string, label: string][]][];

/**
 * Range les champs d'une collection en blocs repliables, avec des libellés en français.
 * Ne modifie que l'affichage (meta), jamais les données. Bloc nommé "" = hors groupe.
 */
async function arrange(collection: string, layout: Layout) {
  const current = await api<{ field: string; meta: { group: string | null; sort: number | null; translations: { translation: string }[] | null } | null }[]>(
    "GET",
    `/fields/${collection}`,
  );
  const byName = new Map(current.map((c) => [c.field, c]));
  const fr = (translation: string) => [{ language: "fr-FR", translation }];
  let sort = 1;
  let changed = 0;
  const patch = async (field: string, meta: Record<string, unknown>) => {
    const c = byName.get(field);
    if (!c) return;
    const same =
      (c.meta?.group ?? null) === meta.group && c.meta?.sort === meta.sort && c.meta?.translations?.[0]?.translation === (meta.translations as { translation: string }[])[0].translation;
    if (!same) {
      await api("PATCH", `/fields/${collection}/${field}`, { meta });
      changed++;
    }
  };
  for (const [i, [label, fields]] of layout.entries()) {
    let group: string | null = null;
    if (label) {
      group = `bloc_${i}`;
      if (!byName.has(group)) {
        await api("POST", `/fields/${collection}`, {
          field: group,
          type: "alias",
          schema: null,
          meta: { interface: "group-detail", special: ["alias", "no-data", "group"], options: { start: "closed" } },
        });
        byName.set(group, { field: group, meta: null });
      }
      await patch(group, { group: null, sort: sort++, translations: fr(label) });
    }
    let inner = 1;
    for (const [field, fieldLabel] of fields) await patch(field, { group, sort: group ? inner++ : sort++, translations: fr(fieldLabel) });
  }
  if (changed) console.log(`✓ ${collection} : ${changed} champ(s) rangé(s)`);
}

async function backOffice() {
  await arrange("home", [
    ["Haut de page", [["hero_eyebrow", "Sur-titre"], ["key_facts", "Infos clés (bandeau noir)"]]],
    ["Chambres", [["rooms_eyebrow", "Sur-titre"], ["rooms_title", "Titre"], ["rooms_intro", "Texte d'introduction"]]],
    ["Tarifs", [["rates_eyebrow", "Sur-titre"], ["rates_title", "Titre"], ["rates_intro", "Texte d'introduction"], ["rates_notes", "Précisions"]]],
    [
      "Réserver en direct",
      [
        ["booking_eyebrow", "Sur-titre"], ["booking_title", "Titre"], ["booking_image", "Photo"], ["booking_steps", "Étapes"],
        ["cancellation_title", "Titre annulation"], ["cancellation_tiers", "Conditions d'annulation"], ["cancellation_note", "Précision annulation"],
        ["good_to_know_title", "Titre « bon à savoir »"], ["good_to_know", "Bon à savoir"],
      ],
    ],
    ["Le lodge", [["lodge_eyebrow", "Sur-titre"], ["lodge_images", "Photos"]]],
    ["Galerie", [["gallery_eyebrow", "Sur-titre"], ["gallery_title", "Titre"], ["gallery", "Photos"]]],
    [
      "Avis",
      [
        ["reviews_eyebrow", "Sur-titre"], ["ratings", "Notes"], ["review_quote", "Extrait d'avis"], ["review_attribution", "Auteur de l'avis"],
        ["review_highlights", "Notes détaillées"], ["review_highlights_note", "Source des notes détaillées"],
      ],
    ],
    ["Infos pratiques", [["faq_eyebrow", "Sur-titre"], ["faq_title", "Titre"], ["faq_intro", "Phrase d'introduction"]]],
    ["Accès", [["access_eyebrow", "Sur-titre"]]],
  ]);

  await arrange("booking_form", [
    ["En-tête", [["title", "Titre"], ["intro", "Introduction"]]],
    ["Étape 1 : dates", [["dates_title", "Titre"], ["dates_note", "Précision"]]],
    ["Étape 2 : chambre", [["room_title", "Titre"], ["room_note", "Précision"]]],
    ["Étape 3 : coordonnées", [["contact_title", "Titre"], ["message_placeholder", "Exemple de message"]]],
    ["Récapitulatif", [["submit_label", "Bouton d'envoi"], ["reassurance", "Arguments"]]],
    ["Confirmation", [["success_title", "Titre"], ["success_text", "Texte"]]],
    [
      "Réservation en ligne (Elloha)",
      [
        ["online_title", "Titre"], ["online_intro", "Introduction"], ["online_submit_label", "Bouton de paiement"], ["online_note", "Précision sous le bouton"],
        ["online_reassurance", "Arguments"], ["none_available", "Message « complet »"], ["online_error", "Message si indisponible"],
      ],
    ],
  ]);

  await arrange("settings", [
    ["", [["site_name", "Nom du lodge"], ["tagline", "Grand titre de l'accueil"], ["hero_image", "Photo d'accueil"], ["seo_description", "Description (Google et IA)"]]],
    ["Coordonnées", [["address", "Adresse"], ["phone", "Téléphone"], ["contact_email", "E-mail affiché"], ["notification_email", "E-mail qui reçoit les demandes"], ["instagram_url", "Instagram"], ["latitude", "Latitude"], ["longitude", "Longitude"]]],
    ["Séjour", [["checkin_from", "Accueil à partir de"], ["checkin_to", "Accueil jusqu'à"], ["checkout_until", "Départ au plus tard"], ["tourist_tax", "Taxe de séjour (€/nuit/pers.)"], ["deposit_percent", "Acompte (%)"]]],
  ]);

  await arrange("rooms", [
    ["", [["status", "Statut"], ["name", "Nom"], ["slug", "Adresse de la page"], ["summary", "Résumé"], ["description", "Description"], ["capacity", "Personnes max."], ["price_from", "Prix à partir de (€/nuit)"], ["bed", "Literie"], ["features", "Atout"], ["cover", "Photo principale"], ["gallery", "Autres photos"], ["elloha_offer_id", "Identifiant Elloha"]]],
  ]);

  await arrange("seasons", [
    ["", [["status", "Statut"], ["name", "Nom"], ["highlight", "Mise en avant"], ["periods", "Périodes"], ["periods_note", "Dates affichées (optionnel)"], ["price_double", "Prix 2 personnes"], ["price_single", "Prix 1 personne"], ["min_nights", "Séjour minimum"], ["min_nights_weekend", "Minimum le week-end"], ["long_stay_nights", "Long séjour dès (nuits)"], ["long_stay_discount", "Remise long séjour (%)"]]],
  ]);

  await arrange("faq", [["", [["status", "Statut"], ["question", "Question"], ["answer", "Réponse"]]]]);

  await arrange("pages", [
    ["", [["status", "Statut"], ["title", "Titre"], ["slug", "Adresse de la page"], ["intro", "Chapeau"], ["content", "Contenu"], ["cover", "Image"], ["seo_description", "Description (Google et IA)"]]],
  ]);
}

// ---------------------------------------------------------------- Accès

type Perm = { collection: string; action: "create" | "read" | "update" | "delete" };

async function ensurePolicy(name: string, props: Record<string, unknown>, perms: Perm[]) {
  const [found] = await api<{ id: string }[]>("GET", `/policies?filter[name][_eq]=${encodeURIComponent(name)}&fields=id`);
  const id = found?.id ?? (await api<{ id: string }>("POST", "/policies", { name, ...props })).id;
  if (!found) console.log(`+ policy ${name}`);
  await syncPermissions(id, perms);
  return id;
}

async function syncPermissions(policy: string, perms: Perm[]) {
  const current = await api<{ collection: string; action: string }[]>("GET", `/permissions?filter[policy][_eq]=${policy}&fields=collection,action&limit=-1`);
  for (const p of perms) {
    if (current.some((c) => c.collection === p.collection && c.action === p.action)) continue;
    await api("POST", "/permissions", { policy, fields: ["*"], ...p });
  }
}

async function ensureRole(name: string, policyId: string, icon: string) {
  const [found] = await api<{ id: string }[]>("GET", `/roles?filter[name][_eq]=${encodeURIComponent(name)}&fields=id`);
  if (found) return found.id;
  const role = await api<{ id: string }>("POST", "/roles", { name, icon, policies: [{ policy: policyId }] });
  console.log(`+ rôle ${name}`);
  return role.id;
}

async function access() {
  const crud = (collection: string): Perm[] => (["create", "read", "update", "delete"] as const).map((action) => ({ collection, action }));

  // Visiteurs anonymes : uniquement les images (balises <img> du site)
  const [pub] = await api<{ id: string }[]>("GET", `/policies?filter[name][_eq]=${encodeURIComponent("$t:public_label")}&fields=id`);
  await syncPermissions(pub.id, [{ collection: "directus_files", action: "read" }]);

  // Serveur Astro (token statique) : lecture du contenu publié + création des demandes
  const webPolicy = await ensurePolicy("Site web", { icon: "public", app_access: false, admin_access: false }, [
    { collection: "settings", action: "read" },
    // NB : Directus 12 (licence gratuite) refuse les permissions personnalisées
    // (filtre "status = published", restriction par champ) → le filtre "publié"
    // est appliqué dans les requêtes du site (src/lib/directus.ts > published).
    { collection: "pages", action: "read" },
    { collection: "rooms", action: "read" },
    { collection: "rooms_files", action: "read" },
    { collection: "home", action: "read" },
    { collection: "home_lodge_images", action: "read" },
    { collection: "home_gallery", action: "read" },
    { collection: "seasons", action: "read" },
    { collection: "faq", action: "read" },
    { collection: "booking_form", action: "read" },
    { collection: "directus_files", action: "read" },
    { collection: "booking_requests", action: "create" },
  ]);
  const webRole = await ensureRole("Site web", webPolicy, "public");

  const [webUser] = await api<{ id: string }[]>("GET", "/users?filter[email][_eq]=site-web@example.org&fields=id");
  if (!webUser) {
    await api("POST", "/users", { first_name: "Site web", email: "site-web@example.org", role: webRole, token: WEB_TOKEN, status: "active" });
    console.log("+ utilisateur technique site-web");
  } else {
    await api("PATCH", `/users/${webUser.id}`, { token: WEB_TOKEN });
  }

  // Propriétaire : gère tout le contenu + consulte/traite les demandes, sans accès aux réglages techniques
  const ownerPolicy = await ensurePolicy("Propriétaire", { icon: "home", app_access: true, admin_access: false, enforce_tfa: false }, [
    { collection: "settings", action: "read" },
    { collection: "settings", action: "update" },
    ...crud("pages"),
    ...crud("rooms"),
    ...crud("rooms_files"),
    { collection: "home", action: "read" },
    { collection: "home", action: "update" },
    ...crud("home_lodge_images"),
    ...crud("home_gallery"),
    ...crud("seasons"),
    ...crud("faq"),
    { collection: "booking_form", action: "read" },
    { collection: "booking_form", action: "update" },
    ...crud("directus_files"),
    { collection: "directus_folders", action: "read" },
    { collection: "booking_requests", action: "read" },
    { collection: "booking_requests", action: "update" },
  ]);
  await ensureRole("Propriétaire", ownerPolicy, "home");
}

// ---------------------------------------------------------------- Réglages Directus

async function projectSettings() {
  await api("PATCH", "/settings", {
    project_name: "Ohana Lodge",
    project_url: SITE_URL,
    default_language: "fr-FR",
    visual_editor_urls: [{ url: `${SITE_URL}/?visual-editing=true` }],
    module_bar: [
      { type: "module", id: "visual", enabled: true },
      { type: "module", id: "content", enabled: true },
      { type: "module", id: "files", enabled: true },
      { type: "module", id: "users", enabled: true },
      { type: "module", id: "insights", enabled: false },
      { type: "module", id: "flows", enabled: true },
      { type: "module", id: "deployments", enabled: false },
      { type: "module", id: "settings", enabled: true, locked: true },
    ],
  });
  console.log("✓ réglages (éditeur visuel activé)");

  // Bouton « Aperçu » des formulaires Directus : ouvre la page du site correspondante en mode édition visuelle
  const ve = "visual-editing=true";
  const previews: Record<string, string> = {
    settings: `${SITE_URL}/?${ve}`,
    home: `${SITE_URL}/?${ve}`,
    seasons: `${SITE_URL}/?${ve}#tarifs`,
    faq: `${SITE_URL}/?${ve}#infos`,
    rooms: `${SITE_URL}/chambres/{{slug}}?${ve}`,
    pages: `${SITE_URL}/{{slug}}?${ve}`,
    booking_form: `${SITE_URL}/reserver?${ve}`,
  };
  for (const [collection, preview_url] of Object.entries(previews)) {
    const current = await api<{ meta: { preview_url: string | null } }>("GET", `/collections/${collection}`);
    if (current.meta.preview_url !== preview_url) {
      await api("PATCH", `/collections/${collection}`, { meta: { preview_url } });
      console.log(`+ aperçu ${collection}`);
    }
  }
}

// ---------------------------------------------------------------- Personnalisation du back-office

/** Dépose un fichier de directus/branding dans la médiathèque (une seule fois, retrouvé par son nom). */
async function brandingFile(name: string, title: string, folder: string) {
  const [found] = await api<{ id: string }[]>("GET", `/files?filter[filename_download][_eq]=${encodeURIComponent(name)}&fields=id&limit=1`);
  if (found) return found.id;
  const path = new URL(`../directus/branding/${name}`, import.meta.url);
  const type = name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".jpg") ? "image/jpeg" : "image/png";
  const form = new FormData();
  form.append("title", title);
  form.append("folder", folder);
  form.append("file", new Blob([await readFile(path)], { type }), name);
  const res = await fetch(`${URL_}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  if (!res.ok) throw new Error(`upload ${name} → ${res.status}`);
  console.log(`+ fichier ${name}`);
  return ((await res.json()) as { data: { id: string } }).data.id;
}

/** Thème clair aux couleurs du site (clés : thème Directus « Directus Default »). */
const THEME = {
  primary: "#1d201d",
  foreground: "#3e433d",
  foregroundAccent: "#1d201d",
  foregroundSubdued: "#5c615b",
  background: "#ffffff",
  backgroundNormal: "#f7f5f0",
  backgroundAccent: "#ede7dc",
  backgroundSubdued: "#f7f5f0",
  borderColor: "#e2ded5",
  borderColorAccent: "#d9d4c9",
  borderColorSubdued: "#ede7dc",
  borderRadius: "8px",
  fonts: {
    sans: { fontFamily: '"Inter", system-ui, sans-serif' },
    display: { fontFamily: '"Inter Tight", system-ui, sans-serif', fontWeight: "500" },
    title: { fontFamily: '"Inter Tight", system-ui, sans-serif', fontWeight: "500" },
  },
  navigation: {
    modules: {
      background: "#111111",
      button: { foreground: "#b5b0a6", foregroundHover: "#ffffff", foregroundActive: "#111111", backgroundActive: "#f7f5f0" },
    },
    list: { backgroundActive: "#ede7dc", backgroundHover: "#ede7dc" },
  },
};

async function branding() {
  // Dossier dédié dans la médiathèque, pour ne pas mélanger avec les photos du site
  const [folder] = await api<{ id: string }[]>("GET", `/folders?filter[name][_eq]=${encodeURIComponent("Identité du back-office")}&fields=id`);
  const folderId = folder?.id ?? (await api<{ id: string }>("POST", "/folders", { name: "Identité du back-office" })).id;

  const current = await api<Record<string, unknown>>("GET", "/settings");
  const hero = (await api<{ hero_image: string | null } | null>("GET", "/items/settings?fields=hero_image"))?.hero_image;

  const patch: Record<string, unknown> = {
    project_descriptor: "Gestion du site",
    project_color: "#111111",
    default_appearance: "light",
    theme_light_overrides: THEME,
    public_note: "Bienvenue ! Connectez-vous pour gérer les chambres, les tarifs, les textes et les demandes de réservation d'Ohana Lodge.",
  };
  // Images : posées une fois, l'administrateur peut ensuite les remplacer depuis Directus
  if (!current.project_logo) patch.project_logo = await brandingFile("logo.svg", "Logo du back-office", folderId);
  if (!current.public_favicon) patch.public_favicon = await brandingFile("favicon.svg", "Favicon du back-office", folderId);
  if (!current.public_foreground) patch.public_foreground = await brandingFile("wordmark-white.png", "Logo de la page de connexion", folderId);
  // Fond de la page de connexion : photo sombre (coucher de soleil) pour que le logo et le texte blancs restent lisibles
  // (contraste mesuré : logo 9,5:1, texte 5,7:1). Remplace aussi l'ancien réglage (photo d'accueil, trop claire).
  if (!current.public_background || current.public_background === hero)
    patch.public_background = await brandingFile("login.jpg", "Fond de la page de connexion", folderId);

  const changed = Object.keys(patch).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(patch[k]));
  if (changed.length) {
    await api("PATCH", "/settings", Object.fromEntries(changed.map((k) => [k, patch[k]])));
    console.log(`✓ identité visuelle : ${changed.join(", ")}`);
  }
}

/** Menu de gauche : les demandes en premier, puis un dossier « Contenu du site ». */
async function navigation() {
  const FOLDER = "contenu_du_site";
  if (!(await exists(`/collections/${FOLDER}`))) {
    await api("POST", "/collections", {
      collection: FOLDER,
      schema: null,
      meta: { icon: "web", collapse: "open", translations: [{ language: "fr-FR", translation: "Contenu du site" }] },
    });
    console.log("+ dossier Contenu du site");
  }
  const order: [string, string | null, number][] = [
    ["booking_requests", null, 1],
    [FOLDER, null, 2],
    ["home", FOLDER, 1],
    ["rooms", FOLDER, 2],
    ["seasons", FOLDER, 3],
    ["faq", FOLDER, 4],
    ["booking_form", FOLDER, 5],
    ["pages", FOLDER, 6],
    ["settings", FOLDER, 7],
  ];
  let moved = 0;
  for (const [collection, group, sort] of order) {
    const { meta } = await api<{ meta: { group: string | null; sort: number | null } }>("GET", `/collections/${collection}`);
    if (meta.group !== group || meta.sort !== sort) {
      await api("PATCH", `/collections/${collection}`, { meta: { group, sort } });
      moved++;
    }
  }
  if (moved) console.log(`✓ menu : ${moved} collection(s) rangée(s)`);

  // Libellés et vue par défaut des demandes de réservation
  await arrange("booking_requests", [
    ["", [["status", "Statut"], ["date_created", "Reçue"], ["name", "Nom"], ["email", "E-mail"], ["phone", "Téléphone"], ["room", "Chambre"], ["arrival", "Arrivée"], ["departure", "Départ"], ["guests", "Voyageurs"], ["message", "Message"]]],
  ]);
  const view = {
    layout: "tabular",
    layout_query: { tabular: { fields: ["status", "name", "arrival", "departure", "guests", "room.name", "date_created"], sort: ["-date_created"], limit: 50 } },
    layout_options: { tabular: { widths: { status: 140, name: 220, arrival: 130, departure: 130, guests: 110, "room.name": 200 } } },
  };
  const presets = await api<{ id: number; bookmark: string | null }[]>(
    "GET",
    "/presets?filter[collection][_eq]=booking_requests&filter[user][_null]=true&filter[role][_null]=true&fields=id,bookmark",
  );
  if (!presets.some((p) => p.bookmark === null)) {
    await api("POST", "/presets", { collection: "booking_requests", user: null, role: null, ...view });
    console.log("+ vue par défaut des demandes");
  }
  if (!presets.some((p) => p.bookmark === "Nouvelles demandes")) {
    await api("POST", "/presets", {
      collection: "booking_requests",
      user: null,
      role: null,
      bookmark: "Nouvelles demandes",
      icon: "mark_email_unread",
      color: "#E8A23B",
      filter: { status: { _eq: "new" } },
      ...view,
    });
    console.log("+ signet Nouvelles demandes");
  }
}

// ---------------------------------------------------------------- Contenu d'exemple

async function seed() {
  const settings = await api<{ site_name?: string } | null>("GET", "/items/settings");
  if (!settings?.site_name) {
    await api("PATCH", "/items/settings", {
      site_name: "Ohana Lodge",
      tagline: "Chambres d'hôtes entre forêt et océan, à Moliets-et-Maâ",
      seo_description: "Ohana Lodge, chambres d'hôtes à Moliets-et-Maâ (Landes). Réservation directe, sans commission.",
      address: "Moliets-et-Maâ, Landes",
    });
    console.log("+ réglages par défaut");
  }
  const pages = await api<unknown[]>("GET", "/items/pages?filter[slug][_eq]=accueil&limit=1");
  if (!pages.length) {
    await api("POST", "/items/pages", {
      status: "published",
      slug: "accueil",
      title: "Bienvenue chez nous",
      intro: "Un lodge au calme, à quelques minutes de la plage.",
      content: "<p>Texte de présentation à personnaliser depuis l'éditeur visuel.</p>",
    });
    await api("POST", "/items/pages", { status: "published", slug: "mentions-legales", title: "Mentions légales", content: "<p>À compléter.</p>" });
    console.log("+ pages d'exemple");
  }
  const rooms = await api<unknown[]>("GET", "/items/rooms?limit=1");
  if (!rooms.length) {
    await api("POST", "/items/rooms", {
      status: "published",
      name: "Chambre Océan",
      slug: "chambre-ocean",
      summary: "Lumineuse, lit double, terrasse privative.",
      description: "<p>Description à personnaliser.</p>",
      capacity: 2,
      price_from: 95,
    });
    console.log("+ chambre d'exemple");
  }

  const cgv = await api<unknown[]>("GET", "/items/pages?filter[slug][_eq]=conditions-de-vente&limit=1");
  if (!cgv.length) {
    // Texte fourni par la propriétaire (« Accueil - Esprit lodge »)
    await api("POST", "/items/pages", {
      status: "published",
      slug: "conditions-de-vente",
      title: "Conditions de vente et esprit du lodge",
      intro: "Loger en chambre d'hôtes, c'est partager quelques heures ou quelques jours d'une tranche de vie avec le propriétaire. Profitez de tous les lieux de vie dans la convivialité et le respect de l'intimité de chacun.",
      content: [
        "<h2>Arrivées et départs</h2>",
        "<p>Votre accueil se fait le jour de votre arrivée, de 17 h à 20 h. Le dernier jour, les départs se font au plus tard à 11 h, afin d'offrir aux personnes qui arrivent ensuite le logement le plus accueillant possible.</p>",
        "<h2>Petits-déjeuners</h2>",
        "<p>Les petits-déjeuners sont servis à l'intérieur du Pool House, entre 8 h 30 et 10 h.</p>",
        "<h2>Les chambres</h2>",
        "<p>Les chambres ne sont pas prévues pour y faire la lessive ou prendre les repas. Le son doit être modéré à partir de 22 h 30. Le Wi-Fi est gratuit ; le téléchargement illégal est interdit.</p>",
        "<p>L'entretien de la chambre, de la salle d'eau et des serviettes est effectué tous les 3 jours. Pour les séjours d'une semaine et plus, les draps sont changés au milieu du séjour.</p>",
        "<h2>Réservation, acompte et annulation</h2>",
        "<p>Après votre demande, nous vous adressons une proposition à confirmer sous 5 jours avec un acompte de 30 % par virement. Le solde se règle à l'arrivée (CB, espèces ou virement ; pas d'American Express).</p>",
        "<p>Annulation gratuite jusqu'à 60 jours avant l'arrivée ; de J-60 à J-2, 30 % du montant total ; la veille et le jour même, 100 %. Tout séjour commencé est dû en totalité.</p>",
        "<h2>Dispositions générales</h2>",
        "<p>Les chambres sont non-fumeur. Le lodge accueille les adultes et les enfants à partir de 16 ans. Pour le confort et la tranquillité de tous, nous ne pouvons pas accueillir les animaux. Le propriétaire décline toute responsabilité en cas de vol ou de dommage corporel survenu dans la propriété.</p>",
        "<h2>Éco-tourisme</h2>",
        "<p>Nous comptons sur votre collaboration pour réduire l'empreinte du lodge :</p>",
        "<ul><li>éviter de laisser les lumières inutilement allumées ;</li><li>ne pas laisser couler l'eau et modérer le débit lors des douches ;</li><li>utiliser le tri sélectif à la sortie du lodge.</li></ul>",
        "<p>Merci par avance de votre compréhension et de votre collaboration.</p>",
      ].join(""),
      seo_description: "Conditions de vente d'Ohana Lodge : horaires, acompte, annulation, règles de la maison.",
    });
    console.log("+ page conditions de vente");
  }

  // Réglages ajoutés par la refonte : on ne remplit que les champs encore vides
  await fillEmpty("settings", {
    phone: "06 70 10 91 92",
    checkin_from: "17:00:00",
    checkin_to: "20:00:00",
    checkout_until: "11:00:00",
    tourist_tax: 1.15,
    deposit_percent: 30,
    latitude: 43.8500707,
    longitude: -1.3774179,
  });

  await fillEmpty("home", {
    hero_eyebrow: "Chambres d'hôtes · Moliets-et-Maâ · Landes",
    key_facts: [
      { icon: "bed", label: "Capacité", value: "4 chambres · 8 pers." },
      { icon: "arrival", label: "Arrivée", value: "17 h – 20 h" },
      { icon: "departure", label: "Départ", value: "avant 11 h" },
      { icon: "breakfast", label: "Petit-déjeuner", value: "inclus" },
      { icon: "beach", label: "Plage", value: "≈ 1,5 km" },
      { icon: "pool", label: "Sur place", value: "piscine · Wi-Fi" },
    ],
    ratings: [
      { source: "google", score: "[4,9]", scale: 5, count: null, label: null, url: null },
      { source: "booking", score: "[9,4]", scale: 10, count: null, label: "Exceptionnel", url: null },
      { source: "tripadvisor", score: "[4,8]", scale: 5, count: null, label: null, url: null },
    ],
    review_quote: "[Extrait d'un avis réel, copié tel quel]",
    review_attribution: "[Prénom], [pays] · avis Booking.com · [mois année]",
    review_highlights: [
      { label: "Propreté", score: "[9,8]" },
      { label: "Accueil", score: "[10]" },
      { label: "Calme", score: "[9,7]" },
      { label: "Petit-déjeuner", score: "[9,6]" },
      { label: "Emplacement", score: "[9,5]" },
    ],
    review_highlights_note: "Notes détaillées Booking.com, relevées le [date]",
    rooms_eyebrow: "Les chambres",
    rooms_title: "Sobres, lumineuses,\nchacune avec sa terrasse.",
    rooms_intro: "Salle d'eau indépendante avec douche à l'italienne, literie 180 × 200 ou 160 × 200, TV, Wi-Fi gratuit. Toutes ouvrent sur la piscine et le sun deck.",
    rates_eyebrow: "Tarifs",
    rates_title: "Un prix par nuit,\npetit-déjeuner compris.",
    rates_intro: "Même tarif pour les 4 chambres. Seule la saison change le prix.",
    rates_notes: [
      { text: "Prix par nuit et par chambre, TTC" },
      { text: "Petit-déjeuner continental inclus (valeur 8 €/pers.)" },
      { text: "Week-end = nuits du vendredi et du samedi" },
    ],
    booking_eyebrow: "Réserver en direct",
    booking_title: "Simple, en 4 étapes.",
    booking_steps: [
      { title: "Votre demande", text: "En 1 minute sur ce site, sans paiement." },
      { title: "Notre proposition", text: "Selon nos disponibilités, par e-mail." },
      { title: "Votre confirmation", text: "Sous 5 jours : proposition signée et acompte de 30 % par virement." },
      { title: "Sur place", text: "Le solde se règle à l'arrivée : CB, espèces ou virement." },
    ],
    cancellation_title: "Annulation",
    cancellation_tiers: [
      { value: "Gratuit", label: "jusqu'à J-60" },
      { value: "30 %", label: "de J-60 à J-2" },
      { value: "100 %", label: "veille et jour J" },
    ],
    cancellation_note: "Pourcentage du montant total. Séjour commencé : dû en totalité.",
    good_to_know_title: "Bon à savoir",
    good_to_know: [
      { icon: "age", text: "Dès 16 ans" },
      { icon: "no", text: "Sans animaux · non-fumeur" },
      { icon: "group", text: "8 personnes max." },
      { icon: "card", text: "CB, espèces, virement · pas d'Amex" },
    ],
    lodge_eyebrow: "Le lodge",
    gallery_eyebrow: "Le lieu en images",
    gallery_title: "Du lever au coucher du soleil.",
    reviews_eyebrow: "Ce qu'en disent nos hôtes",
    faq_eyebrow: "Infos pratiques",
    faq_title: "Les réponses, avant de réserver.",
    faq_intro: "Une autre question ? Appelez directement le",
    access_eyebrow: "Accès & contact",
  });

  await fillEmpty("booking_form", {
    title: "Demande de réservation",
    intro: "3 étapes, 1 minute. Aucun paiement sur le site : vous recevez d'abord une proposition.",
    dates_title: "Vos dates",
    dates_note: "Plusieurs chambres ? Précisez-le dans votre message (8 personnes max., enfants dès 16 ans).",
    room_title: "Votre chambre",
    room_note: "Disponibilités confirmées par le propriétaire dans sa proposition.",
    contact_title: "Vos coordonnées",
    message_placeholder: "Heure d'arrivée prévue, demande particulière…",
    submit_label: "Envoyer ma demande",
    reassurance: [
      { text: "Sans commission, tarif direct" },
      { text: "Petit-déjeuner inclus" },
      { text: "Aucun paiement sur le site" },
      { text: "Annulation gratuite jusqu'à J-60" },
    ],
    online_title: "Réserver votre séjour",
    online_intro: "Vérifiez les disponibilités, choisissez votre chambre et réglez en ligne, en toute sécurité.",
    online_submit_label: "Réserver et payer",
    online_note: "Paiement sécurisé sur la page de notre partenaire Elloha.",
    online_reassurance: [
      { text: "Tarif direct, sans commission" },
      { text: "Petit-déjeuner inclus" },
      { text: "Disponibilité confirmée immédiatement" },
    ],
    none_available: "Aucune chambre n'est disponible à ces dates. Essayez d'autres dates ou appelez-nous : nous trouverons peut-être une solution.",
    online_error: "La réservation en ligne ne répond pas pour le moment. Envoyez-nous une demande : nous vous répondons rapidement.",
    success_title: "Demande envoyée, merci !",
    success_text: "Vous recevez un e-mail récapitulatif. Nous vous adressons rapidement une proposition. Vous aurez ensuite 5 jours pour la confirmer avec un acompte de 30 % par virement.",
  });

  const seasons = await api<unknown[]>("GET", "/items/seasons?limit=1");
  if (!seasons.length) {
    const rules = { min_nights: 1, min_nights_weekend: 2 };
    await api("POST", "/items/seasons", [
      { status: "published", sort: 1, name: "Basse saison", periods: [{ from: "03-01", to: "05-04" }, { from: "09-29", to: "10-26" }], periods_note: "[Ouverture] → 4 mai\n29 sept. → 26 oct.", price_double: 93, price_single: 85, ...rules },
      { status: "published", sort: 2, name: "Moyenne saison", periods: [{ from: "05-05", to: "07-06" }, { from: "09-01", to: "09-28" }], price_double: 99, price_single: 91, ...rules },
      { status: "published", sort: 3, name: "Haute saison", highlight: true, periods: [{ from: "07-07", to: "08-31" }], price_double: 118, price_single: 110, min_nights: 3, min_nights_weekend: 3, long_stay_nights: 10, long_stay_discount: 10 },
    ]);
    console.log("+ saisons et tarifs");
  }

  const faq = await api<unknown[]>("GET", "/items/faq?limit=1");
  if (!faq.length) {
    const qa: [string, string][] = [
      ["Comment réserver ?", "<p>Envoyez votre demande sur ce site : vous recevez une proposition, à confirmer sous 5 jours avec un acompte de 30 % par virement. Aucun paiement sur le site, le solde se règle sur place.</p>"],
      ["À quelle heure arriver et partir ?", "<p>Accueil le jour d'arrivée de 17 h à 20 h. Départ au plus tard à 11 h.</p>"],
      ["Le petit-déjeuner est-il inclus ?", "<p>Oui, le petit-déjeuner continental est inclus. Il est servi au Pool House de 8 h 30 à 10 h.</p>"],
      ["Enfants et animaux sont-ils acceptés ?", "<p>Le lodge accueille les adultes et les enfants à partir de 16 ans. Les animaux ne sont pas admis. Les chambres sont non-fumeur.</p>"],
      ["Y a-t-il un parking ?", "<p>[À confirmer par le propriétaire]</p>"],
      ["Conditions d'annulation ?", "<p>Gratuite jusqu'à 60 jours avant l'arrivée, puis 30 % du séjour, et 100 % la veille ou le jour même. <a href=\"/#tarifs\">Détail des conditions</a></p>"],
    ];
    await api("POST", "/items/faq", qa.map(([question, answer], i) => ({ status: "published", sort: i + 1, question, answer })));
    console.log("+ questions fréquentes");
  }
}

/** Renseigne les champs vides d'un singleton (n'écrase jamais une valeur saisie). */
async function fillEmpty(singleton: string, defaults: Record<string, unknown>) {
  const current = (await api<Record<string, unknown> | null>("GET", `/items/${singleton}`)) ?? {};
  const patch = Object.fromEntries(Object.entries(defaults).filter(([k]) => current[k] == null || current[k] === ""));
  if (Object.keys(patch).length) {
    await api("PATCH", `/items/${singleton}`, patch);
    console.log(`+ ${singleton} : ${Object.keys(patch).join(", ")}`);
  }
}

// ----------------------------------------------------------------

const login = await api<{ access_token: string }>("POST", "/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
token = login.access_token;

await schema();
await backOffice();
await access();
await projectSettings();
await seed();
await branding();
await navigation();
console.log("✓ Directus prêt");
