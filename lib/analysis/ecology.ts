// What a species tells you about a stream, in plain words. Entries come from
// data/species/ecology.json (curated with sources); these are the tags.

export type EcologyTag =
  | "clean-water"
  | "flowing-water"
  | "riparian-woodland"
  | "reedbed-wetland"
  | "open-water"
  | "insect-eater"
  | "amphibian"
  | "urban-tolerant"
  | "non-native";

export interface EcologyEntry {
  sci: string;
  labelIdx: number;
  en: string;
  tags: EcologyTag[];
  meaning: string;
  sources: Array<{ title: string; url: string }>;
  needsReview: boolean;
}

export const TAGS: Record<EcologyTag, { label: string; hint: string; tone: "good" | "neutral" | "caution" }> = {
  "clean-water": { label: "Needs clean water", hint: "Depends on good water quality; its presence is a good sign.", tone: "good" },
  "flowing-water": { label: "Flowing water", hint: "Lives along fast, flowing reaches.", tone: "good" },
  "riparian-woodland": { label: "Bankside trees", hint: "Needs trees and shrubs along the banks.", tone: "good" },
  "reedbed-wetland": { label: "Reeds & wetland", hint: "Needs reeds or marshy margins.", tone: "good" },
  "open-water": { label: "Open water", hint: "Uses open water or muddy margins.", tone: "neutral" },
  "insect-eater": {
    label: "Insect eater",
    hint: "Feeds on flying or aquatic insects. OneAquaHealth found birds and amphibians act as natural controls of disease-carrying insects.",
    tone: "good",
  },
  amphibian: { label: "Amphibian", hint: "Frogs and toads are one of OneAquaHealth's eleven ecosystem-health indicators.", tone: "good" },
  "urban-tolerant": { label: "Copes with cities", hint: "Common even where habitat is degraded; tells you little about stream health.", tone: "neutral" },
  "non-native": { label: "Non-native", hint: "Introduced to this region; worth reporting to local biodiversity schemes.", tone: "caution" },
};
