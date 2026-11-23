// Synchronise les avis Google de l'établissement dans Directus (collection `reviews` + note Google de l'accueil).
// Lancé chaque nuit : tâche planifiée Coolify sur le conteneur web → `node scripts/sync-reviews.ts`
// En local : `pnpm reviews:sync`
//
// Source : Google Business Profile API (accès propriétaire à la fiche, autorisation via `pnpm google:auth`).
// Règles Google (developers.google.com/my-business/content/policies) : stockage limité, 30 jours maximum,
// contenu non modifié. D'où : seuls les 50 avis les plus récents sont gardés, chaque avis est rafraîchi
// à chaque passage, les autres sont supprimés ; le site ignore tout avis non resynchronisé depuis 30 jours.
//
// Variables : DIRECTUS_URL, DIRECTUS_SYNC_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
//             GOOGLE_REFRESH_TOKEN, GOOGLE_LOCATION (« accounts/…/locations/… »)

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Variable manquante : ${name}`);
  return v;
};

const DIRECTUS_URL = env("DIRECTUS_URL").replace(/\/$/, "");
const DIRECTUS_TOKEN = env("DIRECTUS_SYNC_TOKEN");
const MAX_REVIEWS = 50; // une page de l'API Google

type StarRating = "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "STAR_RATING_UNSPECIFIED";
interface GoogleReview {
  reviewId: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating: StarRating;
  comment?: string;
  createTime: string;
  updateTime: string;
}
interface GoogleReviews {
  reviews?: GoogleReview[];
  averageRating?: number;
  totalReviewCount?: number;
}
interface Rating {
  source: string;
  score: string;
  scale: number;
  count: number | null;
  label: string | null;
  url: string | null;
}

const STARS: Record<StarRating, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, STAR_RATING_UNSPECIFIED: 0 };

async function directus<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${DIRECTUS_TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (!res.ok) throw new Error(`Directus ${method} ${path} → ${res.status} ${json.errors?.map((e) => e.message).join(", ") ?? ""}`);
  return json.data as T;
}

async function googleAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: env("GOOGLE_REFRESH_TOKEN"),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!json.access_token) {
    throw new Error(`Google OAuth : ${json.error} ${json.error_description ?? ""} (relancer « pnpm google:auth » si l'autorisation a été révoquée)`);
  }
  return json.access_token;
}

async function fetchGoogleReviews(): Promise<GoogleReviews> {
  const token = await googleAccessToken();
  const location = env("GOOGLE_LOCATION").replace(/^\/|\/$/g, "");
  const url = `https://mybusiness.googleapis.com/v4/${location}/reviews?pageSize=${MAX_REVIEWS}&orderBy=${encodeURIComponent("updateTime desc")}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const json = (await res.json()) as GoogleReviews & { error?: { message: string; status: string } };
  if (!res.ok) throw new Error(`Google reviews.list → ${res.status} ${json.error?.status ?? ""} ${json.error?.message ?? ""}`);
  return json;
}

/**
 * Avis traduits automatiquement par Google : « (Translated by Google) … (Original) … ».
 * On garde le texte d'origine tel quel, sans autre retouche.
 */
function originalText(comment: string | undefined) {
  if (!comment) return null;
  const original = comment.match(/\n\((?:Original|Avis d'origine|Texte d'origine)\)\n([\s\S]+)$/);
  return (original ? original[1] : comment).trim() || null;
}

const decimal = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

async function main() {
  const started = new Date();
  const google = await fetchGoogleReviews();
  const fetched = google.reviews ?? [];

  // 1. Avis : création / mise à jour (sans toucher à « visible », choisi par la propriétaire)
  const existing = await directus<{ id: number; external_id: string }[]>(
    "GET",
    "/items/reviews?filter[source][_eq]=google&fields=id,external_id&limit=-1",
  );
  const byExternalId = new Map(existing.map((r) => [r.external_id, r.id]));
  const now = started.toISOString();
  const toCreate: Record<string, unknown>[] = [];
  const toUpdate: Record<string, unknown>[] = [];
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
    if (id) toUpdate.push({ id, ...item });
    else toCreate.push({ ...item, visible: true });
  }
  if (toCreate.length) await directus("POST", "/items/reviews", toCreate);
  if (toUpdate.length) await directus("PATCH", "/items/reviews", toUpdate);

  // 2. Purge : avis supprimés sur Google ou sortis des 50 plus récents (non revus lors de ce passage)
  const stale = await directus<{ id: number }[]>(
    "GET",
    `/items/reviews?filter[source][_eq]=google&filter[synced_at][_lt]=${encodeURIComponent(now)}&fields=id&limit=-1`,
  );
  const toDelete = stale.map((r) => r.id);
  if (toDelete.length) await directus("DELETE", "/items/reviews", toDelete);

  // 3. Note Google de l'accueil (les autres plateformes restent saisies à la main)
  if (google.averageRating) {
    const home = await directus<{ ratings: Rating[] | null }>("GET", "/items/home?fields=ratings");
    const ratings = [...(home.ratings ?? [])];
    const entry = { score: decimal(google.averageRating), scale: 5, count: google.totalReviewCount ?? null };
    const i = ratings.findIndex((r) => r.source === "google");
    if (i >= 0) ratings[i] = { ...ratings[i], ...entry };
    else ratings.unshift({ source: "google", label: null, url: null, ...entry });
    await directus("PATCH", "/items/home", { ratings, ratings_synced_at: now });
  }

  console.log(
    `✓ avis Google : ${toCreate.length} ajouté(s), ${toUpdate.length} mis à jour, ${toDelete.length} retiré(s)` +
      (google.averageRating ? ` · note ${decimal(google.averageRating)}/5 (${google.totalReviewCount ?? "?"} avis)` : ""),
  );
}

main().catch((err) => {
  console.error("✗ synchro des avis :", err instanceof Error ? err.message : err);
  process.exit(1);
});
