/**
 * Relie les chambres du site à leurs « offres » Elloha.
 *
 *   pnpm elloha:offres              → vérifie l'accès Elloha, liste les offres et l'état des liaisons
 *   pnpm elloha:offres --appliquer  → renseigne rooms.elloha_offer_id quand le nom correspond exactement
 *
 * Sinon, copier l'identifiant affiché dans Directus > Chambres > « Identifiant Elloha ».
 * Lit le .env de la racine. L'IP de la machine doit être déclarée chez Elloha.
 */
const API = process.env.ELLOHA_API_URL || "https://api.elloha.com";
const { ELLOHA_CLIENT_ID, ELLOHA_BOOKING_ENGINE_ID } = process.env;
let ELLOHA_PRODUCT_ID = process.env.ELLOHA_PRODUCT_ID;
const DIRECTUS = process.env.DIRECTUS_PUBLIC_URL ?? "http://localhost:8055";
const apply = process.argv.includes("--appliquer");

const missing = Object.entries({ ELLOHA_CLIENT_ID, ELLOHA_BOOKING_ENGINE_ID }).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`✗ À renseigner dans le .env : ${missing.join(", ")}`);
  if (missing.includes("ELLOHA_CLIENT_ID")) console.error("  → identifiant délivré par Elloha sur demande à api@elloha.com (avec les IP qui appelleront l'API).");
  process.exit(1);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date();
const ellohaHeaders = { accept: "application/json", "content-type": "application/json", culture: "fr-FR", "elloha-client-id": ELLOHA_CLIENT_ID! };
const explain = (status: number) => {
  if (status === 401 || status === 403) console.error("  → identifiant client invalide, ou IP de cette machine non déclarée chez Elloha.");
};

// Identifiant du lodge : celui du .env, sinon recherche globale sur le moteur de réservation
if (!ELLOHA_PRODUCT_ID) {
  const search = await fetch(`${API}/Availabilities`, {
    method: "POST",
    headers: ellohaHeaders,
    body: JSON.stringify({
      IdBookingEngine: ELLOHA_BOOKING_ENGINE_ID,
      StartDate: iso(new Date(today.getTime() + 30 * 86_400_000)),
      EndDate: iso(new Date(today.getTime() + 31 * 86_400_000)),
      AdultNumber: 2,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    console.error(`✗ Elloha injoignable : ${err.message}`);
    process.exit(1);
  });
  const found = (await search.json().catch(() => null)) as { IdProduct: string; Name: string; Type?: string }[] | { Products?: { IdProduct: string; Name: string; Type?: string }[] } | null;
  const products = Array.isArray(found) ? found : (found?.Products ?? []);
  if (!search.ok || !products.length) {
    console.error(`✗ Aucun produit trouvé sur le moteur ${ELLOHA_BOOKING_ENGINE_ID} (réponse ${search.status}).`);
    explain(search.status);
    process.exit(1);
  }
  console.log("Produits du moteur de réservation :");
  for (const p of products) console.log(`  ${p.IdProduct}  ${p.Name}${p.Type ? ` (${p.Type})` : ""}`);
  const lodge = products.length === 1 ? products[0] : products.find((p) => p.Type === "BedAndBreakfast" || /ohana/i.test(p.Name));
  if (!lodge) {
    console.error("\n✗ Plusieurs produits : copier le bon identifiant dans ELLOHA_PRODUCT_ID (.env).");
    process.exit(1);
  }
  ELLOHA_PRODUCT_ID = lodge.IdProduct;
  console.log(`→ Lodge retrouvé automatiquement : ${lodge.Name} (${lodge.IdProduct})\n`);
}
const res = await fetch(`${API}/Availabilities`, {
  method: "POST",
  headers: ellohaHeaders,
  body: JSON.stringify({
    IdBookingEngine: ELLOHA_BOOKING_ENGINE_ID,
    IdProduct: ELLOHA_PRODUCT_ID,
    StartDate: iso(today),
    EndDate: iso(new Date(today.getTime() + 2 * 86_400_000)),
    AdultNumber: 2,
    SearchFirstAvailableDates: true,
    ReturnCompleteOffers: true,
  }),
  signal: AbortSignal.timeout(10_000),
}).catch((err) => {
  console.error(`✗ Elloha injoignable : ${err.message}`);
  process.exit(1);
});
const body = (await res.json().catch(() => ({}))) as {
  Name?: string;
  Offers?: { IdOffer: string; Name: string; Capacity?: number }[];
  ErrorCode?: string;
  ErrorDescription?: string;
};
if (!res.ok || body.ErrorCode) {
  console.error(`✗ Elloha a répondu ${res.status} ${body.ErrorCode ?? ""} ${body.ErrorDescription ?? ""}`);
  explain(res.status);
  process.exit(1);
}

const offers = body.Offers ?? [];
console.log(`✓ Accès Elloha OK — ${body.Name ?? "produit"} : ${offers.length} offre(s)\n`);
for (const o of offers) console.log(`  ${o.IdOffer}  ${o.Name}${o.Capacity ? ` (${o.Capacity} pers.)` : ""}`);

// Chambres du site (accès admin pour pouvoir écrire la liaison)
const login = await fetch(`${DIRECTUS}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: process.env.DIRECTUS_ADMIN_EMAIL, password: process.env.DIRECTUS_ADMIN_PASSWORD }),
});
if (!login.ok) {
  console.error("\n✗ Connexion Directus impossible (DIRECTUS_ADMIN_EMAIL / DIRECTUS_ADMIN_PASSWORD).");
  process.exit(1);
}
const token = ((await login.json()) as { data: { access_token: string } }).data.access_token;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const rooms = ((await (await fetch(`${DIRECTUS}/items/rooms?fields=id,name,status,elloha_offer_id&sort=sort&limit=-1`, { headers })).json()) as {
  data: { id: number; name: string; status: string; elloha_offer_id: string | null }[];
}).data;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
console.log("\nChambres du site :");
let unlinked = 0;
for (const room of rooms) {
  const linked = offers.find((o) => o.IdOffer === room.elloha_offer_id);
  if (linked) {
    console.log(`  ✓ ${room.name} → ${linked.Name}`);
    continue;
  }
  const match = offers.filter((o) => norm(o.Name) === norm(room.name));
  if (match.length === 1 && apply) {
    await fetch(`${DIRECTUS}/items/rooms/${room.id}`, { method: "PATCH", headers, body: JSON.stringify({ elloha_offer_id: match[0].IdOffer }) });
    console.log(`  + ${room.name} → ${match[0].Name} (relié)`);
    continue;
  }
  unlinked++;
  const why = room.elloha_offer_id ? "identifiant inconnu chez Elloha" : "non reliée";
  console.log(`  ✗ ${room.name} : ${why}${match.length === 1 ? ` — correspond à « ${match[0].Name} » (relancer avec --appliquer)` : ""}`);
}
if (unlinked) console.log("\nUne chambre non reliée reste visible sur le site mais n'est réservable que « sur demande ».");
