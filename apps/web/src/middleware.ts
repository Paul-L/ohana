import { defineMiddleware } from "astro:middleware";
import { directus, readSingleton } from "@/lib/directus";
import { isVisualEditing } from "@/lib/visual-editing";

export const onRequest = defineMiddleware(async (ctx, next) => {
  ctx.locals.visualEditing = isVisualEditing(ctx.url, ctx.cookies);

  // Les actions et assets n'ont pas besoin des réglages globaux
  if (!ctx.url.pathname.startsWith("/_")) {
    ctx.locals.settings = await directus.request(readSingleton("settings")).catch(() => null);
  }

  const response = await next();

  if (response.headers.get("content-type")?.includes("text/html") && !response.headers.has("Cache-Control")) {
    response.headers.set(
      "Cache-Control",
      ctx.locals.visualEditing
        ? "private, no-store"
        : // Court cache CDN + revalidation en arrière-plan : rapide et à jour en ~1 min
          "public, max-age=0, s-maxage=60, stale-while-revalidate=600",
    );
  }
  return response;
});
