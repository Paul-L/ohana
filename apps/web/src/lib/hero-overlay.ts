// Voile de la photo d'accueil : source unique utilisée par la page (index.astro)
// ET par la vérification de contraste (pnpm check:contrast). Modifier ici uniquement.

/** Couleur du voile (= --color-night) */
export const OVERLAY_RGB = [17, 17, 17] as const;

/** Arrêts d'un dégradé : [position 0→1, opacité 0→1] */
export type Stops = readonly (readonly [number, number])[];

export const HERO_OVERLAY = {
  /** Voile uniforme léger sur toute la photo */
  base: 0.18,
  /** Dégradé depuis le BAS de la photo (le texte est calé en bas) */
  fromBottom: [
    [0, 0.62],
    [0.55, 0.5],
    [0.85, 0],
  ] as Stops,
  /** Dégradé depuis la GAUCHE, à partir de 768 px (texte aligné à gauche) */
  fromLeftDesktop: [
    [0, 0.45],
    [0.45, 0.3],
    [0.75, 0],
  ] as Stops,
};

/** Dégradé CSS équivalent, ex. linear-gradient(to top, rgb(17 17 17 / 0.62) 0%, …) */
export function cssGradient(direction: "to top" | "to right", stops: Stops) {
  const [r, g, b] = OVERLAY_RGB;
  return `linear-gradient(${direction}, ${stops.map(([pos, a]) => `rgb(${r} ${g} ${b} / ${a}) ${pos * 100}%`).join(", ")})`;
}

/** Opacité du voile à la position t (0→1) pour une liste d'arrêts (interpolation linéaire, comme le CSS) */
export function alphaAt(stops: Stops, t: number) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [p1, a1] = stops[i];
    const [p0, a0] = stops[i - 1];
    if (t <= p1) return a0 + ((a1 - a0) * (t - p0)) / (p1 - p0);
  }
  return stops[stops.length - 1][1];
}
