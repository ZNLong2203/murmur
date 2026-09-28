import type { Label } from "./types";

export type SoundGroup = "bird" | "amphibian" | "insect" | "mammal" | "other";

export const GROUPS: Record<SoundGroup, { label: string; plural: string; color: string }> = {
  bird: { label: "Bird", plural: "Birds", color: "var(--bird)" },
  amphibian: { label: "Frog or toad", plural: "Frogs & toads", color: "var(--amphibian)" },
  insect: { label: "Insect", plural: "Insects", color: "var(--insect)" },
  mammal: { label: "Mammal", plural: "Mammals", color: "var(--mammal)" },
  other: { label: "Other", plural: "Other", color: "var(--other)" },
};

export function groupOf(label: Pick<Label, "className">): SoundGroup {
  switch (label.className) {
    case "Aves":
      return "bird";
    case "Amphibia":
      return "amphibian";
    case "Insecta":
      return "insect";
    case "Mammalia":
      return "mammal";
    default:
      return "other";
  }
}

/** Plain words for a model score, so nobody has to interpret 0.63. */
export function likelihood(p: number): { word: string; tone: "strong" | "medium" | "weak" } {
  if (p >= 0.7) return { word: "Very likely", tone: "strong" };
  if (p >= 0.5) return { word: "Likely", tone: "medium" };
  return { word: "Possible", tone: "weak" };
}

/** Local-language name for the city the recording belongs to, if we have one. */
export const CITY_LOCALE: Record<string, keyof Label["names"] | undefined> = {
  CO: "pt",
  TO: "fr",
  GH: "nl",
  OS: "no",
  BE: undefined, // no Italian column in the BirdNET taxonomy
};

export function localName(label: Label, cityId: string | null | undefined): string | null {
  const locale = cityId ? CITY_LOCALE[cityId] : undefined;
  return locale ? (label.names[locale] ?? null) : null;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "a Eurasian Wren", "an Iberian Tree Frog": English article by sound, for common names. */
export function withArticle(name: string): string {
  return `${/^(?:[aio]|e(?!u)|u(?!ni|s[aeiou]|r[aeiou]))/i.test(name) ? "an" : "a"} ${name}`;
}
