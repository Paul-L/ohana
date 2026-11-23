// Google Business Profile : connexion OAuth de la propriétaire + synchro nocturne des avis.
// Règles Google (developers.google.com/my-business/content/policies) : stockage limité, 30 jours maximum,
// contenu non modifié → seuls les 50 avis les plus récents sont gardés et rafraîchis à chaque passage,
// les autres sont supprimés ; le site ignore tout avis non resynchronisé depuis 30 jours.
import { type Ctx, env, callbackUrl, readAuth, writeAuth, recordSync, items, json, errorMessage } from "./shared";

export interface GoogleAuth {
  refresh_token: string | null;
  email: string | null;
  location: string | null; // « accounts/…/locations/… »
  location_title: string | null;
  locations: { name: string; title: string }[] | null;
  last_sync_at: string | null;
  last_sync_ok: boolean | null;
  last_sync_message: string | null;
}

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/business.manage"];
const MAX_REVIEWS = 50;

export const googleConfigured = () => !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));

export function googleAuthorizeUrl(state: string) {
  return (
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      redirect_uri: callbackUrl("google"),
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent", // garantit l'envoi d'un refresh token
      include_granted_scopes: "true",
      state,
    })
  );
}

async function token(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), ...params }),
    signal: AbortSignal.timeout(20_000),
  });
  return json<{ access_token: string; refresh_token?: string; id_token?: string }>(res, "Google OAuth");
}

async function get<T>(url: string, accessToken: string) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
  return json<T>(res, `Google ${new URL(url).hostname.split(".")[0]}`);
}

/** Fiches gérées par le compte connecté. */
async function listLocations(accessToken: string) {
  const { accounts = [] } = await get<{ accounts?: { name: string }[] }>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", accessToken);
  const out: { name: string; title: string }[] = [];
  for (const account of accounts) {
    const { locations = [] } = await get<{ locations?: { name: string; title?: string }[] }>(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title&pageSize=100`,
      accessToken,
    );
    // v1 renvoie « locations/123 » ; l'API des avis (v4) attend « accounts/456/locations/123 »
    for (const l of locations) out.push({ name: `${account.name}/${l.name}`, title: l.title ?? l.name });
  }
  return out;
}

/** Retour de Google après connexion : enregistre l'accès, choisit la fiche, lance une première synchro. */
export async function googleCallback(ctx: Ctx, code: string) {
  const tokens = await token({ code, redirect_uri: callbackUrl("google"), grant_type: "authorization_code" });
  if (!tokens.refresh_token) throw new Error("Google n'a pas fourni d'accès permanent : relancez la connexion");
  const email = tokens.id_token ? (JSON.parse(Buffer.from(tokens.id_token.split(".")[1]!, "base64url").toString()).email as string) : null;
  const previous = await readAuth<GoogleAuth>(ctx, "google");
  await writeAuth(ctx, "google", { refresh_token: tokens.refresh_token, email });

  try {
    const locations = await listLocations(tokens.access_token);
    const keep = locations.find((l) => l.name === previous.location) ?? (locations.length === 1 ? locations[0] : undefined);
    await writeAuth(ctx, "google", { locations, location: keep?.name ?? null, location_title: keep?.title ?? null });
    if (!locations.length) await recordSync(ctx, "google", false, "Aucune fiche d'établissement gérée par ce compte Google");
    else if (keep) await syncGoogle(ctx);
  } catch (err) {
    await recordSync(ctx, "google", false, explain(err));
  }
}

export async function googleSelectLocation(ctx: Ctx, name: string) {
  const { locations } = await readAuth<GoogleAuth>(ctx, "google");
  const loc = locations?.find((l) => l.name === name);
  if (!loc) throw new Error("Fiche inconnue");
  await writeAuth(ctx, "google", { location: loc.name, location_title: loc.title });
  await syncGoogle(ctx);
}

export async function googleDisconnect(ctx: Ctx) {
  const { refresh_token } = await readAuth<GoogleAuth>(ctx, "google");
  if (refresh_token) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh_token)}`, { method: "POST" }).catch(() => {});
  await writeAuth(ctx, "google", { refresh_token: null, email: null, location: null, location_title: null, locations: null });
}

/** Message compréhensible pour la propriétaire. */
function explain(err: unknown) {
  const msg = errorMessage(err);
  if (/invalid_grant/.test(msg)) return "Accès Google expiré ou révoqué : cliquez sur « Reconnecter »";
  if (/\b(403|429)\b/.test(msg) && /quota|PERMISSION_DENIED|has not been used|disabled|RATE_LIMIT/i.test(msg))
    return `Google n'a pas encore ouvert l'accès à l'API Business Profile pour ce projet (${msg})`;
  return msg;
}

type StarRating = "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "STAR_RATING_UNSPECIFIED";
const STARS: Record<StarRating, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, STAR_RATING_UNSPECIFIED: 0 };
interface GoogleReview {
  reviewId: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating: StarRating;
  comment?: string;
  createTime: string;
}

/** Avis traduits par Google : « (Translated by Google) … (Original) … » → on garde le texte d'origine tel quel. */
function originalText(comment: string | undefined) {
  if (!comment) return null;
  const original = comment.match(/\n\((?:Original|Avis d'origine|Texte d'origine)\)\n([\s\S]+)$/);
  return (original ? original[1]! : comment).trim() || null;
}

const decimal = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export async function syncGoogle(ctx: Ctx) {
  const auth = await readAuth<GoogleAuth>(ctx, "google");
  if (!googleConfigured() || !auth.refresh_token || !auth.location) return; // pas (encore) connecté : rien à faire
  try {
    const { access_token } = await token({ refresh_token: auth.refresh_token, grant_type: "refresh_token" });
    const google = await get<{ reviews?: GoogleReview[]; averageRating?: number; totalReviewCount?: number }>(
      `https://mybusiness.googleapis.com/v4/${auth.location}/reviews?pageSize=${MAX_REVIEWS}&orderBy=${encodeURIComponent("updateTime desc")}`,
      access_token,
    );
    const fetched = google.reviews ?? [];
    const reviews = await items(ctx, "reviews");

    // 1. Création / mise à jour (sans toucher à « visible », choisi par la propriétaire)
    const existing: { id: number; external_id: string }[] = await reviews.readByQuery({ filter: { source: { _eq: "google" } }, fields: ["id", "external_id"], limit: -1 });
    const byExternalId = new Map(existing.map((r) => [r.external_id, r.id]));
    const now = new Date().toISOString();
    const toCreate: Record<string, unknown>[] = [];
    let updated = 0;
    for (const r of fetched) {
      const item = {
        source: "google",
        external_id: r.reviewId,
        rating: STARS[r.starRating] ?? 0,
        author: r.reviewer?.isAnonymous ? null : (r.reviewer?.displayName ?? null),
        published_at: r.createTime,
        text: originalText(r.comment),
        synced_at: now,
      };
      const id = byExternalId.get(r.reviewId);
      if (id) {
        await reviews.updateOne(id, item);
        updated++;
      } else toCreate.push({ ...item, visible: true });
    }
    if (toCreate.length) await reviews.createMany(toCreate);

    // 2. Purge : avis supprimés sur Google ou sortis des 50 plus récents
    const keep = new Set(fetched.map((r) => r.reviewId));
    const stale = existing.filter((r) => !keep.has(r.external_id)).map((r) => r.id);
    if (stale.length) await reviews.deleteMany(stale);

    // 3. Note Google de l'accueil (les autres plateformes restent saisies à la main)
    if (google.averageRating) {
      const home = await items(ctx, "home");
      const { ratings } = ((await home.readSingleton({ fields: ["ratings"] })) ?? {}) as { ratings?: Record<string, unknown>[] | null };
      const list = [...(ratings ?? [])];
      const entry = { score: decimal(google.averageRating), scale: 5, count: google.totalReviewCount ?? null };
      const i = list.findIndex((r) => r.source === "google");
      if (i >= 0) list[i] = { ...list[i], ...entry };
      else list.unshift({ source: "google", label: null, url: null, ...entry });
      await home.upsertSingleton({ ratings: list, ratings_synced_at: now });
    }

    const note = google.averageRating ? ` · note ${decimal(google.averageRating)}/5 (${google.totalReviewCount ?? "?"} avis)` : "";
    await recordSync(ctx, "google", true, `${toCreate.length} avis ajouté(s), ${updated} mis à jour, ${stale.length} retiré(s)${note}`);
  } catch (err) {
    await recordSync(ctx, "google", false, explain(err));
  }
}
