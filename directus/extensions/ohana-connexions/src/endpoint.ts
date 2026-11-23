// API du module « Connexions » : /connexions/…
import { type Ctx, type Provider, makeState, checkState, readAuth, publicUrl, errorMessage } from "./shared";
import { type GoogleAuth, googleConfigured, googleAuthorizeUrl, googleCallback, googleSelectLocation, googleDisconnect, syncGoogle } from "./google";
import { type InstagramAuth, instagramConfigured, instagramAuthorizeUrl, instagramCallback, instagramDisconnect, syncInstagram } from "./instagram";

const providers = {
  google: { configured: googleConfigured, authorizeUrl: googleAuthorizeUrl, callback: googleCallback, disconnect: googleDisconnect, sync: syncGoogle },
  instagram: { configured: instagramConfigured, authorizeUrl: instagramAuthorizeUrl, callback: instagramCallback, disconnect: instagramDisconnect, sync: syncInstagram },
} as const;

const isProvider = (p: string): p is Provider => p in providers;

// Objet nu plutôt que defineEndpoint() : évite d'embarquer le SDK (et zod) dans dist/api.js
export default {
  id: "connexions",
  handler: (router: any, context: unknown) => {
    const ctx = context as unknown as Ctx;

    // Réservé aux utilisateurs du back-office (administrateur, propriétaire)
    const guard = (req: any, res: any, next: () => void) => {
      if (!req.accountability?.user || !(req.accountability.admin || req.accountability.app)) return res.status(403).json({ error: "Accès refusé" });
      next();
    };
    const handle = (fn: (req: any, res: any) => Promise<unknown>) => async (req: any, res: any) => {
      try {
        await fn(req, res);
      } catch (err) {
        res.status(400).json({ error: errorMessage(err) });
      }
    };

    router.get("/status", guard, handle(async (_req, res) => {
      const g = await readAuth<GoogleAuth>(ctx, "google");
      const i = await readAuth<InstagramAuth>(ctx, "instagram");
      const sync = (a: { last_sync_at?: string | null; last_sync_ok?: boolean | null; last_sync_message?: string | null }) =>
        a.last_sync_at ? { at: a.last_sync_at, ok: !!a.last_sync_ok, message: a.last_sync_message ?? "" } : null;
      res.json({
        google: {
          configured: googleConfigured(),
          connected: !!g.refresh_token,
          email: g.email ?? null,
          location: g.location ?? null,
          locationTitle: g.location_title ?? null,
          locations: g.locations ?? [],
          lastSync: sync(g),
        },
        instagram: {
          configured: instagramConfigured(),
          connected: !!i.token,
          username: i.username ?? null,
          expiresAt: i.expires_at ?? null,
          lastSync: sync(i),
        },
      });
    }));

    router.get("/:provider/start", guard, handle(async (req, res) => {
      const { provider } = req.params;
      if (!isProvider(provider)) return res.status(404).end();
      if (!providers[provider].configured()) throw new Error("Application non configurée sur le serveur (voir README « Connexions »)");
      res.json({ url: providers[provider].authorizeUrl(makeState(provider, req.accountability.user)) });
    }));

    // Retour depuis Google / Instagram (navigation du navigateur) : protégé par l'état signé
    router.get("/:provider/callback", async (req: any, res: any) => {
      const { provider } = req.params;
      const back = (params: Record<string, string>) => res.redirect(`${publicUrl()}/admin/connexions?${new URLSearchParams(params)}`);
      if (!isProvider(provider)) return res.status(404).end();
      if (!checkState(req.query.state, provider)) return back({ error: "Lien de connexion expiré : recommencez" });
      if (req.query.error || !req.query.code) return back({ error: "Connexion annulée" });
      try {
        await providers[provider].callback(ctx, String(req.query.code));
        back({ connected: provider });
      } catch (err) {
        ctx.logger.error(`[connexions] ${provider} : ${errorMessage(err)}`);
        back({ error: errorMessage(err) });
      }
    });

    router.post("/:provider/sync", guard, handle(async (req, res) => {
      const { provider } = req.params;
      if (!isProvider(provider)) return res.status(404).end();
      await providers[provider].sync(ctx);
      res.json({ ok: true });
    }));

    router.post("/:provider/disconnect", guard, handle(async (req, res) => {
      const { provider } = req.params;
      if (!isProvider(provider)) return res.status(404).end();
      await providers[provider].disconnect(ctx);
      res.json({ ok: true });
    }));

    router.post("/google/location", guard, handle(async (req, res) => {
      await googleSelectLocation(ctx, String(req.body?.location ?? ""));
      res.json({ ok: true });
    }));
  },
};
