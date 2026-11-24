// ==UserScript==
// @name         D&D World Generator for Azgaar's Fantasy Map Generator
// @namespace    brainwaves
// @version      1.0.0
// @description  Configure every part of a new Azgaar world and fill it with D&D adventure sites, pantheons and peoples.
// @match        https://azgaar.github.io/Fantasy-Map-Generator/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * HOW TO USE
 *  1. Open https://azgaar.github.io/Fantasy-Map-Generator/ and wait for the first map to appear.
 *  2. Open the browser console (F12, then "Console").
 *  3. Paste this whole file and press Enter. A new world is generated with CONFIG below.
 *
 *  After that you can call it again from the console with different settings:
 *     DnDWorld.generate({ preset: "archipelago", seed: "12345" })
 *     DnDWorld.generate({ realms: { count: 6 }, adventures: { count: 60 } })
 *     DnDWorld.presets           // the ready-made worlds
 *     DnDWorld.describe()        // a summary of the world on screen
 *     DnDWorld.exportJson()      // download the Full JSON (BrainWaves imports this)
 *
 *  Installed as a userscript (Tampermonkey / Violentmonkey) it adds a "D&D World" button to the
 *  generator instead, with a box for your settings.
 *
 *  Every setting is optional. A missing setting, or null, takes the preset's value; with none, the
 *  generator rolls it as usual (or keeps a value you locked in the generator). Your own locks are put
 *  back when the script is done.
 *
 *  Written for Fantasy Map Generator v1.158. It uses the generator's console API (window.FMG).
 */

(() => {
  "use strict";

  // ---------------------------------------------------------------------------------------------
  // CONFIG: edit this. Everything is optional. null means "the preset's value", or, where the preset
  // has none, "let the generator roll it".
  // ---------------------------------------------------------------------------------------------
  const CONFIG = {
    preset: "classic", // a starting point from PRESETS below; your settings here override it

    seed: null, // a fixed seed gives the same world again with the same settings, e.g. "998491217"

    map: {
      width: null, // canvas in pixels; null = your browser window
      height: null,
      cells: 10000, // detail: 1000, 2000, 5000, 10000, 20000 ... 100000 (more is slower)
      sampling: "square", // grid layout: square, hexPointy, hexFlat, diamond, triangle
      jitter: 0.9 // 0 (regular) to 0.9 (natural)
    },

    terrain: {
      template: null, // volcano, highIsland, lowIsland, continents, archipelago, atoll, mediterranean,
      //                 peninsula, pangea, isthmus, shattered, taklamakan, oldWorld, fractious,
      //                 or a name from customTemplates
      customTemplates: {}, // { myLand: "Hill 1 90-99 60-80 45-55\nSmooth 2 0 0 0\nMask 3 0 0 0" }
      mapSize: null, // percent of the globe the map shows, 1-100
      latitude: null, // 0 (far north) to 100 (far south); 50 is the equator
      longitude: null, // 0-100
      lakeElevationLimit: null, // 0-80: how high depressions may fill with lakes
      resolveDepressionsSteps: null // 0-500
    },

    climate: {
      equator: null, // °C at the equator
      northPole: null, // °C at the north pole
      southPole: null,
      precipitation: null, // percent, 100 = normal; lower makes deserts, higher makes jungles and swamps
      winds: null // six directions in degrees, north to south bands, e.g. [225, 45, 225, 315, 135, 315]
    },

    // Rename biomes or change how livable they are. Keys are biome names or ids:
    // 1 Hot desert, 2 Cold desert, 3 Savanna, 4 Grassland, 5 Tropical seasonal forest,
    // 6 Temperate deciduous forest, 7 Tropical rainforest, 8 Temperate rainforest, 9 Taiga,
    // 10 Tundra, 11 Glacier, 12 Wetland
    biomes: {
      // "Wetland": { name: "Fenlands", habitability: 8 },
      // "Glacier": { name: "Frozen Wastes" }
    },

    // The peoples of the world. Either a built-in set, or your own list (up to 17 peoples).
    peoples: {
      set: null, // world, european, oriental, english, antique, highFantasy, darkFantasy, random
      count: null, // how many to place; null = random
      list: null, // "set" = the set's own peoples, "dnd" = the D&D peoples below, or your own array:
      //   [{ name: "Elves of the Vale", race: "Elf", nameBase: "Elven", habitat: "forest",
      //      development: 34, odd: 1 }, ...]
      //   habitat: any, forest, deepForest, mountains, hills, plains, coast, river, desert, swamp,
      //            cold, warm, jungle, wastes
      //   nameBase: one of the generator's name bases (German, English, ..., Human Generic, Elven,
      //            Dark Elven, Dwarven, Goblin, Orc, Giant, Draconic, Arachnid, Serpents, Levantine)
      //            or one you add in nameBases below
      development: { min: null, max: null } // clamp technology, e.g. { min: 12, max: 35 } keeps out gunpowder (36)
    },

    // Your own name lists, used by peoples above. At least ~30 names make good results.
    nameBases: [
      // { name: "Halfling", names: ["Bramblebank", "Thistledown", ...], min: 5, max: 12 }
    ],

    realms: {
      count: null, // number of states, 0-100
      sizeVariety: null, // 0-10: how different realms are in size
      growthRate: null, // 0.1-2: how far realms and peoples spread before stopping
      provincesRatio: null // 0-100: provinces per realm
    },

    settlements: {
      count: null // 1-999, or 1000 = as many as the land supports
    },

    religions: {
      count: null, // organized religions, 0-50
      pantheon: "dnd", // null = keep the generated gods, "dnd" = the pantheon below, or your own array
      cultPatrons: "dnd", // dark powers worshipped by cults, same choices
      rename: true // rename churches and cults after their god, e.g. "Church of Aurelion"
    },

    lore: {
      name: null, // the world's name
      description: null,
      year: null,
      era: null, // e.g. "Age of Embers"
      eraShort: null // e.g. "AE"
    },

    units: {
      distanceUnit: "mi", // km, mi, lg (leagues), vr (versts) or your own
      distanceScale: null, // distance units per pixel
      areaUnit: null, // "square" or your own
      heightUnit: "ft", // m, ft, f (fathoms)
      heightExponent: null,
      temperatureScale: null, // °C, °F, K ...
      currency: "gp",
      populationRate: null, // people per population point, default 1000
      urbanization: null, // 0.01-5
      urbanDensity: null // 1-200
    },

    // Military unit types: null = keep, "default" = the generator's, "dnd" = fantasy troops, or your own list
    military: "dnd",

    // Ways to travel used by journeys: null = keep, "default", "dnd" (no trains or planes), or your own list
    transports: "dnd",

    // The generator's own points of interest (dungeons, ruins, inns, monsters, portals ...).
    markers: {
      multiplier: 1, // 0 = none of them, 2 = twice as many
      types: {} // per type, e.g. { dungeons: 3, portals: 2, "train-stations": 0, inns: 0.5 }
      // types: volcanoes hot-springs water-sources guild-halls mines bridges merchant-houses inns
      //        lighthouses waterfalls battlefields dungeons lake-monsters sea-monsters hill-monsters
      //        sacred-mountains sacred-forests sacred-pineries sacred-palm-groves brigands pirates
      //        statues ruins libraries circuses jousts fairs customs-houses canoes migration dances
      //        mirage caves portals rifts disturbed-burials necropolises encounters party
    },

    // Wars, plagues, rebellions and disasters drawn as zones. 0 = none, 1 = normal, 2 = twice as many
    zones: 1,

    // D&D adventure sites, added as markers with a tier, levels, challenge ratings and a hook
    adventures: {
      enabled: true,
      count: null, // null = about one site per 250 land cells
      tiers: [0.45, 0.75, 0.92], // share of the land in tier 1, up to tier 2, up to tier 3; the rest is tier 4
      sites: {}, // weights per site type (see SITES below), e.g. { dragonLair: 3, banditCamp: 0 }
      startingTown: true, // mark a quiet town in tier 1 lands as where the party begins
      icon: true // use each site's own emoji (false = the generator's default pin)
    },

    display: {
      style: null, // default, ink, ancient, cinderwood, clean, atlas, light, pale, watercolor,
      //              frostbite, gloom, darkSeas, cyberpunk, night, monochrome
      layers: "poi" // political, cultural, religions, provinces, biomes, heightmap, physical, poi,
      //               goods, trade, military, emblems, landmass, or an array of layer ids
    },

    // Roll again until the world meets these (ignored when a seed is set)
    requirements: {
      minRealms: null,
      minSettlements: null,
      minLand: null, // share of the map that is land, 0-1
      maxLand: null,
      maxAttempts: 5
    },

    export: {
      json: false // true downloads the Full JSON when done (for BrainWaves: Import Azgaar world)
    }
  };

  // ---------------------------------------------------------------------------------------------
  // PRESETS: starting points. Anything in CONFIG overrides them.
  // ---------------------------------------------------------------------------------------------
  const PRESETS = {
    classic: {
      // a temperate continent or two, many realms: the usual sword-and-sorcery world
      terrain: { template: "continents" },
      climate: { equator: 27, northPole: -25, southPole: -20, precipitation: 110 },
      peoples: { list: "dnd", count: 12, development: { min: 10, max: 34 } },
      realms: { count: 16, sizeVariety: 4, growthRate: 1.2 },
      religions: { count: 7 }
    },
    archipelago: {
      // island kingdoms, pirates and sea monsters
      terrain: { template: "archipelago" },
      climate: { equator: 30, northPole: -10, southPole: -10, precipitation: 130 },
      peoples: { list: "dnd", count: 10, development: { min: 12, max: 33 } },
      realms: { count: 14 },
      markers: { types: { pirates: 3, "sea-monsters": 3, lighthouses: 2 } },
      adventures: { sites: { sunkenTemple: 4, smugglersCove: 4 } }
    },
    frontier: {
      // a few small realms on the edge of a vast wilderness: a West Marches campaign
      terrain: { template: "pangea" },
      peoples: { list: "dnd", count: 8, development: { min: 8, max: 30 } },
      realms: { count: 4, sizeVariety: 2, growthRate: 0.5, provincesRatio: 40 },
      settlements: { count: 120 },
      adventures: { count: 90, tiers: [0.25, 0.55, 0.85] }
    },
    grimdark: {
      // cold, dying lands with dark cults
      terrain: { template: "oldWorld" },
      climate: { equator: 18, northPole: -35, southPole: -30, precipitation: 90 },
      peoples: { set: "darkFantasy", list: null, development: { min: 10, max: 33 } },
      religions: { count: 8 },
      zones: 2,
      markers: { types: { necropolises: 3, "disturbed-burials": 3, battlefields: 2 } },
      adventures: { sites: { hauntedCrypt: 4, cultHideout: 4, lichTower: 2 } },
      display: { style: "gloom" }
    },
    desert: {
      // sun-scorched sands and river kingdoms
      terrain: { template: "taklamakan" },
      climate: { equator: 35, northPole: 5, southPole: 5, precipitation: 45 },
      peoples: { list: "dnd", count: 9, development: { min: 12, max: 34 } },
      adventures: { sites: { buriedTomb: 5, dragonLair: 2 } }
    },
    northlands: {
      // frost giants, barrows and long winters
      terrain: { template: "highIsland", latitude: 15 },
      climate: { equator: 12, northPole: -40, southPole: -35, precipitation: 100 },
      peoples: { list: "dnd", count: 8, development: { min: 9, max: 30 } },
      adventures: { sites: { barrowMound: 4, giantSteading: 4 } }
    },
    random: {} // the generator decides everything; the D&D extras still apply
  };

  // ---------------------------------------------------------------------------------------------
  // D&D DATA: peoples, gods, troops and adventure sites. Edit freely.
  // ---------------------------------------------------------------------------------------------
  const DND_PEOPLES = [
    { name: "Highvale Humans", race: "Human", nameBase: "English", habitat: "plains", development: 32 },
    { name: "Southern Humans", race: "Human", nameBase: "Castillian", habitat: "warm", development: 33 },
    { name: "Northmen", race: "Human", nameBase: "Nordic", habitat: "cold", development: 29 },
    { name: "Sand Nomads", race: "Human", nameBase: "Arabic", habitat: "desert", development: 26 },
    { name: "Wood Elves", race: "Elf", nameBase: "Elven", habitat: "deepForest", development: 34 },
    { name: "High Elves", race: "Elf", nameBase: "Elven", habitat: "forest", development: 36, odd: 0.7 },
    { name: "Shadow Elves", race: "Elf", nameBase: "Dark Elven", habitat: "mountains", development: 33, odd: 0.6 },
    { name: "Mountain Dwarves", race: "Dwarf", nameBase: "Dwarven", habitat: "mountains", development: 34 },
    { name: "Hill Dwarves", race: "Dwarf", nameBase: "Dwarven", habitat: "hills", development: 32 },
    { name: "Halflings", race: "Halfling", nameBase: "Halfling", habitat: "river", development: 30 },
    { name: "Gnomes", race: "Gnome", nameBase: "Gnome", habitat: "hills", development: 35, odd: 0.7 },
    { name: "Orc Clans", race: "Orc", nameBase: "Orc", habitat: "wastes", development: 16 },
    { name: "Goblinkin", race: "Goblin", nameBase: "Goblin", habitat: "swamp", development: 14 },
    { name: "Dragonborn", race: "Dragonborn", nameBase: "Draconic", habitat: "mountains", development: 30, odd: 0.6 },
    { name: "Lizardfolk", race: "Lizardfolk", nameBase: "Serpents", habitat: "jungle", development: 15, odd: 0.7 },
    { name: "Hill Giants", race: "Giant", nameBase: "Giant", habitat: "cold", development: 10, odd: 0.4 },
    { name: "Tieflings", race: "Tiefling", nameBase: "Levantine", habitat: "coast", development: 33, odd: 0.5 }
  ];

  const DND_NAME_BASES = [
    {
      name: "Halfling",
      min: 5,
      max: 12,
      names: "Applebrook,Bramblebank,Brandywell,Bucklebury,Burrowdown,Butterhollow,Clovermead,Cobbleford,Dimbleton,Fennelwick,Gooseberry,Greenhill,Hazelbrook,Hobbleton,Honeymead,Hollowfield,Kettlebrook,Littlebottom,Meadowbrook,Millhaven,Mossbottom,Nettlewick,Oakbottom,Pebbleford,Puddingham,Quillfeather,Riverbend,Rosehollow,Rushbrook,Sandyford,Shortbank,Smallwood,Strawmeadow,Sweetwater,Tealeaf,Thistledown,Tumbleweed,Underbough,Warmhearth,Willowbank,Wheatfield,Woodmere"
    },
    {
      name: "Gnome",
      min: 5,
      max: 13,
      names: "Bimblebrook,Bixwick,Cogsworth,Dabbledob,Fizzlebang,Gimbleton,Glimmerdell,Glittergold,Gnarlwick,Ironfizz,Klickerton,Mossgear,Nackle,Nimblefinger,Pockleby,Quillobble,Raulnor,Sprocketdale,Thimbleton,Tinkerton,Twiddleby,Whistlecog,Wobbleknock,Zanderby,Zook,Bramblecog,Copperkettle,Dimwhistle,Fiddlestick,Gearholm,Puddlecog,Sparkwhistle,Springhollow,Tockleby,Wizzlewick"
    }
  ];

  // Original gods with 5e cleric domains. Replace with your own.
  const DND_PANTHEON = [
    { name: "Aurelion", title: "the Dawnfather", domains: ["Light", "Life"], alignment: "LG", symbol: "a golden sun disc" },
    { name: "Hestra", title: "Keeper of the Hearth", domains: ["Life", "Peace"], alignment: "NG", symbol: "a flame cupped in two hands" },
    { name: "Verdessa", title: "the Green Mother", domains: ["Nature", "Life"], alignment: "N", symbol: "an oak leaf" },
    { name: "Kordrun", title: "the Anvil Lord", domains: ["Forge", "Knowledge"], alignment: "LN", symbol: "a hammer on an anvil" },
    { name: "Valdric", title: "the Shieldbearer", domains: ["War", "Order"], alignment: "LG", symbol: "a silver tower shield" },
    { name: "Thurgrim", title: "the Stormcaller", domains: ["Tempest", "War"], alignment: "CN", symbol: "three lightning bolts" },
    { name: "Vaelith", title: "Weaver of Names", domains: ["Knowledge", "Arcana"], alignment: "N", symbol: "an open book with a star" },
    { name: "Ysolde", title: "of the Silver Veil", domains: ["Twilight", "Trickery"], alignment: "CG", symbol: "a crescent moon behind a veil" },
    { name: "Kessra", title: "the Quick", domains: ["Trickery"], alignment: "CN", symbol: "a coin with two faces" },
    { name: "Oriel", title: "the Peacemaker", domains: ["Peace", "Order"], alignment: "LG", symbol: "two clasped hands" },
    { name: "Morvayne", title: "the Pale Warden", domains: ["Grave"], alignment: "LN", symbol: "a white raven" },
    { name: "Seraketh", title: "Lady of the Deep", domains: ["Tempest", "Nature"], alignment: "CN", symbol: "a trident and a wave" },
    { name: "Nyxara", title: "Queen of Shadows", domains: ["Death", "Trickery"], alignment: "NE", symbol: "a black star" },
    { name: "Zhaltor", title: "the Iron Tyrant", domains: ["Order", "War"], alignment: "LE", symbol: "a chained fist" }
  ];

  const DND_CULT_PATRONS = [
    { name: "the Hollow Crown", title: "an undying king", domains: ["Death"], alignment: "LE", symbol: "a crown with no head" },
    { name: "the Whispering Deep", title: "a thing beneath the sea", domains: ["Knowledge", "Tempest"], alignment: "CE", symbol: "an eye in a wave" },
    { name: "Ashmother", title: "the fiend of cinders", domains: ["Light", "Death"], alignment: "CE", symbol: "a burning hand" },
    { name: "the Ninefold Flame", title: "a pact-lord of the Hells", domains: ["Trickery", "Order"], alignment: "LE", symbol: "nine flames in a ring" },
    { name: "the Crawling King", title: "lord of rot and vermin", domains: ["Death", "Nature"], alignment: "NE", symbol: "a rat with a crown" },
    { name: "the Eyeless Choir", title: "voices from beyond the stars", domains: ["Knowledge"], alignment: "CE", symbol: "a mouth in a spiral" }
  ];

  // name, rural/urban: share of people who serve, crew, power, type (levies melee ranged mounted machinery naval)
  const DND_MILITARY = [
    { emoji: "🪓", name: "militia", rural: 0, urban: 0, crew: 1, power: 0.5, type: "levies", separate: 0 },
    { emoji: "⚔️", name: "men-at-arms", rural: 0.25, urban: 0.2, crew: 1, power: 1, type: "melee", separate: 0, goods: [59] },
    { emoji: "🏹", name: "archers", rural: 0.12, urban: 0.18, crew: 1, power: 1, type: "ranged", separate: 0, goods: [59] },
    { emoji: "🐴", name: "knights", rural: 0.1, urban: 0.03, crew: 1, power: 2.5, type: "mounted", separate: 0, goods: [18, 55] },
    { emoji: "🔮", name: "battle mages", rural: 0.002, urban: 0.01, crew: 1, power: 6, type: "ranged", separate: 0 },
    { emoji: "🦅", name: "griffon riders", rural: 0.004, urban: 0.004, crew: 1, power: 5, type: "mounted", separate: 0 },
    { emoji: "🪨", name: "siege engines", rural: 0, urban: 0.02, crew: 6, power: 10, type: "machinery", separate: 0, goods: [1, 58] },
    { emoji: "⛵", name: "fleet", rural: 0, urban: 0.015, crew: 100, power: 50, type: "naval", separate: 1, goods: [53] }
  ];

  // speed in km/h (the generator's unit) from the 5e travel paces: 3 mph = 4.8 km/h. The first of
  // each domain is the one new journeys use
  const DND_TRANSPORTS = [
    { name: "On foot (normal pace)", speed: 4.8, domain: "land", hoursPerDay: 8 },
    { name: "On foot (slow pace)", speed: 3.2, domain: "land", hoursPerDay: 8 },
    { name: "On foot (fast pace)", speed: 6.4, domain: "land", hoursPerDay: 8 },
    { name: "Riding horse", speed: 6.4, domain: "land", hoursPerDay: 10 },
    { name: "Wagon", speed: 3.2, domain: "land", hoursPerDay: 8 },
    { name: "Sailing ship", speed: 3.2, domain: "water", hoursPerDay: 24 },
    { name: "Rowboat", speed: 2.4, domain: "water", hoursPerDay: 8 },
    { name: "Keelboat", speed: 1.6, domain: "water", hoursPerDay: 24 },
    { name: "Galley", speed: 6.4, domain: "water", hoursPerDay: 24 },
    { name: "Airship", speed: 12.8, domain: "air", hoursPerDay: 24 },
    { name: "Griffon", speed: 12.8, domain: "air", hoursPerDay: 8 },
    { name: "Teleportation circle", speed: 10000, domain: "air", hoursPerDay: 24 },
    { name: "Stay", speed: 0, domain: "stay", hoursPerDay: 24 }
  ];

  const TIERS = [
    null,
    { levels: "1–4", cr: "1/4–4", label: "Local heroes" },
    { levels: "5–10", cr: "3–9", label: "Heroes of the realm" },
    { levels: "11–16", cr: "8–15", label: "Masters of the realm" },
    { levels: "17–20", cr: "14–24", label: "Masters of the world" }
  ];

  // Biome ids: 1 hot desert, 2 cold desert, 3 savanna, 4 grassland, 5 tropical seasonal forest,
  // 6 temperate forest, 7 rainforest, 8 temperate rainforest, 9 taiga, 10 tundra, 11 glacier, 12 wetland
  // where: biomes, minHeight/maxHeight (20 = sea level, 100 = peaks), coast, river, nearBurg, minTier, maxTier
  const SITES = {
    dungeon: {
      weight: 4, emoji: "🗝️", where: {},
      names: ["The Lost Halls of {N}", "{N}'s Vault", "The Sunless Stair", "The Deep Gate of {N}", "The Labyrinth of {N}"],
      foes: ["goblins and their bugbear chief", "a cult of the {patron}", "animated armor and traps", "kobolds and a young dragon", "a gelatinous cube and its leavings", "ghouls"],
      hook: "A map fragment sold in {town} leads here. Below lies {foe}, and the treasure of {N}."
    },
    ruinedKeep: {
      weight: 3, emoji: "🏚️", where: { minHeight: 25 },
      names: ["Castle {N}", "The Broken Keep", "{N}'s Folly", "Fort {N}", "The Ashen Tower"],
      foes: ["bandits who took the walls", "an ogre and its goblin servants", "a wight and its skeletons", "a band of hobgoblins", "harpies on the broken towers"],
      hook: "The lord of {town} wants the old keep cleared of {foe} before winter."
    },
    banditCamp: {
      weight: 3, emoji: "⛺", where: { nearBurg: 12, maxTier: 2 },
      names: ["The Red Hand Camp", "{N}'s Hideout", "The Hollow Oak Camp", "Wolfstooth Camp"],
      foes: ["bandits and their captain", "deserters from the {state} army", "a gang of thugs and a mage", "gnoll raiders"],
      hook: "Caravans to {town} keep vanishing. The trail leads to {foe}."
    },
    goblinWarren: {
      weight: 3, emoji: "👺", where: { biomes: [4, 6, 8, 9, 12], maxTier: 2 },
      names: ["The Warren of {N}", "Gnashtooth Caves", "The Burrows", "Skullpile Hill"],
      foes: ["goblins and wolves", "goblins led by a hobgoblin warlord", "kobolds and their traps", "bugbears"],
      hook: "Raiders from the warren took livestock and a child from a farm near {town}."
    },
    hauntedCrypt: {
      weight: 3, emoji: "⚰️", where: { minTier: 2 },
      names: ["The Crypt of {N}", "The Silent Barrow", "{N}'s Tomb", "The Weeping Mausoleum"],
      foes: ["a wight and its zombies", "a ghost bound to a broken oath", "ghouls and ghasts", "a mummy and its guardians"],
      hook: "The dead walk near {town}. The priests of {god} trace it to this place."
    },
    dragonLair: {
      weight: 2, emoji: "🐉", where: { minHeight: 45, minTier: 2 },
      names: ["{N}'s Roost", "The Smoking Peak", "The Wyrm's Hollow", "The Scorched Eyrie"],
      foes: ["a {dragon} dragon", "a young {dragon} dragon and its kobold servants", "an adult {dragon} dragon", "wyverns"],
      hook: "{state} offers a fortune for whoever slays {foe} that burns its borders."
    },
    lichTower: {
      weight: 1, emoji: "💀", where: { minTier: 3 },
      names: ["The Tower of {N}", "The Spire of Unlight", "{N}'s Phylactery", "The Bone Citadel"],
      foes: ["a lich and its undead court", "a death knight", "a vampire and its spawn", "a mummy lord"],
      hook: "An ancient evil stirs at the tower of {N}. Its phylactery is said to be hidden elsewhere."
    },
    feyCrossing: {
      weight: 2, emoji: "🧚", where: { biomes: [5, 6, 7, 8] },
      names: ["The Ring of {N}", "The Moonlit Glade", "The Thornwood Gate", "The Laughing Pool"],
      foes: ["a green hag and her bargains", "a dryad and her awakened trees", "pixies and sprites", "a satyr's endless revel"],
      hook: "People from {town} wander into the glade and come back years later, unaged."
    },
    planarRift: {
      weight: 1, emoji: "🌀", where: { minTier: 3 },
      names: ["The Wound of {N}", "The Shattered Sky", "The Bleeding Stone", "The Gate of Ashes"],
      foes: ["demons spilling through", "elementals of raw chaos", "devils who come to bargain", "slaadi"],
      hook: "The sky tore open over {N}. The sages of {town} say the rift is growing."
    },
    sunkenTemple: {
      weight: 2, emoji: "🌊", where: { coast: true },
      names: ["The Drowned Temple of {N}", "The Sunken Shrine", "The Tidegate", "{N}'s Grotto"],
      foes: ["sahuagin raiders", "a sea hag", "merrow", "a chuul and its sunken hoard"],
      hook: "At low tide the spire of a temple to {god} rises from the sea near {town}."
    },
    smugglersCove: {
      weight: 1, emoji: "🏴‍☠️", where: { coast: true, maxTier: 2 },
      names: ["{N}'s Cove", "Black Tide Cove", "The Gull's Nest", "Rumrunner's Cave"],
      foes: ["smugglers and a pirate captain", "pirates and their sea witch", "a gang of thieves"],
      hook: "The harbormaster of {town} pays well to find where the smuggled goods land."
    },
    giantSteading: {
      weight: 1, emoji: "🗿", where: { minHeight: 40, minTier: 2 },
      names: ["The Steading of {N}", "The Hall of {N}", "The Stone Table", "The Frost Hall"],
      foes: ["hill giants and their ogres", "frost giants", "stone giants who play at war", "a fire giant forge"],
      hook: "Giants came down from {N} and smashed the villages near {town}."
    },
    barrowMound: {
      weight: 2, emoji: "⛰️", where: { biomes: [2, 4, 9, 10] },
      names: ["The Barrow of {N}", "King {N}'s Mound", "The Seven Stones", "The Grey Barrows"],
      foes: ["barrow wights", "a cursed king and his guard", "ghouls", "a will-o'-wisp in the mist"],
      hook: "Grave robbers from {town} opened the barrow, and something followed them home."
    },
    buriedTomb: {
      weight: 1, emoji: "🏺", where: { biomes: [1, 2, 3] },
      names: ["The Tomb of {N}", "The Sand-Swallowed Pyramid", "The Sphinx's Gate", "The Glass Tomb"],
      foes: ["mummies and scarab swarms", "a mummy lord", "a sphinx's riddles", "giant scorpions and their nest"],
      hook: "A sandstorm uncovered the tomb of {N}. Treasure hunters from {town} race to it."
    },
    wizardTower: {
      weight: 2, emoji: "🧙", where: { nearBurg: 20 },
      names: ["The Tower of {N}", "The Starlit Spire", "{N}'s Observatory", "The Leaning Tower"],
      foes: ["the wizard's golems and constructs", "a mad wizard and her apprentices", "escaped experiments", "an imp familiar who took over"],
      hook: "The wizard {N} has not been seen for a year, and strange lights burn in the tower."
    },
    cultHideout: {
      weight: 2, emoji: "🕯️", where: { nearBurg: 6 },
      names: ["The Hidden Shrine", "The Cellars of {N}", "The Black Chapel", "The Whispering Catacombs"],
      foes: ["cultists of the {patron}", "a cult fanatic and a summoned fiend", "doppelgangers in the town council", "a coven of hags"],
      hook: "Missing people, strange symbols: a cult of the {patron} hides beneath {town}."
    },
    abandonedMine: {
      weight: 2, emoji: "⛏️", where: { minHeight: 40 },
      names: ["The {N} Mine", "The Deepdelve", "The Collapsed Shaft", "The Glimmering Pit"],
      foes: ["duergar slavers", "a roper in the dark", "an earth elemental", "kobolds and their traps"],
      hook: "The miners of {town} broke into an older tunnel and fled. Something followed."
    },
    beastDen: {
      weight: 2, emoji: "🐾", where: {},
      names: ["The {N} Den", "The Bone Pit", "The Clawmarked Caves", "The Hunting Ground"],
      foes: ["an owlbear and its young", "a manticore", "a pack of dire wolves", "a basilisk", "a chimera", "a hydra"],
      hook: "A beast is killing herds near {town}. The hunters who went after it did not return."
    }
  };
  const DRAGONS_BY_BIOME = { 1: "blue", 2: "blue", 3: "brass", 4: "bronze", 9: "white", 10: "white", 11: "white", 12: "black", 5: "green", 6: "green", 7: "green", 8: "green" };

  // ---------------------------------------------------------------------------------------------
  // Below here is the machinery. You should not need to change it.
  // ---------------------------------------------------------------------------------------------
  const POINTS_BY_DENSITY = { 1: 1000, 2: 2000, 3: 5000, 4: 10000, 5: 20000, 6: 30000, 7: 40000, 8: 50000, 9: 60000, 10: 70000, 11: 80000, 12: 90000, 13: 100000 };
  const BUILTIN_TEMPLATES = ["volcano", "highIsland", "lowIsland", "continents", "archipelago", "atoll", "mediterranean", "peninsula", "pangea", "isthmus", "shattered", "taklamakan", "oldWorld", "fractious"];
  const LOCKS_KEY = "fmg-locks";
  const log = (...args) => console.log("%c[D&D World]", "color:#a33;font-weight:bold", ...args);
  const warn = (...args) => console.warn("[D&D World]", ...args);

  const isObject = value => value && typeof value === "object" && !Array.isArray(value);
  /** extra over base; null and undefined in extra leave the base value */
  function merge(base, extra) {
    const out = { ...base };
    for (const [key, value] of Object.entries(extra || {})) {
      if (value === null || value === undefined) continue;
      out[key] = isObject(value) && isObject(out[key]) ? merge(out[key], value) : value;
    }
    return out;
  }
  const given = value => value !== null && value !== undefined;
  const fmg = () => {
    if (!window.FMG) throw new Error("Open this on https://azgaar.github.io/Fantasy-Map-Generator/ (window.FMG not found).");
    return window.FMG;
  };
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
  const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /** The final settings: the preset, then CONFIG, then what was passed to generate() */
  function resolve(overrides = {}) {
    const presetName = overrides.preset ?? CONFIG.preset ?? "classic";
    const preset = PRESETS[presetName];
    if (!preset) throw new Error(`Unknown preset "${presetName}". Presets: ${Object.keys(PRESETS).join(", ")}`);
    return merge(merge(preset, CONFIG), overrides);
  }

  // ---- locks: the generator re-rolls every value that is not locked when it makes a new map ----
  function setLocks(cfg) {
    const t = cfg.terrain || {}, c = cfg.climate || {}, r = cfg.realms || {}, l = cfg.lore || {}, u = cfg.units || {}, p = cfg.peoples || {};
    const density = cfg.map?.cells ? nearestDensity(cfg.map.cells) : null;
    return {
      mapWidth: cfg.map?.width, mapHeight: cfg.map?.height, points: density,
      template: t.template, mapSize: t.mapSize, latitude: t.latitude, longitude: t.longitude,
      lakeElevationLimit: t.lakeElevationLimit, resolveDepressionsSteps: t.resolveDepressionsSteps,
      temperatureEquator: c.equator, temperatureNorthPole: c.northPole, temperatureSouthPole: c.southPole, prec: c.precipitation,
      cultures: p.count, culturesSet: p.set,
      statesNumber: r.count, sizeVariety: r.sizeVariety, growthRate: r.growthRate, provincesRatio: r.provincesRatio,
      manors: cfg.settlements?.count, religionsNumber: cfg.religions?.count,
      mapName: l.name, year: l.year, era: l.era, eraShort: l.eraShort,
      distanceUnit: u.distanceUnit, distanceScale: u.distanceScale, areaUnit: u.areaUnit, heightUnit: u.heightUnit,
      heightExponent: u.heightExponent, temperatureScale: u.temperatureScale, moneyUnit: u.currency,
      populationRate: u.populationRate, urbanization: u.urbanization, urbanDensity: u.urbanDensity
    };
  }
  function nearestDensity(cells) {
    let best = 4;
    for (const [step, points] of Object.entries(POINTS_BY_DENSITY)) {
      if (Math.abs(points - cells) < Math.abs(POINTS_BY_DENSITY[best] - cells)) best = Number(step);
    }
    return best;
  }
  function applyLocks(locks) {
    const { Pins } = fmg();
    const saved = localStorage.getItem(LOCKS_KEY);
    for (const [key, value] of Object.entries(locks)) {
      if (given(value)) {
        Pins.set(key, value);
        if (!Pins.has(key)) warn(`"${key}" = ${JSON.stringify(value)} is not a valid value; the generator will roll it`);
      } // an empty setting leaves the user's own lock, if any
    }
    return () => {
      // put the user's own locks back
      if (saved === null) localStorage.removeItem(LOCKS_KEY);
      else localStorage.setItem(LOCKS_KEY, saved);
      Pins.changed?.(); // repaint the lock icons
    };
  }

  // ---- temporary patches of generator methods, undone after the map is made ----
  function patcher() {
    const undo = [];
    return {
      wrap(object, method, replacement) {
        const original = object[method];
        const hadOwn = Object.hasOwn(object, method);
        object[method] = function (...args) {
          return replacement.call(this, original.bind(this), ...args);
        };
        undo.push(() => (hadOwn ? (object[method] = original) : delete object[method]));
      },
      step(id, replacement) {
        const steps = fmg().GenerationPipeline.steps;
        const step = steps?.find(s => s.id === id);
        if (!step) return warn(`Generation step "${id}" not found; that setting is skipped`);
        const original = step.run;
        step.run = context => replacement(() => original(context), context);
        undo.push(() => (step.run = original));
      },
      restore() {
        while (undo.length) undo.pop()();
      }
    };
  }

  // ---- peoples ----
  const HABITATS = {
    any: () => 1,
    forest: (c, i) => (bio(c, i, [5, 6, 8]) ? 3 : 1) * (1 + c.s[i] / 10),
    deepForest: (c, i) => (bio(c, i, [6, 7, 8, 9]) ? 4 : 0.5) * (c.h[i] < 50 ? 1 : 0.5),
    mountains: (c, i) => c.h[i] * (c.h[i] > 50 ? 2 : 0.5),
    hills: (c, i) => (c.h[i] >= 35 && c.h[i] <= 60 ? 3 : 0.7) * (1 + c.s[i] / 10),
    plains: (c, i) => (bio(c, i, [3, 4, 6]) && c.h[i] < 40 ? 3 : 1) * (1 + c.s[i] / 5),
    coast: (c, i) => (c.t[i] === 1 ? 4 : 0.5) * (1 + c.s[i] / 10),
    river: (c, i) => (c.r?.[i] ? 4 : 0.6) * (1 + c.s[i] / 5),
    desert: (c, i) => (bio(c, i, [1, 2, 3]) ? 5 : 0.3),
    swamp: (c, i) => (bio(c, i, [12]) ? 6 : bio(c, i, [7, 8]) ? 2 : 0.5),
    cold: (c, i) => (bio(c, i, [9, 10, 11]) ? 5 : temp(i) < 5 ? 2 : 0.4),
    warm: (c, i) => (temp(i) > 18 ? 3 : 0.6) * (1 + c.s[i] / 10),
    jungle: (c, i) => (bio(c, i, [5, 7, 12]) ? 5 : 0.4),
    wastes: (c, i) => (bio(c, i, [1, 2, 10]) ? 3 : 1) * (c.s[i] < 5 ? 2 : 1)
  };
  const bio = (cells, i, ids) => ids.includes(cells.biome[i]);
  const temp = i => fmg().grid.cells.temp[fmg().pack.cells.g[i]];

  function addNameBases(list) {
    const { Names } = fmg();
    for (const base of list || []) {
      const names = Array.isArray(base.names) ? base.names.join(",") : String(base.names || "");
      if (!base.name || names.split(",").length < 5) {
        warn(`Name base "${base.name}" needs a name and at least 5 names; skipped`);
        continue;
      }
      const existing = Names.nameBases.findIndex(b => b.name === base.name);
      const i = existing >= 0 ? existing : Names.nameBases.length;
      Names.nameBases[i] = { name: base.name, i, min: base.min ?? 5, max: base.max ?? 12, d: base.d ?? "", m: 0, b: names };
      Names.updateChain(i);
    }
  }
  function nameBaseIndex(name) {
    if (typeof name === "number") return name;
    const index = fmg().Names.nameBases.findIndex(b => b.name.toLowerCase() === String(name || "").toLowerCase());
    if (index < 0) warn(`Name base "${name}" not found, using Human Generic`);
    return index >= 0 ? index : Math.max(0, fmg().Names.nameBases.findIndex(b => b.name === "Human Generic"));
  }
  function buildPeoples(list) {
    const shields = ["heater", "spanish", "french", "round", "oval", "wedged", "gonfalon", "pavise", "kite", "swiss", "noldor", "gondor", "fantasy1", "fantasy2"];
    return list.slice(0, 17).map((p, index) => {
      const habitat = HABITATS[p.habitat] || HABITATS.any;
      if (!HABITATS[p.habitat] && p.habitat) warn(`Habitat "${p.habitat}" unknown for ${p.name}; using any`);
      return {
        name: p.name,
        ancestry: p.race || p.ancestry,
        base: nameBaseIndex(p.nameBase),
        development: p.development ?? 30,
        odd: p.odd ?? 1,
        shield: p.shield || shields[index % shields.length],
        sort: i => {
          const c = fmg().pack.cells;
          return habitat(c, i) * (c.s[i] || 0.1);
        }
      };
    });
  }

  // ---- the generation ----
  let running = false;

  async function generate(overrides = {}) {
    if (running) throw new Error("A world is already being generated");
    const F = fmg();
    if (F.options.app.mode) throw new Error("Leave the edit mode you are in first");
    running = true;
    const cfg = resolve(overrides);
    const req = cfg.requirements || {};
    const attempts = cfg.seed ? 1 : Math.max(1, req.maxAttempts || 1);
    try {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        await generateOnce(cfg);
        const failed = checkRequirements(req);
        if (!failed) break;
        if (attempt === attempts) warn(`Kept the last world after ${attempts} attempts (${failed})`);
        else log(`Rolling again: ${failed}`);
      }
      await decorate(cfg);
      const summary = describe();
      log("Done.", summary);
      if (cfg.export?.json) exportJson();
      return summary;
    } finally {
      running = false;
    }
  }

  async function generateOnce(cfg) {
    const F = fmg();
    const patch = patcher();
    const restoreLocks = applyLocks(setLocks(cfg));
    try {
      // custom heightmap templates
      for (const [id, steps] of Object.entries(cfg.terrain?.customTemplates || {})) {
        F.heightmapTemplates[id] = { id: 100 + Object.keys(F.heightmapTemplates).length, name: id, template: String(steps).trim(), probability: 0 };
      }
      const template = cfg.terrain?.template;
      if (template && !(template in F.heightmapTemplates)) warn(`Unknown template "${template}". Known: ${Object.keys(F.heightmapTemplates).join(", ")}`);

      // the graph request the generator does not re-roll
      if (cfg.map?.sampling) F.options.generation.graph.sampling = cfg.map.sampling;
      if (given(cfg.map?.jitter)) F.options.generation.graph.jitter = Math.min(0.9, Math.max(0, cfg.map.jitter));

      // definition sets: the next map starts from these
      setDefinitionSets(cfg);

      // values set after the generator's own re-roll, before the terrain is made
      patch.step("grid", run => {
        const { climate } = F.options.map;
        if (Array.isArray(cfg.climate?.winds) && cfg.climate.winds.length === 6) climate.winds = cfg.climate.winds.map(Number);
        if (given(cfg.lore?.description)) F.options.map.lore.description = cfg.lore.description;
        return run();
      });

      // biomes
      const biomeEdits = cfg.biomes || {};
      if (Object.keys(biomeEdits).length) {
        patch.wrap(F.Biomes, "getDefault", original => {
          const biomes = original();
          for (const [key, edit] of Object.entries(biomeEdits)) {
            const biome = biomes.find(b => String(b.i) === String(key) || b.name.toLowerCase() === String(key).toLowerCase());
            if (!biome) warn(`Biome "${key}" not found`);
            else Object.assign(biome, edit);
          }
          return biomes;
        });
      }

      // peoples
      addNameBases(cfg.nameBases);
      const peoples = cfg.peoples || {};
      let list = peoples.list === "dnd" ? DND_PEOPLES : Array.isArray(peoples.list) ? peoples.list : null;
      if (list) {
        if (peoples.list === "dnd") addNameBases(DND_NAME_BASES);
        F.options.generation.cultures.set = "highFantasy"; // a fantasy set: the generator places fantasy markers for it
        F.Pins.set("culturesSet", "highFantasy");
        if (!given(peoples.count)) F.Pins.set("cultures", Math.min(list.length, 17));
        else F.Pins.set("cultures", Math.min(peoples.count, list.length, 17));
      }
      const dev = peoples.development || {};
      if (list || given(dev.min) || given(dev.max)) {
        const built = list ? buildPeoples(list) : null;
        patch.wrap(F.Cultures, "getDefault", (original, count, set) => {
          const cultures = built && (set === undefined || set === "highFantasy") ? built.map(c => ({ ...c })) : original(count, set);
          for (const culture of cultures) {
            if (typeof culture.development !== "number") continue;
            if (given(dev.min)) culture.development = Math.max(dev.min, culture.development);
            if (given(dev.max)) culture.development = Math.min(dev.max, culture.development);
          }
          return cultures;
        });
      }

      // the generator's markers
      const markers = cfg.markers || {};
      if (given(markers.multiplier) || Object.keys(markers.types || {}).length) {
        patch.wrap(F.Markers, "getDefaultConfig", original => {
          const config = original();
          for (const entry of config) {
            const own = markers.types?.[entry.type];
            entry.multiplier = (given(own) ? own : 1) * (markers.multiplier ?? 1);
          }
          return config;
        });
      }

      // zones
      if (given(cfg.zones) && cfg.zones !== 1) {
        patch.step("zones", (run) => (cfg.zones > 0 ? F.Zones.generate(cfg.zones) : (F.pack.zones = [])));
      }

      await new Promise((resolveMap, reject) => {
        const fail = error => {
          clearTimeout(timeout);
          removeEventListener("map:generated", done);
          reject(error);
        };
        const timeout = setTimeout(() => fail(new Error("The map was not generated in 10 minutes")), 10 * 60 * 1000);
        function done() {
          clearTimeout(timeout);
          resolveMap();
        }
        // the generator shows its own error dialog and sends no event: hear about it here
        let started = false;
        patch.wrap(F.GenerationPipeline, "run", async (original, context) => {
          started = true;
          try {
            return await original(context);
          } catch (error) {
            fail(new Error(`The generator failed: ${error.message}`));
            throw error;
          }
        });
        addEventListener("map:generated", done, { once: true });
        // the generator ignores a call within 250 ms of the last one, so ask again until it starts
        const request = cfg.seed ? { seed: String(cfg.seed) } : "D&D World script";
        const ask = tries => {
          if (started) return;
          if (!tries) return fail(new Error("The generator did not start a new map"));
          F.regenerateMap(request);
          setTimeout(() => ask(tries - 1), 400);
        };
        ask(10);
      });
    } finally {
      patch.restore();
      restoreLocks();
    }
  }

  function setDefinitionSets(cfg) {
    const F = fmg();
    const map = F.options.map;
    const defaults = F.Options.getDefaultOptions().map;
    if (cfg.military === "default") map.military.units = defaults.military.units;
    else if (cfg.military === "dnd" || Array.isArray(cfg.military)) {
      const list = cfg.military === "dnd" ? DND_MILITARY : cfg.military;
      map.military.units = list.map(({ emoji, ...unit }) => ({
        icon: unit.icon || F.Icons.glyph(emoji || "⚔️"),
        name: unit.name,
        rural: unit.rural ?? 0,
        urban: unit.urban ?? 0,
        crew: unit.crew ?? 1,
        power: unit.power ?? 1,
        type: unit.type || "melee",
        separate: unit.separate ?? 0,
        ...(unit.goods ? { goods: unit.goods } : {})
      }));
    }
    if (cfg.transports === "default") map.transports = defaults.transports;
    else if (cfg.transports === "dnd" || Array.isArray(cfg.transports)) {
      const list = cfg.transports === "dnd" ? DND_TRANSPORTS : cfg.transports;
      map.transports = list.map((t, index) => ({ i: index + 1, name: t.name, speed: t.speed, domain: t.domain || "land", hoursPerDay: t.hoursPerDay ?? 8 }));
    }
  }

  function checkRequirements(req) {
    const { pack } = fmg();
    const realms = pack.states.filter(s => s.i && !s.removed).length;
    const settlements = pack.burgs.filter(b => b.i && !b.removed).length;
    const land = pack.cells.h.filter(h => h >= 20).length / pack.cells.h.length;
    if (given(req.minRealms) && realms < req.minRealms) return `${realms} realms, wanted ${req.minRealms}+`;
    if (given(req.minSettlements) && settlements < req.minSettlements) return `${settlements} settlements, wanted ${req.minSettlements}+`;
    if (given(req.minLand) && land < req.minLand) return `${Math.round(land * 100)}% land, wanted ${Math.round(req.minLand * 100)}%+`;
    if (given(req.maxLand) && land > req.maxLand) return `${Math.round(land * 100)}% land, wanted under ${Math.round(req.maxLand * 100)}%`;
    return null;
  }

  // ---- after the map exists: gods, adventure sites, look ----
  async function decorate(cfg) {
    const rel = cfg.religions || {};
    const gods = rel.pantheon === "dnd" ? DND_PANTHEON : Array.isArray(rel.pantheon) ? rel.pantheon : null;
    const patrons = rel.cultPatrons === "dnd" ? DND_CULT_PATRONS : Array.isArray(rel.cultPatrons) ? rel.cultPatrons : null;
    if (gods || patrons) applyPantheon(gods, patrons, rel.rename !== false);
    if (cfg.adventures?.enabled !== false) addAdventureSites(cfg.adventures || {}, patrons || DND_CULT_PATRONS, gods || DND_PANTHEON);
    await applyDisplay(cfg.display || {});
  }

  const godName = god => (god.title ? `${god.name}, ${god.title}` : god.name);
  const godNote = god =>
    `<p><b>${escapeHtml(godName(god))}</b>${god.alignment ? ` (${escapeHtml(god.alignment)})` : ""}</p>` +
    (god.domains?.length ? `<p>Domains: ${escapeHtml(god.domains.join(", "))}</p>` : "") +
    (god.symbol ? `<p>Symbol: ${escapeHtml(god.symbol)}</p>` : "");

  function applyPantheon(gods, patrons, rename) {
    const F = fmg();
    const religions = F.pack.religions.filter(r => r.i && !r.removed);
    let next = 0;
    const byOrigin = new Map();
    for (const religion of religions) {
      const isCult = religion.type === "Cult";
      const isHeresy = religion.type === "Heresy";
      const source = isCult ? patrons : gods;
      if (!source?.length) continue;

      let chosen;
      if (isHeresy && byOrigin.has(religion.origins?.[0])) chosen = byOrigin.get(religion.origins[0]);
      else if (isCult) chosen = source[(religion.i * 7) % source.length];
      else chosen = source[next++ % source.length];
      byOrigin.set(religion.i, chosen);

      const form = religion.form || "";
      let note = "";
      if (form === "Polytheism" || form === "Dualism" || form === "Syncretism" || form === "Pantheism") {
        // a pantheon: the chosen god leads, a few others are worshipped beside them
        const others = source.filter(g => g !== chosen).slice(0, form === "Dualism" ? 1 : 3);
        religion.deity = godName(chosen);
        note = `<p>Led by ${escapeHtml(godName(chosen))}, with ${escapeHtml(others.map(g => g.name).join(", "))}.</p>` + godNote(chosen);
      } else if (form === "Non-theism" || form === "Animism" || (religion.type === "Folk" && !religion.deity)) {
        note = `<p>No single god: they honor spirits and ancestors. Some pray to ${escapeHtml(chosen.name)}.</p>`;
      } else {
        religion.deity = godName(chosen);
        note = godNote(chosen);
      }
      if (rename && religion.deity) {
        if (isCult) religion.name = `Cult of ${capitalize(chosen.name)}`;
        else if (isHeresy) religion.name = `${religion.name.split(" ")[0]} Heresy of ${chosen.name}`;
        else if (religion.type === "Organized" && form === "Monotheism") religion.name = `Church of ${chosen.name}`;
        else if (religion.type === "Organized") religion.name = `Faith of ${chosen.name}`;
      }
      try {
        F.Notes.write(`religion:${religion.i}`, note);
      } catch (error) {
        religion.note = note;
      }
    }
    F.Layers.drawAll?.();
  }
  const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);

  function addAdventureSites(adv, patrons, gods) {
    const F = fmg();
    const { pack } = F;
    const cells = pack.cells;
    const n = cells.i.length;
    const land = [];
    for (let i = 0; i < n; i++) if (cells.h[i] >= 20) land.push(i);
    if (!land.length) return;

    // distance in cells from the nearest town of any size, through land
    const distance = new Float32Array(n).fill(Infinity);
    const queue = [];
    for (const burg of pack.burgs) {
      if (!burg.i || burg.removed) continue;
      distance[burg.cell] = 0;
      queue.push(burg.cell);
    }
    for (let head = 0; head < queue.length; head++) {
      const cell = queue[head];
      for (const next of cells.c[cell]) {
        if (cells.h[next] < 20 || distance[next] <= distance[cell] + 1) continue;
        distance[next] = distance[cell] + 1;
        queue.push(next);
      }
    }

    // danger: far from towns, outside any realm, high up and in harsh lands is more dangerous
    const harsh = { 1: 1.4, 2: 1.3, 9: 1.2, 10: 1.5, 11: 1.8, 12: 1.3, 7: 1.2 };
    const danger = new Float32Array(n);
    for (const i of land) {
      const away = Number.isFinite(distance[i]) ? distance[i] : 40;
      danger[i] = (away + 1) * (cells.state[i] ? 1 : 1.8) * (1 + Math.max(0, cells.h[i] - 50) / 50) * (harsh[cells.biome[i]] || 1);
    }
    const sorted = [...land].sort((a, b) => danger[a] - danger[b]);
    const cuts = (adv.tiers || [0.45, 0.75, 0.92]).map(share => danger[sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]]);
    const tierOf = i => 1 + cuts.filter(cut => danger[i] > cut).length;

    const occupied = new Set(pack.markers.map(m => m.cell));
    for (const burg of pack.burgs) if (burg.i && !burg.removed) occupied.add(burg.cell);
    const count = adv.count ?? Math.max(8, Math.round(land.length / 250));
    const spacing = Math.sqrt((F.options.map.graph.width * F.options.map.graph.height) / count) * 0.5;
    const placed = [];

    const weights = {};
    for (const [type, site] of Object.entries(SITES)) weights[type] = adv.sites?.[type] ?? site.weight;
    const fits = (site, i) => {
      const w = site.where || {};
      if (occupied.has(i)) return false;
      if (w.biomes && !w.biomes.includes(cells.biome[i])) return false;
      if (given(w.minHeight) && cells.h[i] < w.minHeight) return false;
      if (given(w.maxHeight) && cells.h[i] > w.maxHeight) return false;
      if (w.coast && cells.t[i] !== 1) return false;
      if (w.river && !cells.r?.[i]) return false;
      if (given(w.nearBurg) && !(distance[i] <= w.nearBurg)) return false;
      const tier = tierOf(i);
      if (given(w.minTier) && tier < w.minTier) return false;
      if (given(w.maxTier) && tier > w.maxTier) return false;
      const [x, y] = cells.p[i];
      return placed.every(([px, py]) => (px - x) ** 2 + (py - y) ** 2 > spacing ** 2);
    };

    const unit = F.options.map.units.distance;
    let added = 0;
    for (let tries = 0; added < count && tries < count * 40; tries++) {
      const type = weightedPick(weights);
      if (!type) break;
      const site = SITES[type];
      const i = land[Math.floor(Math.random() * land.length)];
      if (!fits(site, i)) continue;

      const [x, y] = cells.p[i];
      const town = nearestBurg(x, y);
      const state = pack.states[cells.state[i]];
      const realm = cells.state[i] ? state?.fullName || state?.name : null;
      const province = cells.province?.[i] ? pack.provinces[cells.province[i]]?.name : null;
      const tier = tierOf(i);
      const values = {
        N: safeName(() => F.Names.getCulture(cells.culture[i])),
        town: town?.name || "the nearest town",
        state: realm || state?.name || "the realm",
        god: pick(gods).name,
        patron: pick(patrons).name.replace(/^the /, ""),
        dragon: DRAGONS_BY_BIOME[cells.biome[i]] || (cells.h[i] > 60 ? "red" : "green")
      };
      values.foe = fill(pick(site.foes), values);
      const name = fill(pick(site.names), values);
      const t = TIERS[tier];
      const away = town ? Math.round(Math.hypot(town.x - x, town.y - y) * unit.scale) : null;
      const note =
        `<p><b>Tier ${tier}</b> (${t.label}) · levels ${t.levels} · CR ${t.cr}</p>` +
        `<p>Threat: ${escapeHtml(values.foe)}.</p>` +
        `<p>Hook: ${escapeHtml(fill(site.hook, values))}</p>` +
        `<p>Where: ${escapeHtml([pack.biomes[cells.biome[i]]?.name, province, realm || "unclaimed wilds"].filter(Boolean).join(", "))}` +
        (town && away !== null ? `; ${away} ${escapeHtml(unit.unit)} from ${escapeHtml(town.name)}` : "") +
        `.</p>`;
      try {
        const details = { name, note };
        if (adv.icon !== false) details.icon = site.emoji;
        const id = F.Markers.place(x, y, `adventure-${kebab(type)}`, details);
        const marker = pack.markers.find(m => m.i === id);
        if (marker) marker.tags = [...(marker.tags || []), "adventure", `tier-${tier}`];
        occupied.add(i);
        placed.push([x, y]);
        added++;
      } catch (error) {
        warn(`Could not place ${type}:`, error.message);
      }
    }

    if (adv.startingTown !== false) markStartingTown(tierOf);
    log(`Added ${added} adventure sites`);
  }

  function markStartingTown(tierOf) {
    const F = fmg();
    const { pack } = F;
    const towns = pack.burgs.filter(b => b.i && !b.removed && !b.capital && tierOf(b.cell) === 1 && b.population > 0.5 && b.population < 8);
    if (!towns.length) return;
    const town = pick(towns);
    const realm = pack.states[town.state];
    try {
      const id = F.Markers.place(town.x, town.y, "adventure-starting-town", {
        name: `${town.name} (where it begins)`,
        icon: "⭐",
        note: `<p>The party's home and first base: a quiet town${realm?.i ? ` in ${escapeHtml(realm.fullName || realm.name)}` : ""}, with a tavern full of rumors about the tier 1 sites nearby.</p>`
      });
      const marker = pack.markers.find(m => m.i === id);
      if (marker) marker.tags = [...(marker.tags || []), "adventure", "start"];
    } catch (error) {
      warn("Could not mark the starting town:", error.message);
    }
  }

  function nearestBurg(x, y) {
    let best = null, bestDistance = Infinity;
    for (const burg of fmg().pack.burgs) {
      if (!burg.i || burg.removed) continue;
      const d = (burg.x - x) ** 2 + (burg.y - y) ** 2;
      if (d < bestDistance) [best, bestDistance] = [burg, d];
    }
    return best;
  }
  function weightedPick(weights) {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * total;
    for (const [key, w] of entries) if ((roll -= w) <= 0) return key;
    return entries.at(-1)?.[0];
  }
  const kebab = text => text.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
  function safeName(make) {
    try {
      return make() || "Old";
    } catch {
      return "Old";
    }
  }

  async function applyDisplay(display) {
    const F = fmg();
    if (display.style) {
      try {
        await F.Controllers.StylePresetsEditor.change(display.style);
      } catch (error) {
        warn(`Style "${display.style}" could not be applied:`, error.message);
      }
    }
    if (display.layers) {
      try {
        if (Array.isArray(display.layers)) F.Layers.restore({ order: F.Layers.state.order, active: display.layers });
        else {
          localStorage.setItem("preset", display.layers);
          const select = document.getElementById("layersPreset");
          if (select) select.value = display.layers;
          F.applyLayersPreset();
        }
      } catch (error) {
        warn(`Layers "${display.layers}" could not be applied:`, error.message);
      }
    }
    F.Layers.drawAll();
  }

  // ---- reading and exporting ----
  function describe() {
    const { pack, options } = fmg();
    const live = list => (list || []).filter(x => x.i && !x.removed);
    const states = live(pack.states);
    return {
      name: options.map.lore.name,
      seed: options.map.seed,
      template: options.generation.template,
      year: `${options.map.lore.calendar.year} ${options.map.lore.calendar.eraShort}`,
      land: `${Math.round((pack.cells.h.filter(h => h >= 20).length / pack.cells.h.length) * 100)}%`,
      realms: states.map(s => s.fullName || s.name),
      peoples: live(pack.cultures).map(c => c.name),
      religions: live(pack.religions).map(r => (r.deity ? `${r.name} (${r.deity})` : r.name)),
      settlements: live(pack.burgs).length,
      adventureSites: pack.markers.filter(m => String(m.type).startsWith("adventure-") && m.type !== "adventure-starting-town").length,
      markers: pack.markers.length
    };
  }

  function exportJson(type = "Full") {
    return fmg().Services.ExportJson.exportToJson(type);
  }

  // ---- the userscript button ----
  function addPanel() {
    if (document.getElementById("dndWorldButton")) return;
    const button = document.createElement("button");
    button.id = "dndWorldButton";
    button.textContent = "D&D World";
    button.title = "Generate a D&D world with your settings";
    Object.assign(button.style, { position: "fixed", right: "12px", bottom: "12px", zIndex: 9999, padding: "6px 12px", background: "#7a1f1f", color: "#fff", border: "1px solid #3b0d0d", borderRadius: "6px", cursor: "pointer", font: "13px sans-serif" });

    const panel = document.createElement("div");
    Object.assign(panel.style, { position: "fixed", right: "12px", bottom: "48px", zIndex: 9999, width: "min(420px, calc(100vw - 24px))", background: "#fbf6ec", color: "#222", border: "1px solid #7a1f1f", borderRadius: "8px", padding: "10px", boxShadow: "0 4px 16px rgba(0,0,0,.3)", display: "none", font: "13px sans-serif" });
    const STORE = "dnd-world-settings";
    let stored = "";
    try {
      stored = localStorage.getItem(STORE) || "";
    } catch {}
    panel.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <b style="flex:1">D&D World</b>
        <label>Preset <select id="dndWorldPreset">${Object.keys(PRESETS).map(p => `<option>${p}</option>`).join("")}</select></label>
      </div>
      <div style="margin-bottom:4px">Settings (JSON, overrides the preset; see CONFIG in the script):</div>
      <textarea id="dndWorldSettings" spellcheck="false" style="width:100%;height:180px;font:12px monospace;box-sizing:border-box"></textarea>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        <button id="dndWorldGo">Generate</button>
        <button id="dndWorldExport">Export JSON</button>
        <span id="dndWorldStatus" style="flex:1;align-self:center;color:#555"></span>
      </div>`;
    document.body.append(panel, button);
    const textarea = panel.querySelector("#dndWorldSettings");
    const status = panel.querySelector("#dndWorldStatus");
    textarea.value = stored || JSON.stringify({ seed: null, realms: { count: 12 }, adventures: { count: 40 }, export: { json: false } }, null, 2);
    panel.querySelector("#dndWorldPreset").value = CONFIG.preset;

    button.onclick = () => (panel.style.display = panel.style.display === "none" ? "block" : "none");
    panel.querySelector("#dndWorldExport").onclick = () => exportJson();
    panel.querySelector("#dndWorldGo").onclick = async () => {
      let settings;
      try {
        settings = textarea.value.trim() ? JSON.parse(textarea.value) : {};
      } catch (error) {
        status.textContent = `Not valid JSON: ${error.message}`;
        return;
      }
      try {
        localStorage.setItem(STORE, textarea.value);
      } catch {}
      settings.preset = panel.querySelector("#dndWorldPreset").value;
      status.textContent = "Generating…";
      try {
        const summary = await generate(settings);
        status.textContent = `${summary.name}: ${summary.realms.length} realms, ${summary.adventureSites} sites`;
      } catch (error) {
        status.textContent = error.message;
      }
    };
  }

  window.DnDWorld = { generate, describe, exportJson, resolve, config: CONFIG, presets: PRESETS, sites: SITES, pantheon: DND_PANTHEON, cultPatrons: DND_CULT_PATRONS, peoples: DND_PEOPLES, military: DND_MILITARY, transports: DND_TRANSPORTS };

  // pasted into the console: generate now. Installed as a userscript: add the button once the app is up
  const isUserscript = typeof GM_info !== "undefined";
  const whenReady = callback => {
    const ready = () => window.FMG && window.FMG.mapHistory.length > 0;
    if (ready()) return callback();
    const timer = setInterval(() => ready() && (clearInterval(timer), callback()), 500);
  };
  if (isUserscript) whenReady(addPanel);
  else
    whenReady(() =>
      generate().catch(error => {
        console.error("[D&D World]", error);
      })
    );
})();
