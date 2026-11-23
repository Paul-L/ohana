/** "06 70 10 91 92" → "tel:+33670109192" */
export function telHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits.startsWith("0") ? `+33${digits.slice(1)}` : digits}`;
}

/** Adresse multiligne → lignes non vides */
export const lines = (text: string | null | undefined) => (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

/** Adresse multiligne → PostalAddress schema.org (2e ligne attendue : "40660 Moliets-et-Maâ") */
export function postalAddress(address: string | null | undefined) {
  const [street, cityLine] = lines(address);
  if (!street) return undefined;
  const m = cityLine?.match(/^(\d{5})\s+(.+)$/);
  return {
    "@type": "PostalAddress",
    streetAddress: street,
    postalCode: m?.[1],
    addressLocality: m?.[2] ?? cityLine,
    addressRegion: "Landes",
    addressCountry: "FR",
  };
}

/** Texte de note "4,9" → 4.9 (les crochets de remplissage sont ignorés) */
export const scoreValue = (s: string | null | undefined) => Number((s ?? "").replace(/[[\]\s]/g, "").replace(",", ".")) || 0;

/** Retire les balises HTML (pour les données structurées) */
export const stripTags = (html: string | null | undefined) => (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
