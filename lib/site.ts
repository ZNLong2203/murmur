/** Public base URL of the deployed app; also the root of Murmur's FHIR canonicals. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://murmur-streams.vercel.app").replace(/\/$/, "");
