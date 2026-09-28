# FHIR mapping

Murmur exports one listening session as a FHIR R4 **transaction** Bundle, built by `lib/interop/fhir.ts` and shaped by the OneAquaHealth Implementation Guide (`http://hl7.eu/fhir/ig/oah`, source `github.com/hl7-eu/oah`). The same concepts the OneAquaHealth labs use for birds and amphibians describe what citizens heard, so both land in one model.

## Resources

| Murmur concept | FHIR resource | Profile / coding | Notes |
|---|---|---|---|
| OneAquaHealth research site | `Location` | `location-oah`; `identifier` = `https://api.enora-oah.eu/api/sites` \| site code; `mode = instance`; `position` | Conditional create (`ifNoneExist` on the identifier), so a site is never duplicated. Other places use a Murmur identifier and ~100 m rounded coordinates. |
| The AI model | `Device` | `deviceName` BirdNET+ V3.0 developer preview 3.1, `version`, `manufacturer`, licence in `note` | Referenced from `Observation.device` and as the Provenance assembler. |
| Birds heard | `Observation` | `observation-indicators-oah`; `code` = OAH temporary code system `#birds` | `valueQuantity` = species count; one `component` per species. |
| Amphibians heard | `Observation` | `observation-indicators-oah`; `code` = `#amphibians` | As above. |
| Insects, mammals | `Observation` | Murmur code system `#acoustic-insect`, `#acoustic-mammal` | Outside the IG's current scope. |
| One species | `Observation.component` | `code`: GBIF backbone taxon (`https://www.gbif.org/species`) + scientific and English name; `valueQuantity`: model score (UCUM `1`); `interpretation`: v3 `POS` + Murmur verification state | Verification states: `ai-suggested`, `confirmed-by-recordist`, `uncertain-by-recordist` (and, in the commons, community and expert states). Suggestions the recordist rejected are not exported. |
| Soundscape | `Observation` | Murmur `#soundscape-indices`, components `#ndsi`, `#audible-share`, `#life-share` | Computed on the device from the spectrum. |
| Who did what | `Provenance` | agents: `author` and `verifier` = the recordist (pseudonymous identifier), `assembler` = the model Device; `entity.what.identifier` = RFC 6920 `ni:///sha-256;…` of the original recording | The recording itself is never exported, only its fingerprint, so a copy held by the recordist can be proved to be the source. |

Every resource carries a generated narrative, `subject` is always the `Location` (as `observation-indicators-oah` requires), `performer` is the pseudonymous contributor, and `effectiveDateTime` is the recording date.

## Validation

`npx tsx scripts/validate-fhir.mts [base]` posts a representative bundle to a FHIR server's `Bundle/$validate`. On the public HAPI FHIR R4 server (28 Sep 2026):

- **0 structural errors.** The only errors are that the OneAquaHealth profiles are not loaded on that server ("profile reference … could not be found"), which is expected; validating against the IG needs its package.
- Remaining warnings are that the OAH temporary code system, GBIF and Murmur's code system are unknown to that server's terminology service.

## What we would propose to the IG

1. A citizen performer: the IG restricts `performer` to organisations and practitioner roles; citizen observations need a pseudonymous person.
2. Verification status and provenance for community data (Murmur's states map to Darwin Core `identificationVerificationStatus`).
3. Soundscape indices (`ndsi`, `audible-share`, `life-share`) as indicator codes next to `#birds` and `#amphibians`.
