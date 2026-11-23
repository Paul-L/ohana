// Logique tarifaire partagée serveur / navigateur (aucune dépendance Directus ici).
// Toutes les dates sont des chaînes ISO "AAAA-MM-JJ", traitées en UTC.

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

const inPeriod = (md: string, { from, to }: { from: string; to: string }) =>
  from <= to ? md >= from && md <= to : md >= from || md <= to; // gère les périodes à cheval sur le 1er janvier

export function seasonFor<T extends SeasonRule>(seasons: T[], isoDate: string): T | undefined {
  const md = isoDate.slice(5, 10);
  return seasons.find((s) => (s.periods ?? []).some((p) => inPeriod(md, p)));
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

export interface Estimate {
  season?: SeasonRule;
  nights: number;
  rooms: number;
  unitPrice: number;
  lodging: number;
  discount: number;
  tax: number;
  total: number;
  deposit: number;
  warning: string | null;
}

export function estimate(opts: {
  seasons: SeasonRule[];
  arrival: string;
  departure: string;
  guests: number;
  touristTax: number;
  depositPercent: number;
}): Estimate {
  const { seasons, arrival, departure, touristTax, depositPercent } = opts;
  const guests = Math.max(1, opts.guests || 1);
  const a = Date.parse(arrival);
  const d = Date.parse(departure);
  const nights = Number.isFinite(a) && Number.isFinite(d) ? Math.max(0, Math.round((d - a) / 86_400_000)) : 0;
  const season = arrival ? seasonFor(seasons, arrival) : undefined;
  const rooms = Math.ceil(guests / 2);
  const unitPrice = (guests === 1 ? season?.price_single : season?.price_double) ?? 0;

  let warning: string | null = null;
  if (arrival && departure) {
    const weekday = new Date(a).getUTCDay(); // 5 = vendredi, 6 = samedi
    const min = season?.min_nights ?? 1;
    const minWe = season?.min_nights_weekend ?? min;
    if (!season) warning = "Le lodge est fermé à cette période. Choisissez d'autres dates ou appelez-nous.";
    else if (nights === 0) warning = "La date de départ doit être après la date d'arrivée.";
    else if (nights < min) {
      const when = formatPeriods(season.periods).join(", ");
      warning = `En ${season.name.toLowerCase()}${when ? ` (${when})` : ""}, le séjour minimum est de ${min} nuits.`;
    } else if ((weekday === 5 || weekday === 6) && nights < minWe)
      warning = `Le week-end (vendredi et samedi), le séjour minimum est de ${minWe} nuits.`;
  }

  const lodging = unitPrice * rooms * nights;
  const discount =
    season?.long_stay_discount && season.long_stay_nights && nights >= season.long_stay_nights
      ? (lodging * season.long_stay_discount) / 100
      : 0;
  const tax = touristTax * guests * nights;
  const total = lodging - discount + tax;
  return { season, nights, rooms, unitPrice, lodging, discount, tax, total, deposit: (total * depositPercent) / 100, warning };
}

/** "17:00:00" → "17 h" ; "08:30:00" → "8 h 30" */
export function formatTime(t: string | null | undefined) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`;
}
