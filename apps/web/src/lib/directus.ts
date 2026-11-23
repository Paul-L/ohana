import { createDirectus, rest, staticToken, readItems, readSingleton, readFiles } from "@directus/sdk";
import { DIRECTUS_URL, DIRECTUS_PUBLIC_URL, DIRECTUS_ASSETS_URL, DIRECTUS_WEB_TOKEN } from "astro:env/server";

// ---------- Types (miroir du schéma créé par scripts/bootstrap-directus.ts) ----------
export type Status = "draft" | "published" | "archived";

export interface Settings {
  id: number;
  site_name: string;
  tagline: string | null;
  seo_description: string | null;
  contact_email: string | null;
  phone: string | null;
  address: string | null;
  hero_image: string | null;
  checkin_from: string | null; // "17:00:00"
  checkin_to: string | null;
  checkout_until: string | null;
  tourist_tax: number | null;
  deposit_percent: number | null;
  instagram_url: string | null;
  latitude: number | null;
  longitude: number | null;
}

export type FactIcon = "bed" | "arrival" | "departure" | "breakfast" | "beach" | "pool" | "wifi" | "parking";
export type RatingSource = "google" | "booking" | "tripadvisor";

export interface Home {
  id: number;
  hero_eyebrow: string | null;
  key_facts: { icon: FactIcon; label: string; value: string }[] | null;
  ratings: { source: RatingSource; score: string; scale: number; count: number | null; label: string | null; url: string | null }[] | null;
  review_quote: string | null;
  review_attribution: string | null;
  review_highlights: { label: string; score: string }[] | null;
  review_highlights_note: string | null;
  ratings_checked_on: string | null; // "AAAA-MM-JJ" : relevé manuel Booking / Tripadvisor
  ratings_synced_at: string | null; // dernière synchro automatique de la note Google
  booking_image: string | null;
  lodge_images: HomeFile[];
  gallery: HomeFile[];
  rooms_eyebrow: string | null;
  rooms_title: string | null;
  rooms_intro: string | null;
  rates_eyebrow: string | null;
  rates_title: string | null;
  rates_intro: string | null;
  rates_notes: { text: string }[] | null;
  booking_eyebrow: string | null;
  booking_title: string | null;
  booking_steps: { title: string; text: string }[] | null;
  cancellation_title: string | null;
  cancellation_tiers: { value: string; label: string }[] | null;
  cancellation_note: string | null;
  good_to_know_title: string | null;
  good_to_know: { icon: InfoIcon; text: string }[] | null;
  lodge_eyebrow: string | null;
  gallery_eyebrow: string | null;
  gallery_title: string | null;
  reviews_eyebrow: string | null;
  faq_eyebrow: string | null;
  faq_title: string | null;
  faq_intro: string | null;
  access_eyebrow: string | null;
}

export type InfoIcon = FactIcon | "age" | "no" | "group" | "card";

export interface HomeFile {
  id: number;
  home_id: number;
  directus_files_id: string;
  sort: number | null;
}

export interface Season {
  id: number;
  status: Status;
  sort: number | null;
  name: string;
  highlight: boolean;
  periods: { from: string; to: string }[] | null; // "MM-DD"
  periods_note: string | null;
  price_double: number | null;
  price_single: number | null;
  min_nights: number | null;
  min_nights_weekend: number | null;
  long_stay_nights: number | null;
  long_stay_discount: number | null;
}

export interface Faq {
  id: number;
  status: Status;
  sort: number | null;
  question: string;
  answer: string | null;
}

export interface Page {
  id: number;
  status: Status;
  slug: string;
  title: string;
  seo_description: string | null;
  intro: string | null;
  content: string | null;
  cover: string | null;
}

export interface Room {
  id: number;
  status: Status;
  sort: number | null;
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  capacity: number | null;
  price_from: number | null;
  bed: string | null;
  features: string | null;
  cover: string | null;
  gallery: RoomFile[];
}

export interface RoomFile {
  id: number;
  rooms_id: number;
  directus_files_id: string;
}

/** Avis Google synchronisés chaque nuit (extension ohana-connexions). Ne jamais modifier le texte (règles Google). */
export interface Review {
  id: number;
  visible: boolean;
  source: "google";
  external_id: string;
  rating: number; // 1 à 5
  author: string | null;
  published_at: "datetime" | null; // "datetime" : type date du SDK Directus (permet les filtres _gte…)
  text: string | null;
  synced_at: "datetime";
}

/** Photos Instagram importées chaque semaine (extension ohana-connexions) : remplacent la galerie de l'accueil. */
export interface InstagramPost {
  id: number;
  visible: boolean;
  image: string | null;
  caption: string | null;
  permalink: string;
  external_id: string;
  posted_at: "datetime";
  synced_at: "datetime";
}

interface Schema {
  settings: Settings;
  pages: Page[];
  rooms: Room[];
  rooms_files: RoomFile[];
  home: Home;
  home_lodge_images: HomeFile[];
  home_gallery: HomeFile[];
  seasons: Season[];
  faq: Faq[];
  reviews: Review[];
  instagram_posts: InstagramPost[];
}

// Client serveur uniquement (le token ne part jamais au navigateur)
export const directus = createDirectus<Schema>(DIRECTUS_URL)
  .with(staticToken(DIRECTUS_WEB_TOKEN))
  .with(rest());

export { readItems, readSingleton };

/**
 * Textes alternatifs des images : description (sinon titre) saisie dans la médiathèque Directus.
 * Une seule requête pour toutes les images de la page.
 */
export async function fileAlts(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const files = await directus
    .request(readFiles({ filter: { id: { _in: unique } }, fields: ["id", "title", "description"] }))
    .catch(() => []);
  return new Map(files.map((f) => [f.id as string, ((f.description || f.title) ?? "") as string]));
}

/** URL publique d'un fichier Directus, avec transformations optionnelles. */
export function assetUrl(
  id: string | null | undefined,
  opts: { width?: number; height?: number; quality?: number; format?: "webp" | "avif" | "auto" } = {},
) {
  if (!id) return undefined;
  const params = new URLSearchParams();
  if (opts.width) params.set("width", String(opts.width));
  if (opts.height) params.set("height", String(opts.height));
  params.set("quality", String(opts.quality ?? 75));
  params.set("format", opts.format ?? "auto");
  return `${DIRECTUS_ASSETS_URL || DIRECTUS_PUBLIC_URL}/assets/${id}?${params}`;
}

/** srcset prêt à l'emploi pour une image Directus. */
export function srcset(id: string | null | undefined, widths: number[]) {
  if (!id) return undefined;
  return widths.map((w) => `${assetUrl(id, { width: w })} ${w}w`).join(", ");
}

/** Filtre "publié" commun à toutes les requêtes du site. */
export const published = { status: { _eq: "published" } } as const;
