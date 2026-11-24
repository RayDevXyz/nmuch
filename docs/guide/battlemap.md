# Battle maps: build, light and generate them

A battle map is a canvas where you build the map itself:
- **Rooms:** draw them, and they merge where they overlap.
- **Walls:** drawn on their own; doors and windows go in them.
- **Terrain:** paint water, lava and grass.
- **Props:** add them from a library or upload your own.
- **Light:** lights shine, and walls cast shadows.

You can also generate a whole dungeon, village or ship and change any part of it afterwards.

What players see on [the table](table.md) comes from the same map, with the parts only you may see
removed.

Open a campaign and click **+ Battle map**. The map's settings are in the right panel, which has
four tabs:
- **Assets**: shapes, text, pictures, the **Props** library and the layers.
- **Map**: generate a map, its style, its layers, and light and sight.
- **Table**: go live, players, move requests, initiative and dice.
- **Graph**: the page graph.

## 1. Draw

The build tools are in the bottom toolbar, in their own group. While one is active, its options
appear above the toolbar.

| Tool | Key | What it does |
|---|---|---|
| **Room** | `B` | Adds floor. Rooms that overlap merge, and their outline becomes the wall. |
| **Carve** | `X` | Cuts floor away: a notch, a pillar's hole, a collapsed corner. The walls follow. |
| **Terrain** | `G` | Paints the ground: grass, water, deep water, lava, pit, sand, snow, mud, road, cobbles, swamp, ice, rock. |
| **Wall** | `W` | A wall on its own. Click each corner, then double-click (or press Enter) to finish. |
| **Opening** | `Q` | Click on a wall to put in a door, a secret door, a window, a half wall or bars, one square wide. |
| **Light** | `L` | A light on its own: a torch, a lantern, a magic glow, a bullseye cone. |

Room, Carve and Terrain draw in four shapes, picked in the options bar:
- **Rectangle** or **ellipse**: drag.
- **Polygon**: click each corner. Double-click, press Enter or click the first corner to close
  it. Backspace removes the last corner; Escape cancels.
- **Brush**: drag to paint a corridor, a river or a road. Its width is set in squares.

Corners snap to the grid's corners and half squares. Hold **Ctrl** to draw freely, or turn
**snap** off.

Everything you draw stays a shape you can change:
- Select it to move it, resize it with its handles, or turn it.
- **Ctrl ]** and **Ctrl [** change the stacking order, which decides which floor's material shows
  where shapes overlap.
- In the right panel's **Map** tab, change a room's material, make an addition a carve, or move a
  shape between Architecture and Terrain.
- **Double-click a door** to open or shut it.

## 2. Style

**Map → Look → Style** changes how the map is drawn, never what is drawn:

- **Stone & wood**: textured floors, heavy walls with soft shadows, rough rock around them.
- **OSR ink**: black and white, cross-hatched rock around the rooms (props turn monochrome too).
- **Blueprint**: white lines on blue paper.
- **Minimal**: flat and clean.

**Grid** can be **Squares**, **Hexes** (pointy-top) or **None**. With no grid, tokens move freely.
Square size, feet per square and the grid's offset are under **Grid & fog**.

## 3. Layers

**Map → Layers**, from top to bottom: Tokens, GM layer, Props & dressing, Architecture, Terrain &
background.

- The **eye** hides a layer. Hidden layers aren't sent to players either.
- The **lock** keeps everything on a layer from being picked or moved, for example a finished
  floor while you place props.
- The **arrows** reorder layers.
- **Clicking a layer's name** selects everything on it.
- The **GM layer** is never sent to players. It holds room numbers, notes and triggers. A prop
  moved there, such as a hidden trap, is drawn dashed for you and not at all for players.

## 4. Props

**Assets → Props** is the library:
- **Categories:** Furniture, Lighting, Hazards, Nature, Dungeon dressing, Camp & ship.
- **Search:** by name and tags ("light", "trap", "tavern"…).
- **Favourites:** click a tile's ★ to keep it under ★ Favourites.

Click a prop to put it in the middle of the view, or drag it onto the map. Props snap to the
squares. Select one to turn it, mirror it, move it to another layer, or give it light.

**Your own props:** click **Upload props** or drop files on the library. It takes PNG, JPEG, SVG,
GIF, APNG, animated WebP, WebM and MP4.
- Uploads are kept in the campaign, so every map in it offers them.
- Moving pictures and videos (a flickering torch, a flowing river) loop on the map, for you and
  for players.
- Files dropped straight onto the map also become props if they move or are small. A large still
  picture becomes the map's background, as before.

## 5. Light and sight

Lights come from three places:
- the **Light** tool;
- props that glow, such as torches, braziers, candelabras, campfires and fireplaces. Change a
  prop's light, or turn it off, in the panel;
- a token carrying one: select the token and choose under **Carries**.

Each light has:
- **bright** and **dim** radii in feet;
- a **colour**;
- **flicker**;
- **on/off**;
- optionally a **cone**, with its direction and width.

Walls, shut doors and secret doors cast shadows. Windows, half walls, bars and open doors let
light and sight through.

**Map → Light & sight:**

- **Ambient light**:
  - **Daylight**: everything is lit.
  - **Dusk**: dim everywhere, brighter near lights.
  - **Pitch black**: only lights and darkvision show anything.
- **Line of sight for players**: players see only what their characters see. A character's view
  stops at walls and shut doors, and reaches as far as their **Sight**, if you set one. In the
  dark it reaches only lit areas and their **Darkvision**. Set Sight and Darkvision on the token.
  Areas you clear with the Reveal tool stay visible as well.
- **Remember explored areas**: where the party has been stays on their map, dimmed. **Forget
  explored** clears it.
- **See as players**: shows you the map as the party sees it.

You always see the whole map. In the dark it is only dimmed for you.

## 6. Generate

**Map → Generate** makes a map from a seed, in three sizes. The same seed always makes the same
map.

| Map | What you get |
|---|---|
| Dungeon | Rooms joined by corridors, doors (some secret, some open archways), torches, pillars in big rooms, stairs, dressing, a finale room, traps (some on the GM layer), room numbers on the GM layer. |
| Wilderness | A river, a road, woods, a pond, rocks, logs and reeds. |
| Village | Cottages with doors, windows, beds, tables and hearths, along dirt roads around a well. |
| Town | Cobbled streets, blocks of houses and shops, and a market square with a fountain and stalls. |
| Tavern | A common room with a bar, stools, tables and chairs, a hearth and a rug; a kitchen; a store room with stairs. |
| Camp | Tents and bedrolls around a campfire, a cart and supplies, trees around the clearing. |
| Ship | A hull on deep water: a captain's cabin, the helm, masts, cannons along both rails, cargo and the anchor. |

- **Generate** (or **Replace map**) replaces what's drawn on the map: rooms, walls, props, lights
  and generated room numbers. Tokens, pictures and your own notes stay.
- **Add here** adds the new map in the middle of the view.

What a generator makes is ordinary rooms, walls, doors and props, so you edit it like anything
you drew.

## What players get

When you go live, BrainWaves sends players:
- the drawn layers as pictures, each sent once and reused;
- props, including animated ones;
- the lights that aren't on hidden tokens or the GM layer;
- what the party sees and has explored.

The table never receives:
- the GM layer;
- hidden layers;
- hidden tokens;
- secret doors as doors: players see a wall until the door is opened;
- creatures outside the party's sight.

As with a picture map, the map's layers are sent whole and the darkness is drawn on top of them
in the player's browser.

## How it works

The code is in `apps/desktop/src/battlemap/`:

| File | What it does |
|---|---|
| `geom.ts` | Polygons: shapes to polygons, brush strokes, union and difference (polygon-clipping), and the line of sight (a ray sweep towards every wall end). |
| `model.ts` | Layers, materials, themes, and how the shapes add up. Floor is every room added, minus what's carved, in order; walls are the floor's outline plus walls drawn on their own, with openings cut out of them. |
| `render.ts` | The SVG for the floors, walls, openings, hatching and shadows in each theme. The DM's view and the players' pictures use the same code. |
| `lighting.ts` | Lights, the party's sight, the explored memory (kept in the page), and drawing light. |
| `generate.ts` | The seeded generators. |

Elements on the page: `area` (a floor or terrain shape), `wall` (a wall or opening), `prop` and
`light`, alongside the canvas's other elements. See `crates/bw-core/src/surface.rs`.
