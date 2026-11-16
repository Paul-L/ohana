import { createDirectus, rest, staticToken, readItems, readSingleton } from "@directus/sdk";
import { DIRECTUS_URL, DIRECTUS_PUBLIC_URL, DIRECTUS_WEB_TOKEN } from "astro:env/server";

// ---------- Types (miroir du schéma créé par scripts/bootstrap-directus.ts) ----------
export type Status = "draft" | "published" | "archived";

export interface Settings {
  id: number;
  site_name: string;
  tagline: string | null;
  seo_description: string | null;
  contact_email: string | null;
  notification_email: string | null;
  phone: string | null;
  address: string | null;
  hero_image: string | null;
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
  cover: string | null;
  gallery: RoomFile[];
}

export interface RoomFile {
  id: number;
  rooms_id: number;
  directus_files_id: string;
}

export interface BookingRequest {
  id: number;
  status: "new" | "answered" | "confirmed" | "declined";
  date_created: string;
  name: string;
  email: string;
  phone: string | null;
  room: number | Room | null;
  arrival: string;
  departure: string;
  guests: number;
  message: string | null;
}

interface Schema {
  settings: Settings;
  pages: Page[];
  rooms: Room[];
  rooms_files: RoomFile[];
  booking_requests: BookingRequest[];
}

// Client serveur uniquement (le token ne part jamais au navigateur)
export const directus = createDirectus<Schema>(DIRECTUS_URL)
  .with(staticToken(DIRECTUS_WEB_TOKEN))
  .with(rest());

export { readItems, readSingleton };

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
  return `${DIRECTUS_PUBLIC_URL}/assets/${id}?${params}`;
}

/** Filtre "publié" commun à toutes les requêtes du site. */
export const published = { status: { _eq: "published" } } as const;
