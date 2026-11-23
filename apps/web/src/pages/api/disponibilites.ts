// Disponibilités en direct pour la page /reserver : GET /api/disponibilites?arrivee=AAAA-MM-JJ&depart=AAAA-MM-JJ&voyageurs=N
// Interroge Elloha côté serveur et renvoie, pour chaque chambre du site, son statut et son prix pour ces dates.
// En cas de souci (Elloha non configuré, injoignable…), répond { mode: "request" } : la page garde le formulaire de demande.
import type { APIRoute } from "astro";
import { directus, readItems, published } from "@/lib/directus";
import { availability, ellohaEnabled, EllohaError, type EllohaRate } from "@/lib/elloha";

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const isoDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Ce que le navigateur reçoit pour un tarif (jamais d'identifiant Elloha secret, seulement l'URL d'ajout au panier) */
const publicRate = (r: EllohaRate | null | undefined) =>
  r && {
    price: r.price,
    priceBeforePromotion: r.priceBeforePromotion,
    freeCancellation: r.freeCancellation,
    excluded: r.excluded,
    addToCartUrl: r.addToCartUrl,
  };

export const GET: APIRoute = async ({ url }) => {
  if (!ellohaEnabled) return json({ mode: "request" });

  const arrival = isoDate(url.searchParams.get("arrivee"));
  const departure = isoDate(url.searchParams.get("depart"));
  const guests = Math.min(8, Math.max(1, Number(url.searchParams.get("voyageurs")) || 2));
  if (!arrival || !departure || departure <= arrival) return json({ mode: "online", error: "dates" }, 400);

  // 2 personnes max par chambre : on demande les prix « 2 adultes », et « 1 adulte » si une chambre sera occupée seule
  const roomsNeeded = Math.ceil(guests / 2);
  const occupancies = [...new Set([guests === 1 ? 1 : 2, ...(guests > 1 && guests % 2 === 1 ? [1] : [])])];

  try {
    const [rooms, ...results] = await Promise.all([
      directus.request(readItems("rooms", { filter: published, sort: ["sort", "name"], fields: ["id", "elloha_offer_id"] })),
      ...occupancies.map((adults) => availability({ arrival, departure, adults })),
    ]);
    const byOccupancy = new Map(occupancies.map((adults, i) => [adults, results[i]]));

    const payload = rooms.map((room) => {
      if (!room.elloha_offer_id) return { id: room.id, status: "unlinked" as const };
      const rates = Object.fromEntries(
        occupancies.map((adults) => [adults, publicRate(byOccupancy.get(adults)!.offers.find((o) => o.id === room.elloha_offer_id)?.best)]),
      );
      // Disponible si la chambre a un tarif en stock pour l'occupation principale
      const available = Boolean(rates[occupancies[0]]);
      return { id: room.id, status: available ? ("available" as const) : ("full" as const), rates };
    });

    return json({
      mode: "online",
      nights: Math.round((Date.parse(departure) - Date.parse(arrival)) / 86_400_000),
      roomsNeeded,
      rooms: payload,
      bookingUrl: results[0]?.bookingUrl ?? null,
    });
  } catch (err) {
    console.error("[elloha]", err instanceof EllohaError ? err.message : err);
    return json({ mode: "request", reason: "unavailable" });
  }
};
