/**
 * What Gemini is asked. The campaign's notes are canon; Gemini fills the gaps and writes pages a
 * DM can run at the table.
 */

export const SYSTEM = `You are a creative assistant helping a Dungeon Master build a Dungeons & Dragons 5th edition world.
- The campaign notes you are given are canon: keep names, places, relationships and facts consistent with them, and build on them.
- Invent freely where nothing is given, in the campaign's tone. Prefer concrete, playable detail (names, motives, secrets, hooks, sensory detail) over generic description.
- Write in Markdown: short paragraphs, ## headings, bullet lists. No title heading at the top of a page.
- When you mention a page that exists in the campaign notes (an NPC, location or faction), write its exact title in double square brackets, like [[Phandalin]].
- Never include game-breaking rules text; use 5e terms (DCs, ability checks, conditions) where useful.`

export const WORLD_JSON = `Answer with JSON only, in this shape:
{"items": [{
  "kind": "npc" | "location" | "faction" | "lore",
  "title": "the name",
  "role": "for an npc: what they do, a few words",
  "attitude": "for an npc: friendly | neutral | hostile",
  "status": "for an npc: alive | dead | missing | unknown",
  "locationKind": "for a location: region | city | village | dungeon | wilderness | landmark",
  "goal": "for a faction: its goal in one sentence",
  "location": "for an npc: the exact title of the location they are found in (existing or one of these items), if any",
  "faction": "for an npc: the exact title of their faction, if any",
  "body": "the page in Markdown: for an NPC Appearance, Personality, Wants, Secret, Hooks, How they talk (with a sample line); for a location Overview, What you see and hear (read-aloud), Notable places or rooms, People, Secrets and hooks; for a faction Overview, Goals, Leaders and members, Resources, Allies and enemies, Hooks; for lore the text itself"
}]}`

export const EXPAND: Record<string, { label: string; ask: string }> = {
  flesh: { label: 'Flesh it out', ask: 'Expand this page: add what is missing so a DM can run it at the table. Keep everything already written and consistent; add new sections, do not repeat existing text.' },
  secrets: { label: 'Secrets & hooks', ask: 'Write a "Secrets" section (3 to 5 secrets the players can discover, and how) and a "Hooks" section (3 adventure hooks tied to other parts of the campaign).' },
  readaloud: { label: 'Read-aloud text', ask: 'Write a short read-aloud box text (2 to 4 sentences, second person, sensory) for when the players first meet or arrive here, as a Markdown quote block starting with "> ", then one paragraph of DM notes.' },
  rumours: { label: 'Rumours (d6 table)', ask: 'Write a d6 rumour table about this subject as a Markdown table with columns d6, Rumour, True?. Mix true, half-true and false rumours.' },
  dialogue: { label: 'Dialogue lines', ask: 'Write 6 lines of dialogue this character (or the people here) might say, in their voice, as a bullet list, each with a short note on when to use it.' },
}

export const SESSION_JSON = `Answer with JSON only, in this shape:
{"session": {"title": "Session N: a short evocative title", "summary": "one sentence", "body": "the session plan in Markdown: ## Strong start, ## Scenes (each with a goal), ## Secrets and clues (a list of 6 to 10), ## Locations, ## NPCs, ## Encounters (with 5e monsters where useful), ## Treasure"},
 "beats": [{"title": "a story beat", "notes": "one or two sentences", "arc": "the arc name", "npcs": ["exact NPC titles"], "locations": ["exact location titles"], "factions": ["exact faction titles"]}]}`

export const MAP_JSON = `Answer with JSON only, in this shape:
{"biome": "dungeon" | "wilderness" | "village" | "town" | "tavern" | "camp" | "ship",
 "size": "small" | "medium" | "large",
 "theme": "stone" | "ink" | "blueprint" | "modern",
 "ambient": "day" | "dusk" | "dark",
 "title": "a name for the place",
 "overview": "the place in Markdown: what it is, who is here, what happens here, with a read-aloud quote block",
 "areas": [{"label": "1", "name": "an area's name", "text": "what is there: read-aloud sentence, creatures (5e), treasure, traps"}]}
For a dungeon, number the areas 1, 2, 3… (up to 15) in the order the party reaches them. For other places, describe the notable spots.`

export const SORT_JSON = `Turn the text below (written earlier in a chat with an assistant) into campaign pages. Keep its wording; split it into one item per NPC, location, faction or piece of lore it describes. ${WORLD_JSON}`
