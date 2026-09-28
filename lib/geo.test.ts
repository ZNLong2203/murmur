import { describe, expect, it } from "vitest";
import { birdnetWeek, distanceKm, nearest } from "./geo";

describe("geo", () => {
  it("measures Coimbra to Oslo at about 2,500 km", () => {
    expect(distanceKm({ lat: 40.2033, lon: -8.4103 }, { lat: 59.9139, lon: 10.7522 })).toBeGreaterThan(2400);
    expect(distanceKm({ lat: 40.2033, lon: -8.4103 }, { lat: 59.9139, lon: 10.7522 })).toBeLessThan(2600);
  });

  it("finds the nearest item", () => {
    const items = [{ id: "a", lat: 0, lon: 0 }, { id: "b", lat: 10, lon: 10 }];
    expect(nearest({ lat: 9, lon: 9 }, items)?.item.id).toBe("b");
    expect(nearest({ lat: 0, lon: 0 }, [])).toBeNull();
  });

  it("maps dates to BirdNET weeks", () => {
    expect(birdnetWeek(new Date("2026-01-01T12:00:00Z"))).toBe(1);
    expect(birdnetWeek(new Date("2026-01-31T12:00:00Z"))).toBe(4);
    expect(birdnetWeek(new Date("2026-06-15T12:00:00Z"))).toBe(23);
    expect(birdnetWeek(new Date("2026-12-31T12:00:00Z"))).toBe(48);
  });
});
