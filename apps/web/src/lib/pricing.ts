// Mise en forme des saisons et tarifs (aucune dépendance Directus ici).

export interface SeasonRule {
  name: string;
  periods: { from: string; to: string }[] | null; // "MM-JJ"
  price_double: number | null;
  price_single: number | null;
  min_nights: number | null;
  min_nights_weekend: number | null;
  long_stay_nights: number | null;
  long_stay_discount: number | null;
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** "07-07" → "7 juil." ; "09-01" → "1er sept." */
export function formatMonthDay(md: string) {
  const [m, d] = md.split("-").map(Number);
  if (!m || !d) return md;
  return `${d === 1 ? "1er" : d} ${MONTHS[m - 1]}`;
}

export function formatPeriods(periods: SeasonRule["periods"]) {
  return (periods ?? []).map((p) => `${formatMonthDay(p.from)} → ${formatMonthDay(p.to)}`);
}

/** Conditions lisibles, ex. « Min. 1 nuit en semaine · 2 nuits le week-end ». */
export function seasonConditions(s: SeasonRule) {
  const min = s.min_nights ?? 1;
  const we = s.min_nights_weekend ?? min;
  const n = (k: number) => `${k} nuit${k > 1 ? "s" : ""}`;
  const stay = we > min ? `Min. ${n(min)} en semaine · ${n(we)} le week-end` : `Min. ${n(min)}`;
  const discount = s.long_stay_discount && s.long_stay_nights ? `−${s.long_stay_discount} % dès ${n(s.long_stay_nights)}` : null;
  return { stay, discount };
}

export const eur = (v: number) =>
  `${v.toLocaleString("fr-FR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;
