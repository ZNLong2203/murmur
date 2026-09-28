import { describe, expect, it } from "vitest";
import { encodeWav, toBase64 } from "./wav";

describe("encodeWav", () => {
  it("writes a valid 16-bit mono header and clamps samples", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 24_000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
    expect(view.getInt16(50, true)).toBe(0x7fff);
  });
  it("base64-encodes large buffers", () => {
    expect(toBase64(new Uint8Array([77, 97, 110]))).toBe("TWFu");
    expect(toBase64(new Uint8Array(100_000)).length).toBe(133_336);
  });
});
