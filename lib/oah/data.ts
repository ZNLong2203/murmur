import "server-only";
import citiesJson from "@/data/oah/cities.json";
import dashboardsJson from "@/data/oah/city-dashboards.json";
import risksJson from "@/data/oah/health-risks.json";
import metaJson from "@/data/oah/meta.json";
import sitesJson from "@/data/oah/sites.json";
import type { CityId, DashboardRow, HealthRiskRow, LabSummary, OahCity, OahSite, QualityClass } from "./types";

// A snapshot of the public OneAquaHealth API (api.enora-oah.eu), refreshed
// by pipeline/murmur_pipeline/oah_snapshot.py. Reading a snapshot keeps the
// app fast and demo-able offline, and spares a production API we do not own.

export const oahMeta = metaJson as { fetchedAt: string; baseUrl: string };

export const cities: OahCity[] = (citiesJson as Array<{ id: CityId; name: string; latitude: number; longitude: number }>).map(
  (c) => ({ id: c.id, name: c.name, lat: c.latitude, lon: c.longitude }),
);

export const sites: OahSite[] = sitesJson as OahSite[];

const dashboards = dashboardsJson as DashboardRow[];
const risks = risksJson as HealthRiskRow[];

export function getSite(code: string): OahSite | undefined {
  return sites.find((s) => s.code === code);
}

function latest(rows: DashboardRow[], pick: (r: DashboardRow) => QualityClass | null) {
  const found = rows.filter((r) => pick(r)).sort((a, b) => b.date.localeCompare(a.date))[0];
  return found ? { quality: pick(found)!, date: found.date } : null;
}

export function getLabSummary(code: string): LabSummary | null {
  const site = getSite(code);
  if (!site) return null;
  const rows = dashboards.filter((r) => r.siteCode === code);
  return {
    site,
    ecology: {
      fish: latest(rows, (r) => r.fishQuality),
      macroinvertebrates: latest(rows, (r) => r.macroinvertebratesQuality),
      diatoms: latest(rows, (r) => r.diatomsQuality),
    },
    risk: risks.filter((r) => r.researchSiteCode === code).sort((a, b) => b.samplingDate.localeCompare(a.samplingDate))[0] ?? null,
  };
}
