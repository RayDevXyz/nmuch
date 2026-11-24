# D&D World Generator for Azgaar's Fantasy Map Generator

[`dnd-world-generator.js`](dnd-world-generator.js) makes a new world in
[Azgaar's Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/) from one settings
object. It covers every option the generator has, and then it adds D&D content: D&D peoples, a pantheon with
cleric domains, fantasy troops and travel paces, and adventure sites. Each site gets a tier, character levels,
a CR range and a hook. Export the world as JSON and import it into a BrainWaves campaign with
**Import Azgaar world** (see the [D&D guide](../../docs/guide/dnd.md)).

It was written for generator version 1.158 and uses the generator's console API (`window.FMG`).

## Running it

**Once, from the console**
1. Open the generator and wait for the first map.
2. Open the browser console (F12, then *Console*).
3. Paste the whole file and press Enter. A world is made from the `CONFIG` at the top of the file.

Then you can call it again from the console with other settings:

```js
DnDWorld.generate({ preset: "frontier" })
DnDWorld.generate({ seed: "998491217", realms: { count: 8 }, adventures: { count: 60 } })
DnDWorld.describe()    // realms, peoples, religions and counts of the world on screen
DnDWorld.exportJson()  // download the Full JSON
```

**As a userscript.** Install it with Tampermonkey or Violentmonkey. You then get a **D&D World** button in the
bottom-right corner of the generator. It has a preset picker, a box for settings in JSON, **Generate** and
**Export JSON**.

## Settings

Every setting is optional. A setting you leave out, or set to `null`, takes the preset's value. If the preset has
none, the generator rolls it at random as usual, or keeps a value you locked in the generator. Each layer is applied over the one before:
**preset → `CONFIG` → what you pass to `generate()`**.

| Group | What it sets |
|---|---|
| `seed` | Fixed seed: the same settings give the same world again |
| `map` | Canvas size, number of cells, grid layout (`square`, `hexPointy`, `hexFlat`, `diamond`, `triangle`), jitter |
| `terrain` | Heightmap template, your own templates (`customTemplates`), part of the globe shown, latitude, longitude, lakes |
| `climate` | Temperatures at the equator and the poles, precipitation, the six wind bands |
| `biomes` | Rename biomes, change how livable they are, recolor them |
| `peoples` | A built-in culture set, or your own peoples with a race, name base and home terrain; a range for technology |
| `nameBases` | Your own name lists for your peoples |
| `realms` | Number of states, size variety, growth rate, provinces per realm |
| `settlements` | Number of towns |
| `religions` | Number of religions, the gods and cult patrons to use, renaming churches after their god |
| `lore` | World name, description, year and era |
| `units` | Distance, area, height and temperature units, map scale, currency, population |
| `military` | Troop types (`"dnd"`: militia, men-at-arms, archers, knights, battle mages, griffon riders, siege engines, fleet) |
| `transports` | Travel modes used by journeys (`"dnd"`: the 5e travel paces, ships, griffons, airships, teleportation circles) |
| `markers` | How many of the generator's own points of interest to place, overall or per type (dungeons, ruins, portals, inns…) |
| `zones` | How many wars, plagues, rebellions and disasters to draw (0 = none) |
| `adventures` | The D&D adventure sites: how many, how the land splits into tiers, weights per site type, a starting town |
| `display` | Style preset and layers to show when done |
| `requirements` | Roll again until the world has enough realms, settlements or land |
| `export` | Download the Full JSON when done |

The file explains every setting next to it.

### Presets

| Preset | The world |
|---|---|
| `classic` | One or two temperate continents, sixteen realms, the D&D peoples |
| `archipelago` | Island kingdoms, pirates, sea monsters and sunken temples |
| `frontier` | A few small realms at the edge of a vast wilderness, full of sites, for a West Marches game |
| `grimdark` | Cold, dying lands, the dark fantasy cultures, necropolises, crypts and cults |
| `desert` | Sand, river kingdoms and buried tombs |
| `northlands` | Frost giants, barrows and long winters |
| `random` | The generator decides everything; the D&D content is still added |

### Adventure sites

The script works out how dangerous each part of the map is. Danger rises with the distance from the nearest
town, outside any realm, in the mountains and in harsh lands such as glaciers, deserts and swamps. The land is
then split into the four tiers of play:

| Tier | Levels | CR |
|---|---|---|
| 1 | 1–4 | 1/4–4 |
| 2 | 5–10 | 3–9 |
| 3 | 11–16 | 8–15 |
| 4 | 17–20 | 14–24 |

Sites are placed only where they fit. Dragon lairs go on high ground, sunken temples on the coast, fey
crossings in forests and buried tombs in deserts. Lich towers and planar rifts appear only in tier 3 and
4 lands. A site's note gives its tier, the threat, a hook that names the nearest town, realm or a god of
the world, and how far it is from that town. The types are: dungeon, ruined keep, bandit camp, goblin warren,
haunted crypt, dragon lair, lich tower, fey crossing, planar rift, sunken temple, smugglers' cove, giant
steading, barrow mound, buried tomb, wizard's tower, cult hideout, abandoned mine and beast den. Change their
weights with `adventures.sites`. Edit `SITES` in the file to change what they say or to add your own.

The sites are markers of the type `adventure-…`, tagged `adventure` and `tier-1` to `tier-4`. They show in
the generator's Markers overview, and BrainWaves imports them as landmarks.

### The gods

The pantheon and the cult patrons are original. Each god has a title, cleric domains, an alignment and a
symbol. Replace `DND_PANTHEON` and `DND_CULT_PATRONS` with your setting's gods, or pass your own:

```js
DnDWorld.generate({
  religions: {
    pantheon: [{ name: "Solra", title: "the Bright", domains: ["Light"], alignment: "NG", symbol: "a sunburst" }],
    cultPatrons: [{ name: "the Pale Hunger", domains: ["Death"], alignment: "NE" }]
  }
})
```

### Your own peoples

```js
DnDWorld.generate({
  peoples: {
    list: [
      { name: "Riverfolk", race: "Halfling", nameBase: "Halfling", habitat: "river", development: 30 },
      { name: "Ironclans", race: "Dwarf", nameBase: "Dwarven", habitat: "mountains", development: 34 },
      { name: "Ashlanders", race: "Human", nameBase: "Iranian", habitat: "desert", development: 28 }
    ]
  },
  nameBases: [{ name: "Halfling", names: ["Bramblebank", "Thistledown", "Applebrook", "Hobbleton", "Willowbank"] }]
})
```

Homes: `any`, `forest`, `deepForest`, `mountains`, `hills`, `plains`, `coast`, `river`, `desert`, `swamp`,
`cold`, `warm`, `jungle`, `wastes`. A world holds at most 17 peoples.

## Things to know

- **Your locks are kept.** The script locks its values in the generator while it works, then puts your
  own locks back.
- **The style stays.** A style preset, such as `grimdark`'s `gloom`, stays on the next maps until you choose
  another one (`display: { style: "default" }`).
- **Troops and travel modes stay.** Like the generator's own editors, `military` and `transports` change the
  sets the next maps start from. To go back, set them to `"default"`, or restore the defaults in the
  generator's Military and Journeys editors.
- **The same seed gives the same world** only with the same settings and the same generator version.
- **A new version of the generator can break the script.** It relies on the generator's console API and
  some of its internals. If a setting stops working, the console says which one, and the rest still runs.
