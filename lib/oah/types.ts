export type CityId = "CO" | "TO" | "GH" | "BE" | "OS";

export interface OahCity {
  id: CityId;
  name: string;
  lat: number;
  lon: number;
}

export interface OahSite {
  code: string;
  name: string;
  cityId: CityId;
  cityName: string;
  lat: number;
  lon: number;
  altitude: number | null;
}

export type QualityClass = "High" | "Good" | "Moderate" | "Poor" | "Bad";

export interface DashboardRow {
  siteCode: string;
  date: string;
  fishQuality: QualityClass | null;
  fishRichness: number | null;
  macroinvertebratesQuality: QualityClass | null;
  macroinvertebratesRichness: number | null;
  diatomsQuality: QualityClass | null;
  diatomsRichness: number | null;
  nitrate: number | null;
}

export interface HealthRiskRow {
  researchSiteCode: string;
  samplingDate: string;
  scaledPathogenRisk: number;
  scaledFecalRisk: number;
  scaledArgRisk: number;
  healthRiskScore: number;
}

/** What the OneAquaHealth labs measured at one research site. */
export interface LabSummary {
  site: OahSite;
  ecology: {
    fish: { quality: QualityClass; date: string } | null;
    macroinvertebrates: { quality: QualityClass; date: string } | null;
    diatoms: { quality: QualityClass; date: string } | null;
  };
  risk: HealthRiskRow | null;
}
