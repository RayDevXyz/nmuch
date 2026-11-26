# Gemini: build your world with Google Gemini

BrainWaves works with Google's Gemini for D&D world building, in two ways:

- **With a Gemini API key**: you ask Gemini from inside BrainWaves. It reads your campaign's
  NPCs, locations, factions, story beats and sessions, so its answers fit your world and link to
  your pages, and what it writes becomes real campaign pages.
- **Without a key**: keep chatting in the Gemini app, then paste its answers into BrainWaves,
  which splits them into NPC, location and faction pages.

## 1. Add your key (once)

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in with your
   Google account and click **Create API key**. The free tier is plenty for world building.
2. In BrainWaves: **Settings → Gemini…**, paste the key and click **Save and test**.
   BrainWaves asks you for the key the first time you use Gemini anyway.

**Models.** Google adds new Gemini models and retires old ones every few months, so BrainWaves
doesn't keep a list: it asks Gemini which models your key can use and shows those in
**Settings → Gemini…**. When you save a key, the newest stable **Flash** is picked (fast, and
on the free tier). **Pro** writes best but is slower and has lower free limits; **Flash-Lite**
is the fastest. **Type a model name…** takes any other.

If the model you chose is retired, BrainWaves notices the next time you ask, switches to the
newest stable Flash your key can use, and keeps going.

The key stays on your BrainWaves server (or, in the desktop app, on your computer), and the app
never shows it again: BrainWaves' own side adds it when it calls Gemini. Remove it from the same
dialog. What you ask, with the campaign notes you include, goes to Google.

## 2. On a campaign page

A **Gemini** row sits under the campaign's links:

- **Create NPCs, places…**: say what you need ("the harbour district: a smuggler captain, her
  syndicate, the tavern where they meet"), choose NPCs, locations, factions, lore or anything, and
  how many.
  - Gemini writes them; you see them first, and can untick, retitle or change each one's kind.
  - **Add** makes them part of the campaign:
    - NPCs go in the NPCs database, with their role, attitude and status, and linked to their
      location and faction;
    - locations go in Locations, with their kind;
    - factions go in Factions, with their goal;
    - lore becomes pages under the campaign.
  - Mentions of existing pages become links.
- **Chat**: talk to Gemini about your world ("What does the Zhentarim want in Phandalin?",
  "a twist for next session").
  - It knows the campaign's notes (untick *include the campaign's notes* to leave them out).
  - **Save as a page…** turns any answer into an NPC, location, faction or lore page.
  - The chat is kept with the campaign, on every device.
- **Plan a session**: say what happened last time (filled in from the last session's summary)
  and what you want next.
  - Gemini plans the session: a strong start, scenes, secrets and clues, locations, NPCs,
    encounters and treasure, plus a few new story beats.
  - **Add session** makes the session's page and the beats, linked to the session and to the
    NPCs, locations and factions they involve.
- **Bring in from Gemini**: see section 5.

## 3. On any page

**⋯ → Write with Gemini…** on any page offers:
- **Flesh it out**;
- **Secrets & hooks**;
- **Read-aloud text**;
- **Rumours (d6 table)**;
- **Dialogue lines**;
- or your own instruction ("a tragic backstory tied to the Black Spider").

Gemini reads the page (and the campaign, if the page belongs to one). You see what it wrote and
choose **Add to the page**, **Replace page** or **Try again**.

In the editor, **`/gemini`** (*Gemini: write here*) does the same and puts the text where your
cursor is.

## 4. On a battle map

**Map → Generate → Or describe it to Gemini**: describe the place ("a flooded dwarven shrine, lit
by green fungus, guarded by a cult"). Gemini then:
- picks the kind of map (dungeon, wilderness, village, town, tavern, camp or ship) and its size;
- picks the style and the light;
- writes a **key** to its areas (numbered rooms for a dungeon) as a page under the map.

The map is made by the [generator](battlemap.md#6-generate), so you can edit every room, wall and
prop.

## 5. Bring in what you made in the Gemini app

On the campaign page: **Bring in from Gemini**. No API key is needed.

1. In the Gemini app, use **Copy** under an answer, or *Share & export → Export to Docs* and copy
   from there. Paste it here.
2. Or open a saved **.md**, **.txt** or **.html** file, for example from Google Takeout.
3. **Split into pages** makes one page per heading. Gemini often marks names with bold lines
   instead of headings; those count as headings too.
4. Each page's kind (NPC, location, faction or lore) is guessed from its words; check and change
   them, then **Add**.

With a key, **Let Gemini sort it** asks Gemini to split the text and fill in the details: role,
attitude, location kind, faction goal.

## How it works

- `crates/bw-api/src/gemini.rs` calls the Gemini API's `generateContent` with the key the core
  keeps (`geminiSetKey`, `geminiStatus`, which only returns the key's last four characters). The
  call runs outside the core's lock, so the rest of BrainWaves stays responsive while Gemini
  thinks. `BW_GEMINI_URL` points it at another address (a proxy, or a stand-in for tests).
- `apps/desktop/src/gemini/` has the rest:

| File | What it does |
|---|---|
| `context.ts` | The campaign as text: NPCs, locations and factions with their facts and the start of their pages, story beats, sessions. |
| `prompts.ts` | What Gemini is asked, and the JSON shapes it answers in. |
| `create.ts` | Answers turned into database rows, relations and page text. |
| `importText.ts` | Pasted answers split into pages. |
| `GeminiDialog.tsx` | The window. |
