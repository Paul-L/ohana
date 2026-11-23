// Autorisation unique de l'accès aux avis Google (Business Profile API) — à lancer en local : `pnpm google:auth`
//
// Prérequis (voir README, « Avis Google ») : projet Google Cloud avec accès Business Profile API accordé,
// identifiant OAuth de type « Application de bureau » → GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans .env.
//
// Le script ouvre une page de connexion Google : se connecter avec le compte qui gère la fiche de l'établissement.
// Il affiche ensuite GOOGLE_REFRESH_TOKEN et GOOGLE_LOCATION à reporter dans .env et dans Coolify.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Renseigner GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans .env (voir README, « Avis Google »).");
  process.exit(1);
}

const PORT = 8765;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPE = "https://www.googleapis.com/auth/business.manage";
const state = randomBytes(16).toString("hex");

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // garantit l'envoi d'un refresh token
    state,
  });

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(`${url} → ${res.status} ${json.error?.message ?? ""}`);
  return json;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT);
  if (url.pathname !== "/callback") return void res.writeHead(404).end();
  const code = url.searchParams.get("code");
  if (url.searchParams.get("state") !== state || !code) {
    res.writeHead(400).end("Autorisation refusée ou invalide. Relancez pnpm google:auth.");
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("C'est bon ! Vous pouvez fermer cet onglet et revenir au terminal.");
  server.close();

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
    });
    const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; error_description?: string };
    if (!tokens.access_token || !tokens.refresh_token) throw new Error(tokens.error_description ?? "jeton absent de la réponse Google");

    console.log(`\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

    // Fiches gérées par ce compte → valeur de GOOGLE_LOCATION
    const { accounts = [] } = await getJson<{ accounts?: { name: string; accountName?: string }[] }>(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      tokens.access_token,
    );
    for (const account of accounts) {
      const { locations = [] } = await getJson<{ locations?: { name: string; title?: string }[] }>(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title&pageSize=100`,
        tokens.access_token,
      );
      for (const loc of locations) {
        // v1 : « locations/123 » ; l'API des avis (v4) attend « accounts/456/locations/123 »
        console.log(`${loc.title ?? "(sans nom)"} — compte « ${account.accountName ?? account.name} »`);
        console.log(`  GOOGLE_LOCATION=${account.name}/${loc.name}\n`);
      }
    }
    if (!accounts.length) console.log("Aucun compte Business Profile trouvé pour ce compte Google.");
    console.log("Reporter ces valeurs dans .env (local) et dans les variables Coolify (production).");
  } catch (err) {
    console.error("✗", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Ouvrez ce lien et connectez-vous avec le compte Google qui gère la fiche de l'établissement :\n");
  console.log(authUrl + "\n");
});
