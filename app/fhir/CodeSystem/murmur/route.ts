import { murmurCodeSystem } from "@/lib/interop/codesystem";

/** The canonical URL of Murmur's code system resolves to its definition. */
export function GET() {
  return new Response(JSON.stringify(murmurCodeSystem, null, 2), {
    headers: { "content-type": "application/fhir+json; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
