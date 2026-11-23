// Instagram : synchro hebdomadaire des photos du compte du lodge (compte professionnel). Deux sources possibles :
// - flux JSON Behold (behold.so, recommandé : aucune app Meta à créer, l'adresse du flux est collée dans le module) ;
// - API Instagram avec connexion OAuth (si une app Meta est configurée : INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET).
// Les images sont copiées dans la médiathèque (les liens Instagram expirent) ; roulement sur les KEEP plus récentes,
// les plus anciennes sont retirées avec leur image. Jeton longue durée (60 jours) renouvelé à chaque passage.
import { type Ctx, env, callbackUrl, readAuth, writeAuth, recordSync, items, files, json, errorMessage } from "./shared";

export interface InstagramAuth {
  feed_url: string | null; // flux Behold « https://feeds.behold.so/… »
  token: string | null;
  expires_at: string | null;
  username: string | null;
  last_sync_at: string | null;
  last_sync_ok: boolean | null;
  last_sync_message: string | null;
}

const GRAPH = "https://graph.instagram.com";
const KEEP = 12; // publications conservées (le site en affiche 5)
const FOLDER = "Instagram";

export const instagramConfigured = () => !!(env("INSTAGRAM_APP_ID") && env("INSTAGRAM_APP_SECRET"));

export function instagramAuthorizeUrl(state: string) {
  return (
    "https://www.instagram.com/oauth/authorize?" +
    new URLSearchParams({
      client_id: env("INSTAGRAM_APP_ID"),
      redirect_uri: callbackUrl("instagram"),
      response_type: "code",
      scope: "instagram_business_basic",
      enable_fb_login: "0",
      state,
    })
  );
}

async function graph<T>(path: string, token: string) {
  const url = `${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  return json<T>(await fetch(url, { signal: AbortSignal.timeout(30_000) }), `Instagram ${path.split("?")[0]}`);
}

const expiresAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

/** Retour d'Instagram après connexion : échange du code contre un jeton longue durée, puis première synchro. */
export async function instagramCallback(ctx: Ctx, code: string) {
  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env("INSTAGRAM_APP_ID"),
      client_secret: env("INSTAGRAM_APP_SECRET"),
      grant_type: "authorization_code",
      redirect_uri: callbackUrl("instagram"),
      code,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await json<{ access_token?: string; data?: { access_token: string }[] }>(res, "Instagram OAuth");
  const short = body.access_token ?? body.data?.[0]?.access_token;
  if (!short) throw new Error("Instagram n'a pas fourni de jeton");

  const long = await graph<{ access_token: string; expires_in: number }>(
    `/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(env("INSTAGRAM_APP_SECRET"))}`,
    short,
  );
  const me = await graph<{ username: string }>("/me?fields=username", long.access_token);
  await writeAuth(ctx, "instagram", { token: long.access_token, expires_at: expiresAt(long.expires_in), username: me.username });
  await syncInstagram(ctx);
}

export async function instagramDisconnect(ctx: Ctx) {
  await writeAuth(ctx, "instagram", { feed_url: null, token: null, expires_at: null, username: null });
}

// ---------- Flux Behold ----------

const BEHOLD = /^https:\/\/feeds\.behold\.so\/[A-Za-z0-9_-]+\/?$/;

interface BeholdFeed {
  username?: string;
  posts?: {
    id: string;
    timestamp: string;
    permalink: string;
    mediaType: Media["media_type"];
    caption?: string;
    sizes?: Partial<Record<"small" | "medium" | "large" | "full", { mediaUrl: string }>>;
  }[];
}

async function fetchBehold(url: string) {
  const feed = await json<BeholdFeed>(await fetch(url, { signal: AbortSignal.timeout(30_000) }), "Flux Behold");
  // Images hébergées par Behold (webp, la version « large » fait 1000 px de large ; vignette pour les vidéos)
  const media = (feed.posts ?? []).map((p) => ({
    id: p.id,
    caption: p.caption,
    media_type: p.mediaType,
    permalink: p.permalink,
    timestamp: p.timestamp,
    image: p.sizes?.large?.mediaUrl ?? p.sizes?.full?.mediaUrl ?? p.sizes?.medium?.mediaUrl,
  }));
  return { username: feed.username ?? null, media };
}

/** Enregistre l'adresse du flux Behold (collée par la propriétaire) et lance une première synchro. */
export async function instagramSetFeed(ctx: Ctx, url: string) {
  const clean = url.trim();
  if (!BEHOLD.test(clean)) throw new Error("Adresse attendue : https://feeds.behold.so/… (Behold › votre flux › JSON)");
  const { username } = await fetchBehold(clean);
  await writeAuth(ctx, "instagram", { feed_url: clean, username, token: null, expires_at: null });
  await syncInstagram(ctx);
}

/** Renouvelle le jeton (+60 jours). Instagram refuse pour un jeton de moins de 24 h : on garde alors l'actuel. */
async function freshToken(ctx: Ctx, token: string) {
  try {
    const fresh = await graph<{ access_token: string; expires_in: number }>("/refresh_access_token?grant_type=ig_refresh_token", token);
    await writeAuth(ctx, "instagram", { token: fresh.access_token, expires_at: expiresAt(fresh.expires_in) });
    return fresh.access_token;
  } catch (err) {
    await graph("/me?fields=id", token).catch(() => {
      throw new Error(`Accès Instagram expiré ou révoqué : cliquez sur « Reconnecter » (${errorMessage(err)})`);
    });
    return token;
  }
}

interface Media {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
}

/** Dernières publications, depuis le flux Behold ou l'API Instagram. */
async function fetchMedia(ctx: Ctx, auth: Partial<InstagramAuth>) {
  if (auth.feed_url) return fetchBehold(auth.feed_url);
  const token = await freshToken(ctx, auth.token!);
  const me = await graph<{ username: string }>("/me?fields=username", token);
  const { data = [] } = await graph<{ data?: Media[] }>(
    `/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=${KEEP + 8}`,
    token,
  );
  // Photos, carrousels (1re image) et couvertures de vidéos
  return { username: me.username, media: data.map((m) => ({ ...m, image: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url })) };
}

export async function syncInstagram(ctx: Ctx) {
  const auth = await readAuth<InstagramAuth>(ctx, "instagram");
  if (!auth.feed_url && !(instagramConfigured() && auth.token)) return; // pas (encore) connecté : rien à faire
  try {
    const { username, media } = await fetchMedia(ctx, auth);
    const latest = media.filter((m): m is typeof m & { image: string } => !!m.image).slice(0, KEEP);

    const posts = await items(ctx, "instagram_posts");
    const fileService = await files(ctx);
    const existing: { id: number; external_id: string; image: string | null }[] = await posts.readByQuery({ fields: ["id", "external_id", "image"], limit: -1 });
    const byExternalId = new Map(existing.map((p) => [p.external_id, p]));
    const [folder] = await (await items(ctx, "directus_folders")).readByQuery({ filter: { name: { _eq: FOLDER } }, fields: ["id"], limit: 1 });
    const now = new Date().toISOString();
    let added = 0;

    for (const m of latest) {
      const fields = { caption: m.caption?.trim() || null, permalink: m.permalink, posted_at: m.timestamp, synced_at: now };
      const known = byExternalId.get(m.id);
      if (known?.image) {
        await posts.updateOne(known.id, fields);
        continue;
      }
      const day = new Date(m.timestamp).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
      const image = await fileService.importOne(m.image, { title: `Instagram du ${day}`, folder: folder?.id ?? null });
      if (known) await posts.updateOne(known.id, { ...fields, image });
      else await posts.createOne({ ...fields, external_id: m.id, image, visible: true });
      added++;
    }

    // Roulement : publications sorties des KEEP plus récentes (ou supprimées sur Instagram) → retirées avec leur image
    const keep = new Set(latest.map((m) => m.id));
    const stale = existing.filter((p) => !keep.has(p.external_id));
    if (stale.length) {
      await posts.deleteMany(stale.map((p) => p.id));
      const ids = stale.map((p) => p.image).filter((id): id is string => !!id);
      if (ids.length) await fileService.deleteMany(ids);
    }

    // Lien « Suivre sur Instagram » : renseigné automatiquement s'il est vide
    const settings = await items(ctx, "settings");
    const current = (await settings.readSingleton({ fields: ["instagram_url"] })) as { instagram_url?: string | null } | null;
    if (username && !current?.instagram_url) await settings.upsertSingleton({ instagram_url: `https://www.instagram.com/${username}/` });
    if (username && username !== auth.username) await writeAuth(ctx, "instagram", { username });

    await recordSync(ctx, "instagram", true, `${added} photo(s) ajoutée(s), ${stale.length} retirée(s), ${latest.length} en place`);
  } catch (err) {
    await recordSync(ctx, "instagram", false, errorMessage(err));
  }
}
