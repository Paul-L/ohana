/**
 * Vérifie le contraste du texte blanc de l'accueil (sur-titre + grand titre) sur la photo réelle,
 * voile compris (réglages partagés : apps/web/src/lib/hero-overlay.ts).
 *
 * Usage :
 *   pnpm check:contrast                  → photo d'accueil actuelle (Directus)
 *   pnpm check:contrast ~/photo.jpg      → tester une photo AVANT de la mettre en ligne
 *   pnpm check:contrast <id-fichier>     → un fichier déjà dans Directus
 *
 * Mesure : pour chaque zone de texte, on calcule le contraste WCAG du blanc sur chaque pixel du fond
 * et on retient le « pire 5 % » (les 5 % de pixels les plus clairs), plus exigeant qu'une moyenne.
 * Seuils : sur-titre (petit texte) ≥ 4,5:1 obligatoire ; titre (grand, graisse fine) ≥ 3:1 obligatoire, 4,5:1 visé.
 * Code de sortie 1 si un seuil obligatoire n'est pas atteint.
 */
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { HERO_OVERLAY, OVERLAY_RGB, alphaAt } from "../apps/web/src/lib/hero-overlay.ts";

const DIRECTUS_URL = process.env.DIRECTUS_URL ?? "http://localhost:8055";
const TOKEN = process.env.DIRECTUS_WEB_TOKEN;
const DEFAULT_EYEBROW = "Chambres d'hôtes · Moliets-et-Maâ · Landes";
const DEFAULT_TITLE = "Entre dunes et océan, quatre chambres autour de la piscine.";

async function directus<T>(path: string): Promise<T> {
  const res = await fetch(`${DIRECTUS_URL}${path}`, { headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {} });
  if (!res.ok) throw new Error(`Directus ${path} → ${res.status}`);
  return (await res.json()).data as T;
}

async function loadImage(arg: string | undefined): Promise<{ buffer: Buffer; label: string }> {
  if (arg && !/^[0-9a-f-]{36}$/i.test(arg)) {
    const path = arg.replace(/^~(?=\/)/, homedir());
    return { buffer: await readFile(path), label: path };
  }
  const id = arg ?? (await directus<{ hero_image: string | null }>("/items/settings?fields=hero_image")).hero_image;
  if (!id) throw new Error("Aucune photo d'accueil définie dans Directus (Réglages du site > hero_image).");
  const res = await fetch(`${DIRECTUS_URL}/assets/${id}`, { headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {} });
  if (!res.ok) throw new Error(`Image ${id} → ${res.status}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), label: `Directus ${id}` };
}

// ---------------------------------------------------------------- Modèle de mise en page (miroir de index.astro)

type Box = [x0: number, y0: number, x1: number, y1: number];
interface Zone { name: string; box: Box; min: number; target: number }

/** Largeur moyenne d'un caractère, en em (étalonnée sur Inter Tight 300 et Inter 500 capitales espacées) */
const CHAR_EM = { title: 0.46, eyebrow: 0.75 };

/** Découpe le titre en lignes comme le navigateur (au mot près) */
function wrap(text: string, fontSize: number, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length * CHAR_EM.title * fontSize > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function layout(width: number, eyebrow: string, title: string) {
  const mobile = width < 768;
  const height = mobile ? 380 : 500;
  // Marges et tailles reprises des classes Tailwind du hero
  const left = mobile ? 20 : Math.max(0, (width - 1240) / 2) + 24;
  const available = width - 2 * (mobile ? 20 : 24) - (mobile ? 0 : Math.max(0, width - 1240));
  const titleMax = mobile ? available : Math.min(760, available);
  const fs = mobile ? 34 : Math.min(64, Math.max(38, width * 0.048));
  const lh = fs * (mobile ? 1.06 : 1.04);
  const ebFs = mobile ? 12 : 14;
  const ebLh = ebFs * 1.6;
  const ebGap = mobile ? 8 : 12;
  // Bas du titre = hauteur − padding bas − pastille des notes − sa marge
  const titleBottom = height - (mobile ? 24 + 44 + 16 : 48 + 48 + 28);

  const lines = wrap(title, fs, titleMax);
  const titleTop = titleBottom - lines.length * lh;
  const zones: Zone[] = [];
  const ebTop = titleTop - ebGap - ebLh;
  zones.push({
    name: `sur-titre ${ebFs}px`,
    box: [left, ebTop, left + Math.min(available, eyebrow.length * CHAR_EM.eyebrow * ebFs), ebTop + ebLh],
    min: 4.5,
    target: 4.5,
  });
  lines.forEach((l, i) => {
    const y0 = titleTop + i * lh;
    zones.push({ name: `titre ${Math.round(fs)}px, ligne ${i + 1}`, box: [left, y0, left + l.length * CHAR_EM.title * fs, y0 + lh], min: 3, target: 4.5 });
  });
  return { height, mobile, zones };
}

// ---------------------------------------------------------------- Mesure

const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

async function render(buffer: Buffer, w: number, h: number, mobile: boolean) {
  const meta = await sharp(buffer).metadata();
  const s = Math.max(w / meta.width!, h / meta.height!);
  const rw = Math.max(w, Math.round(meta.width! * s));
  const rh = Math.max(h, Math.round(meta.height! * s));
  // object-fit: cover ; object-position: 50% 55%
  const { data } = await sharp(buffer)
    .rotate()
    .resize(rw, rh, { fit: "fill" })
    .extract({ left: Math.round((rw - w) * 0.5), top: Math.round((rh - h) * 0.55), width: w, height: h })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Luminance relative de chaque pixel après application du voile (mêmes couches que la page)
  const lum = new Float32Array(w * h);
  const vert = new Float32Array(h).map((_, y) => alphaAt(HERO_OVERLAY.fromBottom, 1 - (y + 0.5) / h));
  const horiz = new Float32Array(w).map((_, x) => (mobile ? 0 : alphaAt(HERO_OVERLAY.fromLeftDesktop, (x + 0.5) / w)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = 1 - (1 - HERO_OVERLAY.base) * (1 - vert[y]) * (1 - horiz[x]);
      const i = (y * w + x) * 3;
      const [r, g, b] = [0, 1, 2].map((k) => data[i + k] * (1 - a) + OVERLAY_RGB[k] * a);
      lum[y * w + x] = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }
  }
  return lum;
}

/** Contraste du blanc sur le « pire 5 % » des pixels de la zone */
function worstContrast(lum: Float32Array, w: number, h: number, [x0, y0, x1, y1]: Box) {
  const values: number[] = [];
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) values.push(lum[y * w + x]);
  values.sort((a, b) => b - a); // plus clairs d'abord
  const p95 = values[Math.floor(values.length * 0.05)] ?? 0;
  return 1.05 / (p95 + 0.05);
}

// ----------------------------------------------------------------

const { buffer, label } = await loadImage(process.argv[2]);
const settings = await directus<{ tagline: string | null }>("/items/settings?fields=tagline").catch(() => null);
const home = await directus<{ hero_eyebrow: string | null }>("/items/home?fields=hero_eyebrow").catch(() => null);
const title = settings?.tagline || DEFAULT_TITLE;
const eyebrow = home?.hero_eyebrow || DEFAULT_EYEBROW;

console.log(`Contraste du texte de l'accueil — ${label}`);
console.log(`(blanc sur la photo + voile ; valeur = pire 5 % des pixels de chaque zone)\n`);

let failed = false;
let warned = false;
for (const width of [390, 768, 1024, 1280, 1440, 1920, 2560]) {
  const { height, mobile, zones } = layout(width, eyebrow, title);
  const lum = await render(buffer, width, height, mobile);
  console.log(`${width} px${mobile ? " (mobile)" : ""}`);
  for (const z of zones) {
    const c = worstContrast(lum, width, height, z.box);
    const status = c < z.min ? "✗ insuffisant" : c < z.target ? "△ limite" : "✓";
    if (c < z.min) failed = true;
    else if (c < z.target) warned = true;
    console.log(`  ${status.padEnd(14)} ${c.toFixed(1).padStart(4)}:1  ${z.name}`);
  }
}

console.log(
  failed
    ? "\n✗ Contraste insuffisant : choisir une photo plus sombre à gauche/en bas, ou renforcer le voile dans apps/web/src/lib/hero-overlay.ts."
    : warned
      ? "\n△ Conforme, mais le titre (graisse fine) est en dessous de 4,5:1 par endroits."
      : "\n✓ Contraste conforme à toutes les largeurs (WCAG AA).",
);
process.exitCode = failed ? 1 : 0;
