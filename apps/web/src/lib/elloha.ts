// Client API Elloha — SERVEUR UNIQUEMENT (l'identifiant client et l'IP déclarée ne concernent que le serveur).
// Doc : https://doc.elloha.com/api/v1/fr/ — POST /Availabilities (disponibilités détaillées d'un produit).
// Le panier (AddToCartUrl) et le paiement (PaymentUrl) se font ensuite côté navigateur, chez Elloha.
import { ELLOHA_API_URL, ELLOHA_CLIENT_ID, ELLOHA_BOOKING_ENGINE_ID, ELLOHA_PRODUCT_ID } from "astro:env/server";

/** L'intégration est active dès que l'identifiant client et celui du moteur sont renseignés (le produit se retrouve seul) */
export const ellohaEnabled = Boolean(ELLOHA_CLIENT_ID && ELLOHA_BOOKING_ENGINE_ID);

const headers = () => ({
  accept: "application/json",
  "content-type": "application/json",
  culture: "fr-FR",
  "elloha-client-id": ELLOHA_CLIENT_ID!,
});

interface RawProduct {
  IdProduct?: string;
  Name?: string;
  Type?: string;
}

let discovered: Promise<string> | null = null;

/**
 * Identifiant du lodge (IdProduct) : celui du .env s'il est renseigné, sinon retrouvé une fois pour toutes
 * par une recherche globale sur le moteur de réservation (le moteur du lodge ne contient normalement que lui).
 */
export function productId(): Promise<string> {
  if (ELLOHA_PRODUCT_ID) return Promise.resolve(ELLOHA_PRODUCT_ID);
  discovered ??= (async () => {
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const res = await fetch(`${ELLOHA_API_URL}/Availabilities`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ IdBookingEngine: ELLOHA_BOOKING_ENGINE_ID, StartDate: day(30), EndDate: day(31), AdultNumber: 2 }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json().catch(() => null)) as RawProduct[] | { Products?: RawProduct[]; ErrorCode?: string } | null;
    const list = Array.isArray(json) ? json : (json?.Products ?? []);
    const products = list.filter((p) => p.IdProduct);
    const lodge = products.length === 1 ? products[0] : products.find((p) => p.Type === "BedAndBreakfast" || /ohana/i.test(p.Name ?? ""));
    if (!res.ok || !lodge) {
      throw new EllohaError(`Produit introuvable sur le moteur (${res.status}, ${products.length} produit(s)) : renseigner ELLOHA_PRODUCT_ID`);
    }
    return String(lodge.IdProduct);
  })().catch((err) => {
    discovered = null; // nouvel essai au prochain appel
    throw err;
  });
  return discovered;
}

// ---------- Réponse Elloha (champs utilisés uniquement ; noms d'origine en PascalCase)
interface RawRate {
  IdRate?: string;
  Name?: string;
  Price?: number;
  PriceWithoutPromotion?: number;
  PriceInclude?: string;
  PriceExclude?: string;
  StockLeft?: number;
  IsCancellableForFree?: boolean;
  IsCancellable?: boolean;
  IsPromotion?: boolean;
  AddToCartUrl?: string;
}
interface RawOffer {
  IdOffer?: string;
  Name?: string;
  Capacity?: number;
  Rates?: RawRate[];
}
interface RawAvailability {
  IdProduct?: string;
  BookingUrl?: string;
  Offers?: RawOffer[];
  ErrorCode?: string;
  ErrorDescription?: string;
}

// ---------- Forme normalisée, utilisée par le site
export interface EllohaRate {
  id: string;
  name: string;
  /** Prix total du séjour pour cette occupation (devise du moteur, en €) */
  price: number;
  priceBeforePromotion: number | null;
  included: string | null;
  excluded: string | null;
  stockLeft: number;
  freeCancellation: boolean;
  addToCartUrl: string;
}
export interface EllohaOffer {
  id: string;
  name: string;
  capacity: number | null;
  /** Tarif le moins cher encore en stock (null = complet) */
  best: EllohaRate | null;
}
export interface EllohaAvailability {
  offers: EllohaOffer[];
  /** Page du produit dans le moteur Elloha, dates et occupation préremplies (secours) */
  bookingUrl: string | null;
}

export class EllohaError extends Error {}

function normalize(raw: RawAvailability): EllohaAvailability {
  const offers = (raw.Offers ?? []).map((o): EllohaOffer => {
    const rates = (o.Rates ?? [])
      .filter((r) => r.AddToCartUrl && typeof r.Price === "number" && (r.StockLeft ?? 1) > 0)
      .map(
        (r): EllohaRate => ({
          id: String(r.IdRate ?? ""),
          name: r.Name ?? "",
          price: r.Price!,
          priceBeforePromotion: r.IsPromotion && r.PriceWithoutPromotion ? r.PriceWithoutPromotion : null,
          included: r.PriceInclude || null,
          excluded: r.PriceExclude || null,
          stockLeft: r.StockLeft ?? 1,
          freeCancellation: Boolean(r.IsCancellableForFree),
          addToCartUrl: r.AddToCartUrl!,
        }),
      )
      .sort((a, b) => a.price - b.price);
    return { id: String(o.IdOffer ?? ""), name: o.Name ?? "", capacity: o.Capacity ?? null, best: rates[0] ?? null };
  });
  return { offers, bookingUrl: raw.BookingUrl ?? null };
}

// Petit cache mémoire : évite d'interroger Elloha à chaque frappe (quotas par projet)
const cache = new Map<string, { at: number; value: EllohaAvailability }>();
const TTL = 60_000;

/** Disponibilités et prix de chaque chambre pour un séjour et un nombre d'adultes par chambre. */
export async function availability(opts: { arrival: string; departure: string; adults: number }): Promise<EllohaAvailability> {
  if (!ellohaEnabled) throw new EllohaError("Elloha non configuré");
  const key = `${opts.arrival}|${opts.departure}|${opts.adults}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  let res: Response;
  try {
    const IdProduct = await productId();
    res = await fetch(`${ELLOHA_API_URL}/Availabilities`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        IdBookingEngine: ELLOHA_BOOKING_ENGINE_ID,
        IdProduct,
        StartDate: opts.arrival,
        EndDate: opts.departure,
        AdultNumber: opts.adults,
        ChildNumber: 0,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    if (err instanceof EllohaError) throw err;
    throw new EllohaError(`Elloha injoignable : ${(err as Error).message}`);
  }
  const json = (await res.json().catch(() => ({}))) as RawAvailability;
  if (!res.ok || json.ErrorCode) {
    // InvalidProduct = produit fermé à la vente ; 401/403 = IP non déclarée ou identifiant client invalide
    throw new EllohaError(`Elloha ${res.status} ${json.ErrorCode ?? ""} ${json.ErrorDescription ?? ""}`.trim());
  }
  const value = normalize(json);
  cache.set(key, { at: Date.now(), value });
  return value;
}
