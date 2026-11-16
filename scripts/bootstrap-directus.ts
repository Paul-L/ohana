/**
 * Initialise (ou met à niveau) Directus pour Ohana : collections, relations,
 * rôles/permissions, réglages de l'éditeur visuel et contenu d'exemple.
 *
 * Idempotent : peut être relancé sans risque, il n'ajoute que ce qui manque.
 * Usage : pnpm cms:bootstrap   (lit le .env de la racine)
 */

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
    project_color: "#2F5D62",
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
}

// ----------------------------------------------------------------

const login = await api<{ access_token: string }>("POST", "/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
token = login.access_token;

await schema();
await access();
await projectSettings();
await seed();
console.log("✓ Directus prêt");
