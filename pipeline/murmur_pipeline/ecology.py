"""Step 3: curated ecology notes for species heard at urban streams -> data/species/ecology.json.

Usage: uv run python -m murmur_pipeline.ecology

The species, tags and one-sentence meanings below are written by hand. The script
fetches every cited source (cached in pipeline/.cache/sources) and checks each tag
and each extra claim of the meaning sentence against the fetched text with a
keyword pattern. The first matching passage is saved as evidence in
data/species/ecology-evidence.json so a person can review it. A species whose
sources cannot be fetched, or whose tags/claims are not all found, gets
needsReview = true. Keyword matches are a screening aid, not proof: the
evidence passages were read by a person before release (see pipeline/README.md).

Tag vocabulary (fixed by the app):
  clean-water        depends on good water quality / sensitive to pollution
  flowing-water      streams and rivers
  riparian-woodland  trees, scrub and thickets, such as those lining streams
  reedbed-wetland    reeds, marshes, wet meadows
  open-water         ponds, lakes, slow water
  insect-eater       feeds on insects (flying or aquatic ones for most species here)
  amphibian          frogs and toads
  urban-tolerant     lives in towns, parks and gardens
  non-native         introduced to Europe (or to the region named)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .common import DATA_DIR, read_json, write_json
from .models import acoustic_index_by_sci, acoustic_labels
from .sources import fetch_text

OUT = DATA_DIR / "species" / "ecology.json"
EVIDENCE_OUT = DATA_DIR / "species" / "ecology-evidence.json"
OAH_CITIES = ("CO", "TO", "GH", "BE", "OS")
MAX_WORDS = 25

TAGS = ("clean-water", "flowing-water", "riparian-woodland", "reedbed-wetland", "open-water",
        "insect-eater", "amphibian", "urban-tolerant", "non-native")

# English patterns, plus Spanish ones for the Iberian amphibian encyclopedia (vertebradosibericos.org).
TAG_PATTERNS: dict[str, str] = {
    "clean-water": r"pollut|acidi|water quality|clean water|clear water|unpolluted|contaminat",
    "flowing-water": r"fast[- ]flowing|running water|\bstreams?\b|\brivers?\b|\bbrooks?\b|riverbanks?|watercourses?|"
                     r"\barroyos?\b|\bríos?\b|cursos de agua",
    "riparian-woodland": r"riparian|riverine|riverside|waterside|bankside|woodlands?|\bwoods?\b|forests?|"
                         r"scrub|thickets?|undergrowth|hedgerows?|\bbushes\b|\btrees\b|bosques?|matorral|ribera",
    "reedbed-wetland": r"\breeds?\b|reedbeds?|reed-?beds?|marsh|wetlands?|swamps?|\bfens?\b|wet meadows?|"
                       r"juncales?|carrizal|palustre",
    "open-water": r"\blakes?\b|\bponds?\b|reservoirs?|open water|\bpools?\b|gravel pits?|\bcanals?\b|\blochs?\b|"
                  r"waterbod|charcas?|estanques?|lagunas?|balsas?|embalses?",
    "insect-eater": r"insect|invertebrat|larvae|midges|mosquito|caddis|mayfl|artrópodos|hormigas|coleópteros",
    "amphibian": r"\bfrogs?\b|\btoads?\b|amphibians?|\branas?\b|\bsapos?\b|anfibios?",
    "urban-tolerant": r"\burban|\btowns?\b|\bcit(?:y|ies)\b|gardens?|\bparks?\b|buildings|suburb|villages?|"
                      r"human habitation|jardines|ciudad",
    "non-native": r"introduc|non-native|\balien\b|invasive|escape[ds]?|feral|naturali[sz]ed",
}

BTO = "https://www.bto.org/learn/about-birds/birdfacts/"
WIKI = "https://en.wikipedia.org/wiki/"
ARC = "https://www.arc-trust.org/"
EVVE = "https://www.vertebradosibericos.org/anfibios/"


def bto(slug: str, name: str) -> dict[str, str]:
    return {"title": f"BTO BirdFacts: {name}", "url": BTO + slug}


def wiki(title: str) -> dict[str, str]:
    return {"title": f"Wikipedia: {title.replace('_', ' ')}", "url": WIKI + title}


def arc(slug: str, name: str) -> dict[str, str]:
    return {"title": f"Amphibian and Reptile Conservation Trust: {name}", "url": ARC + slug}


def doi(doi_id: str, citation: str) -> dict[str, str]:
    """A paper, read through its Crossref record (title and abstract)."""
    return {"title": citation, "url": f"https://doi.org/{doi_id}"}


def evve(slug: str, sci: str) -> dict[str, str]:
    """Enciclopedia Virtual de los Vertebrados Españoles (MNCN-CSIC), in Spanish."""
    return {"title": f"Enciclopedia Virtual de los Vertebrados Españoles: {sci}", "url": f"{EVVE}{slug}.html"}


@dataclass
class Species:
    sci: str
    tags: tuple[str, ...]
    meaning: str
    sources: tuple[dict[str, str], ...]
    claims: tuple[str, ...] = ()  # extra regexes for statements in `meaning`
    tag_patterns: dict[str, str] = field(default_factory=dict)  # stricter per-species tag patterns
    en: str = ""  # English name when the acoustic label has none (it repeats the scientific name)
    evidence: dict[str, dict[str, str]] = field(default_factory=dict)


S = Species
SPECIES: list[Species] = [
    # --- birds of the water's edge -------------------------------------------------------
    S("Cinclus cinclus", ("clean-water", "flowing-water", "insect-eater"),
      "Walks and dives under water in fast streams to catch small invertebrates; it is very "
      "sensitive to acid and polluted water.",
      (bto("dipper", "Dipper"), wiki("White-throated_dipper")), (r"underwater", r"sensitive to acidity")),
    S("Motacilla cinerea", ("flowing-water", "insect-eater"),
      "Bobs its long tail beside fast-flowing streams, catching insects at the water's edge.",
      (bto("grey-wagtail", "Grey Wagtail"), wiki("Grey_wagtail")), (r"fast[- ]flowing",)),
    S("Alcedo atthis", ("flowing-water", "open-water"),
      "Dives from a perch to catch small fish in slow rivers, canals and lakes; nests in holes in earth banks.",
      (bto("kingfisher", "Kingfisher"), wiki("Common_kingfisher")), (r"\bfish\b", r"\bbanks?\b")),
    S("Cettia cetti", ("reedbed-wetland", "riparian-woodland", "insect-eater"),
      "Hidden in dense waterside scrub and reeds, it gives sudden, very loud bursts of song; feeds on insects.",
      (bto("cettis-warbler", "Cetti's Warbler"), wiki("Cetti's_warbler")), (r"loud",)),
    S("Actitis hypoleucos", ("flowing-water", "open-water", "insect-eater"),
      "Small wader that bobs along stony riverbanks and lake shores, picking insects from the water's edge.",
      (bto("common-sandpiper", "Common Sandpiper"), wiki("Common_sandpiper"))),
    S("Gallinula chloropus", ("open-water", "reedbed-wetland", "urban-tolerant"),
      "Common on ponds, canals and slow streams with plenty of bankside plants, including in city parks.",
      (bto("moorhen", "Moorhen"), wiki("Common_moorhen"))),
    S("Fulica atra", ("open-water", "urban-tolerant"),
      "Black waterbird with a white forehead shield, found on lakes, ponds and slow rivers, including park lakes.",
      (bto("coot", "Coot"), wiki("Eurasian_coot")), (r"shield",)),
    S("Tachybaptus ruficollis", ("open-water", "reedbed-wetland", "urban-tolerant"),
      "Small waterbird of ponds, lakes, slow rivers and other small wetlands, even in urban parks.",
      (bto("little-grebe", "Little Grebe"), wiki("Little_grebe"))),
    S("Rallus aquaticus", ("reedbed-wetland",),
      "Secretive bird of reedbeds and marshes, more often heard than seen; its calls include pig-like squeals.",
      (bto("water-rail", "Water Rail"), wiki("Water_rail")), (r"squeal", r"secretive|skulking")),
    S("Anas platyrhynchos", ("open-water", "urban-tolerant"),
      "Familiar duck of almost any water, from rivers and lakes to ponds in city parks.",
      (bto("mallard", "Mallard"), wiki("Mallard"))),
    S("Anas crecca", ("open-water", "reedbed-wetland"),
      "Small duck of shallow wetlands and pond edges, most numerous in winter.",
      (bto("teal", "Teal"), wiki("Eurasian_teal")), (r"winter",)),
    S("Aythya fuligula", ("open-water", "urban-tolerant"),
      "Diving duck of lakes, reservoirs and park ponds.",
      (bto("tufted-duck", "Tufted Duck"), wiki("Tufted_duck")), (r"\bdiv(?:e|es|ing)\b",)),
    S("Cygnus olor", ("open-water", "urban-tolerant"),
      "Large white swan of lakes, slow rivers and park ponds.",
      (bto("mute-swan", "Mute Swan"), wiki("Mute_swan")), (), {"urban-tolerant": r"especially in parks"}),
    S("Anser anser", ("open-water", "reedbed-wetland"),
      "Large grey goose that breeds by lakes and wetlands and grazes on nearby grassland.",
      (bto("greylag-goose", "Greylag Goose"), wiki("Greylag_goose")), (r"graz",)),
    S("Chroicocephalus ridibundus", ("open-water", "urban-tolerant"),
      "Small gull that nests by lakes and marshes and often feeds in towns and parks.",
      (bto("black-headed-gull", "Black-headed Gull"), wiki("Black-headed_gull"))),
    S("Ardea cinerea", ("open-water", "flowing-water", "urban-tolerant"),
      "Stands still in shallow water of rivers and ponds to catch fish, frogs and other small animals.",
      (bto("grey-heron", "Grey Heron"), wiki("Grey_heron")), (r"\bfish\b", r"frogs|amphibians"),
      {"urban-tolerant": r"live in cities|urban environments"}),
    S("Egretta garzetta", ("open-water", "reedbed-wetland"),
      "Small white heron that hunts fish and other small animals in the shallow water of wetlands and rivers.",
      (bto("little-egret", "Little Egret"), wiki("Little_egret")), (r"shallow water", r"fish")),
    S("Nycticorax nycticorax", ("reedbed-wetland", "open-water"),
      "Stocky heron that feeds mainly at dusk and at night in wetlands and along rivers.",
      (bto("night-heron", "Night Heron"), wiki("Black-crowned_night_heron")), (r"mainly at night|nocturnal",)),
    S("Tringa ochropus", ("open-water", "flowing-water"),
      "Wader that visits small pools, ditches and stream edges, mostly on migration and in winter.",
      (bto("green-sandpiper", "Green Sandpiper"), wiki("Green_sandpiper")), (r"ditch", r"migra")),
    S("Motacilla alba", ("insect-eater", "urban-tolerant"),
      "Runs and bobs after insects on open ground, shores and town streets.",
      (wiki("White_wagtail"),), (r"insects",)),
    S("Riparia riparia", ("flowing-water", "insect-eater"),
      "Nests in colonies in holes dug into sandy river banks and hunts flying insects over water.",
      (bto("sand-martin", "Sand Martin"), wiki("Sand_martin")), (r"colon", r"bank")),
    # --- reedbeds and waterside vegetation ----------------------------------------------
    S("Acrocephalus scirpaceus", ("reedbed-wetland", "insect-eater"),
      "Summer visitor that nests in reedbeds and sings a steady, chattering song; feeds on insects.",
      (bto("reed-warbler", "Reed Warbler"), wiki("Common_reed_warbler")), (r"reedbed",)),
    S("Acrocephalus arundinaceus", ("reedbed-wetland", "insect-eater"),
      "Large warbler of tall reedbeds along lakes and rivers, with a loud, croaking song.",
      (bto("great-reed-warbler", "Great Reed Warbler"), wiki("Great_reed_warbler")), (r"loud",)),
    S("Acrocephalus schoenobaenus", ("reedbed-wetland", "insect-eater"),
      "Summer visitor that sings from reedbeds and waterside vegetation; feeds on insects.",
      (bto("sedge-warbler", "Sedge Warbler"), wiki("Sedge_warbler"))),
    S("Acrocephalus palustris", ("reedbed-wetland", "insect-eater"),
      "Summer visitor to tall, dense plants near water, famous for copying the songs of many other birds.",
      (bto("marsh-warbler", "Marsh Warbler"), wiki("Marsh_warbler")), (r"mimic|imitat",)),
    S("Emberiza schoeniclus", ("reedbed-wetland",),
      "Sparrow-sized bunting of reedbeds, wet meadows and other damp, tall vegetation.",
      (bto("reed-bunting", "Reed Bunting"), wiki("Common_reed_bunting"))),
    S("Panurus biarmicus", ("reedbed-wetland", "insect-eater"),
      "Lives in large reedbeds, eating insects in summer and reed seeds in winter.",
      (bto("bearded-tit", "Bearded Tit"), wiki("Bearded_reedling")), (r"seeds",)),
    S("Remiz pendulinus", ("reedbed-wetland", "riparian-woodland"),
      "Tiny bird that weaves a hanging nest in trees near water, in reedbeds and along rivers.",
      (bto("penduline-tit", "Penduline Tit"), wiki("Eurasian_penduline_tit")), (r"nest",)),
    S("Cisticola juncidis", ("reedbed-wetland",),
      "Tiny bird of grassland and wetlands, named after the repeated 'zit' calls of its display flight.",
      (bto("zitting-cisticola", "Zitting Cisticola"), wiki("Zitting_cisticola")), (r'"zit" calls', r"grass")),
    # --- trees and scrub along streams, parks and gardens --------------------------------
    S("Troglodytes troglodytes", ("riparian-woodland", "insect-eater", "urban-tolerant"),
      "Tiny bird with a very loud song, living in dense undergrowth from woods to gardens; eats insects and spiders.",
      (bto("wren", "Wren"), wiki("Eurasian_wren")), (r"loud", r"spiders")),
    S("Luscinia megarhynchos", ("riparian-woodland", "insect-eater"),
      "Summer visitor that sings by day and night from dense thickets and scrub; feeds on insects.",
      (bto("nightingale", "Nightingale"), wiki("Common_nightingale")), (r"sing at night",)),
    S("Phylloscopus collybita", ("riparian-woodland", "insect-eater"),
      "Small warbler named after its 'chiff-chaff' song; picks small insects from trees and bushes.",
      (bto("chiffchaff", "Chiffchaff"), wiki("Common_chiffchaff")), (r"chiff",)),
    S("Phylloscopus trochilus", ("riparian-woodland", "insect-eater"),
      "Summer visitor to young woods and scrub with a soft, falling song; eats small insects.",
      (bto("willow-warbler", "Willow Warbler"), wiki("Willow_warbler"))),
    S("Sylvia atricapilla", ("riparian-woodland", "insect-eater", "urban-tolerant"),
      "Rich-voiced warbler of woods, parks and gardens; eats insects in summer and berries later in the year.",
      (bto("blackcap", "Blackcap"), wiki("Eurasian_blackcap")), (r"berr|fruit",)),
    S("Sylvia borin", ("riparian-woodland", "insect-eater"),
      "Plain summer warbler of dense scrub and woodland undergrowth, with a long, flowing song.",
      (bto("garden-warbler", "Garden Warbler"), wiki("Garden_warbler"))),
    S("Hippolais polyglotta", ("riparian-woodland", "insect-eater"),
      "Summer visitor to scrub and bushy places in south-west Europe, with a fast, chattering song.",
      (bto("melodious-warbler", "Melodious Warbler"), wiki("Melodious_warbler"))),
    S("Muscicapa striata", ("riparian-woodland", "insect-eater", "urban-tolerant"),
      "Summer visitor that flies out from a perch to catch flying insects in open woods, parks and gardens.",
      (bto("spotted-flycatcher", "Spotted Flycatcher"), wiki("Spotted_flycatcher")), (r"flying insects|flies",)),
    S("Erithacus rubecula", ("riparian-woodland", "urban-tolerant"),
      "Sings almost all year from woods, parks and gardens; hunts small invertebrates on the ground.",
      (bto("robin", "Robin"), wiki("European_robin")), (r"invertebrates",)),
    S("Turdus merula", ("riparian-woodland", "urban-tolerant"),
      "Common songbird of woods, parks and gardens; feeds on earthworms, insects and berries.",
      (bto("blackbird", "Blackbird"), wiki("Common_blackbird")), (r"earthworms?",)),
    S("Turdus philomelos", ("riparian-woodland", "urban-tolerant"),
      "Repeats each song phrase two to four times from trees in woods, parks and gardens; eats snails and worms.",
      (bto("song-thrush", "Song Thrush"), wiki("Song_thrush")), (r"snails", r"repeated two to four times")),
    S("Aegithalos caudatus", ("riparian-woodland", "insect-eater"),
      "Tiny long-tailed bird that moves through trees and scrub in chattering flocks, eating small insects.",
      (bto("long-tailed-tit", "Long-tailed Tit"), wiki("Long-tailed_tit")), (r"flocks?",)),
    S("Cyanistes caeruleus", ("riparian-woodland", "urban-tolerant"),
      "Small, colourful tit of woods, parks and gardens that feeds its chicks on caterpillars.",
      (bto("blue-tit", "Blue Tit"), wiki("Eurasian_blue_tit")), (r"caterpillars",)),
    S("Parus major", ("riparian-woodland", "urban-tolerant"),
      "Common tit of woods, parks and gardens with a loud, two-note 'teacher-teacher' song.",
      (bto("great-tit", "Great Tit"), wiki("Great_tit")), (r"teacher",)),
    S("Certhia brachydactyla", ("riparian-woodland", "insect-eater"),
      "Creeps up tree trunks in woodland, picking insects from the bark as it climbs.",
      (bto("short-toed-treecreeper", "Short-toed Treecreeper"), wiki("Short-toed_treecreeper")),
      (r"picked from the tree trunk",)),
    S("Sitta europaea", ("riparian-woodland",),
      "Climbs up and down tree trunks, even head first, searching for insects and seeds; also visits bird tables.",
      (bto("nuthatch", "Nuthatch"), wiki("Eurasian_nuthatch")), (r"head first", r"bird tables")),
    S("Dendrocopos major", ("riparian-woodland", "urban-tolerant"),
      "Drums on dead branches in spring; lives in woods, parks and large gardens.",
      (bto("great-spotted-woodpecker", "Great Spotted Woodpecker"), wiki("Great_spotted_woodpecker")),
      (r"drum",)),
    S("Dryobates minor", ("riparian-woodland",),
      "Sparrow-sized woodpecker of open woods with old trees; it has declined in many areas.",
      (bto("lesser-spotted-woodpecker", "Lesser Spotted Woodpecker"),
       wiki("Lesser_spotted_woodpecker")), (r"declin",)),
    S("Picus viridis", ("riparian-woodland", "urban-tolerant"),
      "Feeds mainly on ants on the ground in parks and open woodland; known for its laughing call.",
      (bto("green-woodpecker", "Green Woodpecker"), wiki("European_green_woodpecker")),
      (r"\bants\b", r"laugh|yaffle")),
    S("Garrulus glandarius", ("riparian-woodland",),
      "Colourful woodland crow that buries acorns, spreading more than a thousand of them a year.",
      (bto("jay", "Jay"), wiki("Eurasian_jay")), (r"bury the acorns", r"more than a thousand acorns")),
    S("Oriolus oriolus", ("riparian-woodland",),
      "Summer visitor that sings a fluty whistle from tall trees, such as poplars and woods by rivers.",
      (bto("golden-oriole", "Golden Oriole"), wiki("Eurasian_golden_oriole")), (r"poplar",)),
    S("Strix aluco", ("riparian-woodland", "urban-tolerant"),
      "Owl of woods and parks, heard at night hooting and giving sharp 'ke-wick' calls.",
      (bto("tawny-owl", "Tawny Owl"), wiki("Tawny_owl")), (r"hoot",)),
    S("Fringilla coelebs", ("riparian-woodland", "urban-tolerant"),
      "Very common finch of woods, parks and gardens with a cheerful, descending song.",
      (bto("chaffinch", "Chaffinch"), wiki("Common_chaffinch"))),
    S("Carduelis carduelis", ("urban-tolerant",),
      "Colourful finch that feeds mainly on small seeds and often visits garden feeders.",
      (bto("goldfinch", "Goldfinch"), wiki("European_goldfinch")), (r"seeds", r"bird food provided in gardens")),
    S("Chloris chloris", ("urban-tolerant",),
      "Seed-eating finch of gardens, parks and woodland edges.",
      (bto("greenfinch", "Greenfinch"), wiki("European_greenfinch")), (r"seeds?",)),
    S("Serinus serinus", ("urban-tolerant",),
      "Small yellow finch with a fast, jingling song, often found in parks and gardens.",
      (bto("serin", "Serin"), wiki("European_serin"))),
    # --- birds of towns and the open air -------------------------------------------------
    S("Hirundo rustica", ("insect-eater", "open-water"),
      "Catches flying insects low over fields and water; nests inside barns and other buildings.",
      (bto("swallow", "Swallow"), wiki("Barn_swallow")), (r"buildings|barns",)),
    S("Delichon urbicum", ("insect-eater", "urban-tolerant"),
      "Builds mud nests under the eaves of houses and catches flying insects high in the air.",
      (bto("house-martin", "House Martin"), wiki("Common_house_martin")), (r"\bmud\b", r"eaves"),
      {"urban-tolerant": r"eaves of our homes|on buildings"}),
    S("Apus apus", ("insect-eater", "urban-tolerant"),
      "Spends nearly its whole life flying, feeding on airborne insects; nests in gaps in buildings.",
      (bto("swift", "Swift"), wiki("Common_swift")), (r"buildings",)),
    S("Columba palumbus", ("urban-tolerant",),
      "Large pigeon of farmland, woods, parks and gardens with a soft, repeated cooing song.",
      (bto("woodpigeon", "Woodpigeon"), wiki("Common_wood_pigeon"))),
    S("Streptopelia decaocto", ("urban-tolerant",),
      "Spread across Europe during the 20th century and now lives mostly close to houses and gardens.",
      (bto("collared-dove", "Collared Dove"), wiki("Eurasian_collared_dove")), (r"20th century|1950s|1930s",)),
    S("Sturnus vulgaris", ("urban-tolerant",),
      "Noisy, sociable bird of towns and farmland that copies other sounds in its song.",
      (bto("starling", "Starling"), wiki("Common_starling")), (r"mimic|imitat",)),
    S("Passer domesticus", ("urban-tolerant",),
      "Lives close to people in towns and villages; it has declined in many European cities.",
      (bto("house-sparrow", "House Sparrow"), wiki("House_sparrow")), (r"declin",)),
    S("Pica pica", ("urban-tolerant",),
      "Black-and-white member of the crow family, common in towns, parks and farmland.",
      (bto("magpie", "Magpie"), wiki("Eurasian_magpie"))),
    S("Corvus corone", ("urban-tolerant",),
      "All-black crow that eats almost anything and is common in towns, parks and farmland.",
      (bto("carrion-crow", "Carrion Crow"), wiki("Carrion_crow"))),
    # --- introduced species ---------------------------------------------------------------
    S("Psittacula krameri", ("non-native", "urban-tolerant"),
      "Parrot from Africa and South Asia, now living wild in many European cities after birds escaped or were released.",
      (bto("ring-necked-parakeet", "Ring-necked Parakeet"), wiki("Rose-ringed_parakeet")),
      (r"Africa", r"India|Asia")),
    S("Alopochen aegyptiaca", ("non-native", "open-water"),
      "African goose introduced to Europe, now breeding around lakes, rivers and park ponds.",
      (bto("egyptian-goose", "Egyptian Goose"), wiki("Egyptian_goose")), (r"native to sub-Saharan Africa",)),
    S("Branta canadensis", ("non-native", "open-water", "urban-tolerant"),
      "North American goose introduced to Europe, common on lakes and park ponds.",
      (bto("canada-goose", "Canada Goose"), wiki("Canada_goose")), (r"North America",)),
    S("Estrilda astrild", ("non-native", "reedbed-wetland"),
      "Small African finch introduced to Portugal, living in reeds and tall grass, often near water.",
      (wiki("Common_waxbill"),
       doi("10.1046/j.1472-4642.2002.00156.x", "Silva, Reino & Borralho (2002). A model for range expansion of "
           "an introduced species: the common waxbill Estrilda astrild in Portugal. Diversity and "
           "Distributions 8: 319-326")),
      (r"Portugal", r"Africa", r"long grass")),
    # --- amphibians -------------------------------------------------------------------------
    S("Hyla meridionalis", ("amphibian", "insect-eater", "open-water"),
      "Tree frog whose males call in chorus at night from ponds; adults feed on insects.",
      (wiki("Hyla_meridionalis"), evve("hylmer", "Hyla meridionalis")), (r"night|nocturn|noche", r"chorus|coros?\b"),
      en='Mediterranean Tree Frog'),
    S("Hyla molleri", ("amphibian", "open-water", "insect-eater"),
      "Small green tree frog of Iberia and south-west France; males call at night from ponds.",
      (wiki("Hyla_molleri"), evve("hylmol", "Hyla molleri")), (r"Iberia|Ibérica", r"France|Francia", r"night|noche"),
      en='Iberian Tree Frog'),
    S("Hyla arborea", ("amphibian", "insect-eater", "open-water"),
      "Small green frog that climbs in bushes and trees and calls loudly from ponds in spring.",
      (wiki("Hyla_arborea"),), (r"climb",),
      en='European Tree Frog'),
    S("Hyla intermedia", ("amphibian", "insect-eater", "open-water"),
      "Tree frog of Italy and nearby countries; males call near ponds in the breeding season, and it eats "
      "small insects such as flies.",
      (wiki("Hyla_intermedia"),), (r"Italy", r"\bflies\b", r"territories near a pond"),
      en='Italian Tree Frog'),
    S("Bufo bufo", ("amphibian", "insect-eater", "open-water"),
      "Returns each spring to breed in the same ponds, often crossing roads; eats insects, slugs and worms.",
      (wiki("Bufo_bufo"), arc("common-toad", "Common toad")), (r"roads?", r"slugs"),
      en='Common Toad'),
    S("Bufo spinosus", ("amphibian", "insect-eater", "open-water", "flowing-water", "urban-tolerant"),
      "Large toad that lives on land, even in towns, and visits ponds, rivers and streams mainly to breed; "
      "eats ants and other insects.",
      (wiki("Bufo_spinosus"), evve("bufspi", "Bufo spinosus")), (r"reproducirse|to breed", r"hormigas|\bants\b"),
      en='Spiny Toad'),
    S("Epidalea calamita", ("amphibian", "open-water"),
      "Toad of sandy, open places that breeds in shallow, warm pools; males have a very loud call.",
      (wiki("Epidalea_calamita"), arc("natterjack-toad", "Natterjack toad")), (r"shallow", r"loud"),
      en='Natterjack Toad'),
    S("Alytes obstetricans", ("amphibian",),
      "Males carry the eggs wrapped around their back and thighs until they are ready to hatch.",
      (wiki("Alytes_obstetricans"), evve("alyobs", "Alytes obstetricans")), (r"eggs", r"back and thighs"),
      en='Common Midwife Toad'),
    S("Pelophylax perezi", ("amphibian", "open-water", "flowing-water"),
      "Common green frog of Iberia and southern France, found in almost any water, from rivers to ponds.",
      (wiki("Pelophylax_perezi"),), (r"Iberia|Spain|Portugal",),
      en="Perez's Frog"),
    S("Pelophylax ridibundus", ("amphibian", "open-water", "flowing-water"),
      "Large green frog of deep ponds, lakes and rivers; highly adaptable, it even lives in fish ponds.",
      (wiki("Pelophylax_ridibundus"),), (r"highly adaptable", r"fish ponds"),
      {"open-water": r"deep ponds|large lakes", "flowing-water": r"active rivers|flowing bodies of water"},
      en='Marsh Frog'),
    S("Pelophylax lessonae", ("amphibian", "open-water"),
      "Small green frog of shallow, still water such as ditches, ponds and lakes, often with dense vegetation.",
      (wiki("Pelophylax_lessonae"), arc("pool-frog", "Pool frog")), (r"dense vegetation",),
      {"open-water": r"ditches, ponds and lakes"},
      en='Pool Frog'),
    S("Pelophylax esculentus", ("amphibian",),
      "Green frog that arises from crosses between pool frogs and marsh frogs.",
      (wiki("Pelophylax_esculentus"),), (r"hybrid", r"lessonae", r"ridibundus"),
      en='Edible Frog'),
    S("Rana temporaria", ("amphibian", "insect-eater", "open-water", "urban-tolerant"),
      "Brown frog that breeds early in spring in ponds, including garden ponds; adults eat insects, slugs and worms.",
      (wiki("Rana_temporaria"), arc("common-frog", "Common frog")), (r"garden ponds?", r"slugs"),
      en='Common Frog'),
    S("Rana dalmatina", ("amphibian", "riparian-woodland"),
      "Long-legged brown frog of damp deciduous woods that breeds in ponds and ditches.",
      (wiki("Rana_dalmatina"),), (r"long legs|long-legged|hind legs",),
      en='Agile Frog'),
    S("Bufotes viridis", ("amphibian", "urban-tolerant"),
      "Green-spotted toad of steppes, dry open land and even urban areas; it prefers warm summers.",
      (wiki("Bufotes_viridis"),), (r"urban areas", r"warm summers"),
      en='European Green Toad'),
]


# BTO pages embed the A-Z species menu ("Kingfisher - Alcedo atthis Knot - ...") before and after
# the article; those names would otherwise match patterns such as "pond" or "garden".
_BTO_SPECIES_MENU = re.compile(r"(?:[A-Z][A-Za-z'’ /-]{1,40}? - [A-Z][a-z]+ [a-z]+(?: [a-z]+)? ){8,}")


def main_text(url: str, text: str, sci: str = "") -> str:
    """Keep only the article text where the page layout is known."""
    if "arc-trust.org" in url:  # menu before the species name, postal address in the footer
        start = text.lower().find(sci.lower()) if sci else -1
        text = text[start:] if start >= 0 else text
        end = text.find("Amphibian and Reptile Conservation 744")
        return text[:end] if end > 0 else text
    if "bto.org" in url:
        start = text.find("Introduction")  # the heading itself would match "introduc(ed)"
        text = text[start + len("Introduction"):] if start >= 0 else text
        menu = _BTO_SPECIES_MENU.search(text)
        return text[: menu.start()] if menu else text
    return text


# A keyword directly followed by one of these words is part of a species name
# ("Reed Warbler", "Garden Warbler", "Night Heron", "Water Rail", "Pond Heron"), not evidence.
_NAME_TAIL = re.compile(
    r"[\s-]*(warblers?|buntings?|herons?|rails?|martins?|tits?|pipits?|sparrows?|grebes?|gulls?|geese|goose|"
    r"ducks?|swans?|egrets?|pigeons?|doves?|owls?|harriers?|sandpipers?|wagtails?|thrush(es)?|robins?|"
    r"wrens?|finch(es)?|creepers?|hens?|jays?|frogs?|toads?|snakes?|voles?|shrews?|beetles?)\b", re.I)


def first_match(rx: re.Pattern[str], text: str) -> re.Match[str] | None:
    for m in rx.finditer(text):
        if not _NAME_TAIL.match(text, m.end()):
            return m
    return None


def find_evidence(sp: Species, texts: dict[str, str],
                  per_check: int = 2) -> tuple[dict[str, list[dict[str, str]]], list[str]]:
    """First passage (±90 characters) matching each tag/claim pattern in each source, up to `per_check`."""
    checks = {f"tag:{t}": sp.tag_patterns.get(t, TAG_PATTERNS[t]) for t in sp.tags}
    checks |= {f"claim:{c}": c for c in sp.claims}
    if sp.en:  # the English name must appear in a source, hyphens and spaces interchangeable
        checks[f"name:{sp.en}"] = r"[\s-]".join(map(re.escape, re.split(r"[\s-]", sp.en)))
    evidence, missing = {}, []
    for key, pattern in checks.items():
        rx = re.compile(pattern, re.I)
        found = []
        for url, text in texts.items():
            m = first_match(rx, text)
            if m:
                a, b = max(0, m.start() - 90), min(len(text), m.end() + 90)
                found.append({"url": url, "quote": text[a:b].strip()})
            if len(found) == per_check:
                break
        if found:
            evidence[key] = found
        else:
            missing.append(key)
    return evidence, missing


def in_range(label_idx: int) -> list[str]:
    return [c for c in OAH_CITIES
            if label_idx in set(read_json(DATA_DIR / "range" / f"{c}.json")["yearRound"])]


def main() -> None:
    by_sci = acoustic_index_by_sci()
    labels = acoustic_labels()
    entries, evidence_out, problems = [], [], 0
    for sp in SPECIES:
        assert set(sp.tags) <= set(TAGS), sp.sci
        idx = by_sci[sp.sci]
        texts, failed = {}, []
        for src in sp.sources:
            text, status = fetch_text(src["url"])
            if text is None:
                failed.append(f"{src['url']} ({status})")
            else:
                texts[src["url"]] = main_text(src["url"], text, sp.sci)
        evidence, missing = find_evidence(sp, texts)
        cities = in_range(idx)
        words = len(sp.meaning.split())
        # A source that cannot be fetched is dropped from the entry; the entry only needs review
        # if what remains does not support every tag and claim.
        needs_review = bool(missing or not texts or not cities or words > MAX_WORDS)
        problems += needs_review
        if needs_review or failed:
            print(f"{'REVIEW' if needs_review else 'note'} {sp.sci}: missing={missing} failed={failed} "
                  f"cities={cities} words={words}", flush=True)
        entries.append({
            "sci": sp.sci, "labelIdx": idx, "en": sp.en or labels[idx].en, "tags": list(sp.tags),
            "meaning": sp.meaning, "sources": [s for s in sp.sources if s["url"] in texts],
            "needsReview": needs_review,
        })
        evidence_out.append({"sci": sp.sci, "inRangeLists": cities, "missing": missing,
                             "fetchFailed": failed, "evidence": evidence})
    write_json(OUT, entries)
    write_json(EVIDENCE_OUT, evidence_out)
    n_amph = sum("amphibian" in e["tags"] for e in entries)
    print(f"{len(entries)} species ({n_amph} amphibians), {problems} need review -> {OUT}")


if __name__ == "__main__":
    main()
