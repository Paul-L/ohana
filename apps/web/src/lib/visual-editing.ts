import { setAttr } from "@directus/visual-editing";
import type { AstroCookies } from "astro";

const COOKIE = "ohana-visual-editing";

/**
 * Le mode édition visuelle s'active quand Directus ouvre le site avec
 * `?visual-editing=true` (URL à déclarer dans Directus > Paramètres > Éditeur visuel).
 * Un cookie de session le garde actif pendant la navigation dans l'iframe.
 */
export function isVisualEditing(url: URL, cookies: AstroCookies): boolean {
  const param = url.searchParams.get("visual-editing");
  if (param === "true") {
    cookies.set(COOKIE, "1", { path: "/", sameSite: "none", secure: true, httpOnly: true });
    return true;
  }
  if (param === "false") {
    cookies.delete(COOKIE, { path: "/" });
    return false;
  }
  return cookies.get(COOKIE)?.value === "1";
}

/**
 * Retourne l'attribut data-directus uniquement en mode édition
 * (évite d'exposer la structure du CMS aux visiteurs).
 */
export function editable(
  enabled: boolean,
  collection: string,
  item: string | number,
  fields?: string | string[],
  mode: "drawer" | "modal" | "popover" = "popover",
) {
  if (!enabled) return {};
  return { "data-directus": setAttr({ collection, item, fields, mode }) };
}
