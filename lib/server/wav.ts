import "server-only";

/** Accept only the clips the app itself produces: PCM16 mono WAV, ≤ 3.2 s. */
export function isValidClip(dataB64: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataB64)) return false;
  const bytes = Buffer.from(dataB64, "base64");
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") return false;
  if (bytes.toString("ascii", 12, 16) !== "fmt " || bytes.toString("ascii", 36, 40) !== "data") return false;
  const format = bytes.readUInt16LE(20);
  const channels = bytes.readUInt16LE(22);
  const rate = bytes.readUInt32LE(24);
  const bits = bytes.readUInt16LE(34);
  const dataBytes = bytes.readUInt32LE(40);
  if (format !== 1 || channels !== 1 || bits !== 16 || rate < 16_000 || rate > 48_000) return false;
  return dataBytes <= bytes.length - 44 && dataBytes / (rate * 2) <= 3.2;
}
