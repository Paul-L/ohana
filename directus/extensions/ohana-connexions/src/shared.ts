// Outils communs : accès aux données Directus (droits complets, côté serveur) et signature des états OAuth.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Sous-ensemble du contexte d'extension Directus utilisé ici (endpoint et hook). */
export interface Ctx {
  services: any;
  getSchema: () => Promise<any>;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

export type Provider = "google" | "instagram";

/**
 * Variables lues directement dans process.env : Directus convertit en nombre les valeurs numériques,
 * ce qui abîmerait les identifiants d'app Meta (16 chiffres).
 */
export const env = (name: string) => process.env[name]?.trim() || "";
export const publicUrl = () => env("PUBLIC_URL").replace(/\/$/, "");
export const callbackUrl = (provider: Provider) => `${publicUrl()}/connexions/${provider}/callback`;

/** Service d'items sans contrôle de droits (le code de l'extension est de confiance). */
export async function items(ctx: Ctx, collection: string) {
  return new ctx.services.ItemsService(collection, { schema: await ctx.getSchema(), accountability: null });
}
export async function files(ctx: Ctx) {
  return new ctx.services.FilesService({ schema: await ctx.getSchema(), accountability: null });
}

export async function readAuth<T>(ctx: Ctx, provider: Provider): Promise<Partial<T>> {
  return ((await (await items(ctx, `${provider}_auth`)).readSingleton({})) ?? {}) as Partial<T>;
}
export async function writeAuth(ctx: Ctx, provider: Provider, data: Record<string, unknown>) {
  await (await items(ctx, `${provider}_auth`)).upsertSingleton(data);
}

/** Enregistre le résultat d'une synchro (affiché dans le module Connexions). */
export async function recordSync(ctx: Ctx, provider: Provider, ok: boolean, message: string) {
  await writeAuth(ctx, provider, { last_sync_at: new Date().toISOString(), last_sync_ok: ok, last_sync_message: message });
  if (ok) ctx.logger.info(`[connexions] ${provider} : ${message}`);
  else ctx.logger.warn(`[connexions] ${provider} : ${message}`);
}

// ---------- État OAuth signé (protège le retour de Google / Instagram, valable 15 min) ----------

const sign = (payload: string) => createHmac("sha256", env("SECRET") || "ohana").update(payload).digest("base64url");

export function makeState(provider: Provider, user: string) {
  const payload = Buffer.from(JSON.stringify({ p: provider, u: user, t: Date.now(), n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function checkState(state: string | undefined, provider: Provider) {
  const [payload, sig] = (state ?? "").split(".");
  if (!payload || !sig) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  const { p, t } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { p: string; t: number };
  return p === provider && Date.now() - t < 15 * 60_000;
}

export async function json<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: unknown; error_description?: string; error_message?: string };
  if (!res.ok || body.error) {
    const e = body.error as { message?: string; status?: string } | string | undefined;
    const detail = typeof e === "string" ? (body.error_description ?? body.error_message ?? e) : (e?.message ?? body.error_message ?? "");
    throw new Error(`${label} : ${res.status} ${detail}`.trim());
  }
  return body;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
