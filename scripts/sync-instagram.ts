// Importe les dernières photos du compte Instagram du lodge dans Directus (collection `instagram_posts` + médiathèque).
// Lancé chaque semaine : tâche planifiée Coolify sur le conteneur web → `node scripts/sync-instagram.ts`
// En local : `pnpm instagram:sync`
//
// Source : Instagram API avec connexion Instagram (compte professionnel, permission instagram_business_basic).
// Jeton longue durée (60 jours) : fourni une première fois par INSTAGRAM_TOKEN, puis renouvelé à chaque passage
// et conservé dans Directus (collection masquée `instagram_auth`, lisible seulement par l'utilisateur de synchro).
//
// Roulement : seules les KEEP publications les plus récentes sont gardées ; les plus anciennes sont retirées
// avec leur image. La propriétaire peut masquer une photo (case « Afficher »), elle reste alors masquée.
//
// Variables : DIRECTUS_URL, DIRECTUS_SYNC_TOKEN, INSTAGRAM_TOKEN (premier passage, ou si le jeton a expiré)

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Variable manquante : ${name}`);
  return v;
};

const DIRECTUS_URL = env("DIRECTUS_URL").replace(/\/$/, "");
const DIRECTUS_TOKEN = env("DIRECTUS_SYNC_TOKEN");
const GRAPH = "https://graph.instagram.com";
const KEEP = 12; // publications conservées (le site en affiche 5)
const FOLDER = "Instagram";

interface Media {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
}

async function directus<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${DIRECTUS_TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (!res.ok) throw new Error(`Directus ${method} ${path} → ${res.status} ${json.errors?.map((e) => e.message).join(", ") ?? ""}`);
  return json.data as T;
}

async function graph<T>(path: string, token: string): Promise<T> {
  const url = `${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const json = (await res.json()) as T & { error?: { message: string; code?: number } };
  if (!res.ok || json.error) throw new Error(`Instagram ${path.split("?")[0]} → ${res.status} ${json.error?.message ?? ""}`);
  return json;
}

/** Jeton : celui conservé dans Directus, sinon INSTAGRAM_TOKEN ; renouvelé (+60 jours) à chaque passage. */
async function accessToken() {
  const auth = await directus<{ token: string | null } | null>("GET", "/items/instagram_auth?fields=token");
  const candidates = [...new Set([auth?.token, process.env.INSTAGRAM_TOKEN].filter((t): t is string => !!t))];
  if (!candidates.length) throw new Error("Aucun jeton Instagram : renseigner INSTAGRAM_TOKEN (voir README, « Photos Instagram »)");

  let lastError: unknown;
  for (const token of candidates) {
    const fresh = await graph<{ access_token: string; expires_in: number }>("/refresh_access_token?grant_type=ig_refresh_token", token).catch(
      (err) => ((lastError = err), null),
    );
    if (fresh) {
      const expires_at = new Date(Date.now() + fresh.expires_in * 1000).toISOString();
      await directus("PATCH", "/items/instagram_auth", { token: fresh.access_token, expires_at });
      return fresh.access_token;
    }
    // Jeton de moins de 24 h : Instagram refuse de le renouveler, mais il reste valable
    const valid = await graph("/me?fields=id", token).then(() => true, () => false);
    if (valid) {
      if (token !== auth?.token) await directus("PATCH", "/items/instagram_auth", { token });
      return token;
    }
  }
  throw new Error(
    `Jeton Instagram expiré ou révoqué (${lastError instanceof Error ? lastError.message : lastError}). ` +
      "Générer un nouveau jeton (README, « Photos Instagram ») dans INSTAGRAM_TOKEN.",
  );
}

async function folderId() {
  const [folder] = await directus<{ id: string }[]>("GET", `/folders?filter[name][_eq]=${FOLDER}&fields=id&limit=1`);
  return folder?.id ?? null;
}

async function main() {
  const token = await accessToken();
  const me = await graph<{ username: string }>("/me?fields=username", token);
  const { data: media = [] } = await graph<{ data?: Media[] }>(
    `/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=${KEEP + 8}`,
    token,
  );
  // Photos, carrousels (1re image) et couvertures de vidéos
  const latest = media
    .map((m) => ({ ...m, image: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url }))
    .filter((m): m is typeof m & { image: string } => !!m.image)
    .slice(0, KEEP);

  const existing = await directus<{ id: number; external_id: string; image: string | null }[]>(
    "GET",
    "/items/instagram_posts?fields=id,external_id,image&limit=-1",
  );
  const byExternalId = new Map(existing.map((p) => [p.external_id, p]));
  const folder = await folderId();
  const now = new Date().toISOString();
  let added = 0;

  for (const m of latest) {
    const fields = { caption: m.caption?.trim() || null, permalink: m.permalink, posted_at: m.timestamp, synced_at: now };
    const known = byExternalId.get(m.id);
    if (known?.image) {
      await directus("PATCH", `/items/instagram_posts/${known.id}`, fields);
      continue;
    }
    // Nouvelle publication : l'image est copiée dans la médiathèque (les liens Instagram expirent)
    const day = new Date(m.timestamp).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    const file = await directus<{ id: string }>("POST", "/files/import", {
      url: m.image,
      data: { title: `Instagram du ${day}`, folder, filename_download: `instagram-${m.id}.jpg` },
    });
    if (known) await directus("PATCH", `/items/instagram_posts/${known.id}`, { ...fields, image: file.id });
    else await directus("POST", "/items/instagram_posts", { ...fields, external_id: m.id, image: file.id, visible: true });
    added++;
  }

  // Roulement : publications sorties des KEEP plus récentes (ou supprimées sur Instagram) → retirées avec leur image
  const keep = new Set(latest.map((m) => m.id));
  const stale = existing.filter((p) => !keep.has(p.external_id));
  if (stale.length) {
    await directus("DELETE", "/items/instagram_posts", stale.map((p) => p.id));
    const files = stale.map((p) => p.image).filter((id): id is string => !!id);
    if (files.length) await directus("DELETE", "/files", files);
  }

  // Lien « Suivre sur Instagram » : renseigné automatiquement s'il est vide
  const settings = await directus<{ instagram_url: string | null } | null>("GET", "/items/settings?fields=instagram_url");
  if (!settings?.instagram_url) await directus("PATCH", "/items/settings", { instagram_url: `https://www.instagram.com/${me.username}/` });

  console.log(`✓ Instagram @${me.username} : ${added} photo(s) ajoutée(s), ${stale.length} retirée(s), ${latest.length} en place`);
}

main().catch((err) => {
  console.error("✗ synchro Instagram :", err instanceof Error ? err.message : err);
  process.exit(1);
});
