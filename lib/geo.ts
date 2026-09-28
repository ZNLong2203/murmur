export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearest<T extends LatLon>(point: LatLon, items: readonly T[]): { item: T; km: number } | null {
  let best: { item: T; km: number } | null = null;
  for (const item of items) {
    const km = distanceKm(point, item);
    if (!best || km < best.km) best = { item, km };
  }
  return best;
}

/** BirdNET's week of the year: four weeks per month, 1–48. */
export function birdnetWeek(date: Date): number {
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  return month * 4 + Math.min(4, Math.ceil(day / 7));
}
