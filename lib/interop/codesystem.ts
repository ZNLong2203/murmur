import type { CodeSystem } from "fhir/r4";
import { MURMUR_CS, VERIFICATION_DISPLAY } from "./fhir";

/** The concepts Murmur's FHIR output uses beyond the OneAquaHealth IG. */
export const murmurCodeSystem: CodeSystem = {
  resourceType: "CodeSystem",
  id: "murmur",
  url: MURMUR_CS,
  version: "0.1.0",
  name: "MurmurConcepts",
  title: "Murmur acoustic observation concepts",
  status: "draft",
  experimental: true,
  publisher: "Murmur (IEEE OneAquaHealth Global Hackathon 2026 entry)",
  description:
    "Concepts for passive acoustic observations of urban streams: soundscape indices, sound groups outside the OneAquaHealth IG, and how each AI suggestion was checked by people. Proposed for adoption into the OneAquaHealth temporary code system.",
  caseSensitive: true,
  content: "complete",
  concept: [
    { code: "soundscape-indices", display: "Soundscape acoustic indices", definition: "Panel of indices computed from a recording's spectrum." },
    { code: "ndsi", display: "Normalized Difference Soundscape Index", definition: "(B − A)/(B + A), A = 1–2 kHz power, B = 2–11 kHz power (Kasten et al. 2012). Range −1 to 1." },
    { code: "audible-share", display: "Share of windows clear enough to hear small birds", definition: "Share of 3 s windows whose 2–8 kHz band energy P95 − P20 reaches the audibility threshold." },
    { code: "life-share", display: "Share of windows with a bird or amphibian call", definition: "Share of 3 s windows containing at least one bird or amphibian detection." },
    { code: "acoustic-insect", display: "Insects heard", definition: "Insect species identified from sound." },
    { code: "acoustic-mammal", display: "Mammals heard", definition: "Mammal species identified from sound." },
    { code: "acoustic-other", display: "Other sounds heard", definition: "Other taxa identified from sound." },
    ...(Object.entries(VERIFICATION_DISPLAY) as Array<[string, string]>).map(([code, display]) => ({ code, display, definition: display })),
  ],
};
