import { ImageResponse } from "next/og";

export const alt = "Murmur, a stethoscope for urban streams";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// A stylised spectrogram: bars in the water and bird colours of the app.
const BARS = Array.from({ length: 48 }, (_, i) => {
  const song = [7, 8, 9, 19, 20, 21, 22, 32, 33, 40, 41, 42].includes(i);
  return { h: song ? 90 + ((i * 37) % 60) : 18 + ((i * 53) % 36), song };
});

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f7f5ef", padding: 64 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 30, color: "#0a4f46", letterSpacing: 1 }}>A stethoscope for urban streams</div>
          <div style={{ fontSize: 104, fontWeight: 700, color: "#14201d", lineHeight: 1.05, marginTop: 8 }}>Murmur</div>
          <div style={{ fontSize: 34, color: "#33423e", marginTop: 12, maxWidth: 980 }}>
            Hear the birds and frogs of a city stream, confirm them by ear, and set them beside OneAquaHealth lab data.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 150 }}>
          {BARS.map((b, i) => (
            <div key={i} style={{ width: 12, height: b.h, borderRadius: 4, background: b.song ? "#96590a" : "#2a66a8", opacity: b.song ? 1 : 0.45 }} />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
