import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Murmur · a stethoscope for urban streams",
    short_name: "Murmur",
    description: "Hear the birds and frogs of a city stream, confirm them by ear, and set them beside OneAquaHealth lab data.",
    start_url: "/analyze",
    display: "standalone",
    background_color: "#f7f5ef",
    theme_color: "#0e6e62",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
