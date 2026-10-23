// src/studio/watch/categories.ts
// The editorial topics of the Watch & Listen page (taken from the İlçede Pembe Haber news
// sections, so a story, a video and a podcast about the same subject sit under one name).
// Pure: normalising free text to a canonical name, and ordering names for filters and rails.

export const CANONICAL_CATEGORIES = [
  "Eğitim & Gelişim",
  "Kadın & İlham",
  "Çocuk & Gelecek",
  "Sağlık & İyi Yaşam",
  "Gıda & Sürdürülebilirlik",
  "Bilim & Teknoloji",
  "Çözüm Hikayeleri",
  "Sürdürülebilirlik",
  "Eğitim",
  "Sağlık",
  "Kültür Sanat",
] as const;

const fold = (s: string): string =>
  s
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/\s*(&|ve|and)\s*/g, " & ")
    .replace(/\s+/g, " ")
    .trim();

const BY_FOLD = new Map<string, string>(
  CANONICAL_CATEGORIES.map((c) => [fold(c), c]),
);

/** "kadin ve ilham" -> "Kadın & İlham"; anything unknown is kept as typed (trimmed). */
export function canonicalCategory(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return BY_FOLD.get(fold(t)) ?? t;
}

/** Position in the editorial order; unknown names come after, in alphabetical order. */
export function categoryRank(name: string): number {
  const i = (CANONICAL_CATEGORIES as readonly string[]).indexOf(name);
  return i === -1 ? CANONICAL_CATEGORIES.length : i;
}

export function compareCategories(a: string, b: string): number {
  return categoryRank(a) - categoryRank(b) || a.localeCompare(b, "tr");
}

/** Every editorial topic (always offered, even when empty) plus whatever else exists. */
export function categoryOptions(used: Iterable<string>): string[] {
  const all = new Set<string>(CANONICAL_CATEGORIES);
  for (const u of used) if (u) all.add(u);
  return [...all].sort(compareCategories);
}
