# The table: battle maps your players join

BrainWaves is where you, the DM, prepare and run a fight: the dungeon picture, the grid, who
stands where, what's still hidden in the fog. **The table** is a small server you run on your
home server. Players open its link in any browser (laptop, tablet, phone) and see the battle map
live, with only what you've revealed.

![The DM's battle map in BrainWaves](../images/table-dm.png)

![What a player sees](../images/table-player.png)

What players can do at the table:

- **Look**: pan and zoom the map (drag, wheel, or pinch).
- **Ping** a spot: a ring flashes there for everyone, you included.
- **Draw** on the map for a few seconds: show a route, mark a door.
- **Move** their own character. They drag it to where it should go, and the move waits for you.
  You accept it (the token moves, snapped to the grid) or decline it.
- **Roll dice**: d4 to d100, or anything like `2d6+3`, `d20 adv`, `4d6kh3`. Everyone sees
  the rolls.
- **Build characters** for the campaign, which you approve or send back, and see their
  sheets.
- See their character's hit points, the initiative order, and who else is at the table.

They can't see hidden tokens, creatures standing in the fog, monsters' hit points (only
*bloodied* or *down*), your notes, or anything else in BrainWaves. BrainWaves decides what to
send, so nothing hidden reaches the server.

## 1. Run the table on your home server (Docker)

On the server, from a copy of this repository:

```sh
cd deploy/table
echo "BW_TABLE_DM_KEY=$(openssl rand -hex 16)" > .env   # your DM key: keep it to yourself
docker compose up -d --build
docker compose logs table                             # shows the address and the DM key
```

On Windows (PowerShell), make the `.env` file this way instead: PowerShell's `>` saves it as
UTF-16, which Docker Compose can't read (`unexpected character "�" in variable name`).

```powershell
cd deploy\table
$key = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
[IO.File]::WriteAllText("$PWD\.env", "BW_TABLE_DM_KEY=$key`n")
docker compose up -d --build
```

The table listens on port **8090**. Rooms and map pictures live in the `table-data` Docker
volume, so they survive restarts and upgrades. To upgrade, `git pull` and run
`docker compose up -d --build` again.

Without Docker, build and run it directly:

```sh
cargo build --release -p bw-table
BW_TABLE_DM_KEY=your-long-key BW_TABLE_DATA=/srv/table ./target/release/bw-table
```

| Setting | Default | |
| --- | --- | --- |
| `BW_TABLE_PORT` | `8090` | The port. |
| `BW_TABLE_DATA` | `table-data` (Docker: `/data`) | Rooms (`rooms/<code>.json`) and their pictures. |
| `BW_TABLE_DM_KEY` | generated | The key BrainWaves uses to open rooms and run them (8+ characters). If unset, one is made, saved in `dm-key.txt` in the data folder, and printed at startup. |

Check it's running: `http://<server>:8090/health` answers `ok`.

## 2. Make a battle map

1. Open a campaign. In **Battle maps**, click **+ Battle map**. It opens as a canvas.
2. Put the dungeon on it: the **Image** tool (`I`), then click where it goes. Battle maps keep
   the picture at its own size and on the grid, so a map drawn at 70 px per square lines up
   with the default grid.
3. In the panel on the right (**The table**), under **Map**, set the square size to your
   picture's squares. Nudge **Shift x / y** until the grid lines sit on the picture's lines.
   Set the feet per square (5 by default).
4. Place tokens with the **Token** tool (`K`), then click where the creature stands:
   - **Party**: your characters, with their hit points and AC from their sheets. These are
     the tokens players can claim and move.
   - **Monster**: anything from your 5etools compendium. It gets its average hit points, its
     AC and its size (large creatures take 2×2 squares, and so on).
   - **Other**: a name, hit points and a size, for anything else.

   Monsters start **hidden** (dashed and see-through for you, absent for players). Select a
   token and click **Hidden / Visible** to show it.
5. **Fog of war** is on by default: players see only the areas you clear. Use the **Reveal**
   tool (`E`) to drag over a room. Each cleared area has a small ◌ handle: drag it to move the
   area, or select it and press Delete to fog it again. **Reveal all** and **Fog all** are in
   the panel.

Tokens snap to the grid when you drop them. Select one to edit its name, AC and hit points, or
type a number in **±HP** and press **Damage** or **Heal**. You can also change its size, and
whether it's a player character or a creature.

## 3. Go live

The first time, the panel asks for your table server: its address (for example
`http://192.168.1.20:8090`) and the DM key. BrainWaves keeps them in this workspace.

Click **Go live**. BrainWaves opens the campaign's room and shows this map in it, and the panel
shows the join link. Copy it (⧉) and send it to your players. They type a name, take a seat,
and click their character under **On the map** (their own character is picked for them).

**One link per campaign.** The room belongs to the campaign, not to one map, so players keep
the same link from session to session. On another battle map, **Show this map** switches what
players see; **Hide** shows them no map. You can also go live from the campaign page (the
**Players' table** panel) before there's any map, for example so players can build their
characters.

While you're live:

- Every change on the map (a token moved, an area revealed, hit points) reaches the players
  within a moment.
- **Move requests** appear in the panel, and as a dashed ghost on the map where the player wants
  to go. ✓ moves the token, ✕ declines. Each player has one open request at a time.
- Players' pings and drawings show on your map too. **Alt-click** the map to ping for
  everyone.
- **Initiative**: **Add tokens** puts every token on the map in the list (monsters get a
  rolled d20). Type the players' rolls, and the list sorts. **Next turn** moves the marker and
  counts rounds. Players see the order without hidden creatures.
- **Dice**: your rolls are **secret** by default (only you see them). Untick *secret* to roll
  in the open.

![A move request waiting for the DM](../images/table-request.png)

**End** closes your connection; the room stays, so **Go live** later re-opens the same room with
the same link. Players who stay connected see "DM away" in the meantime.

## 4. Players build their characters

Under **Characters** on the table site, players click **Create a character** and fill in a
short form: a name, race, class, background and alignment, their ability scores, the class's
skills, and a backstory if they like. The options come from your 5etools, limited by the
campaign's rules. Nothing joins the campaign until you approve it.

![Building a character on the table site](../images/table-character-new.png)

**The rules** are in the campaign's **Players' table** panel, under **Character rules**:

- whether players may submit characters now;
- the starting level (the character gets average hit points for each level above 1);
- how ability scores are made: standard array, point buy, rolled (players enter what they
  rolled), or the player's choice;
- which books races, classes and backgrounds may come from;
- a note shown above the form (house rules, what fits the setting).

**Reviewing.** Submissions wait under **Characters to review**, on the campaign page and on
battle maps, while you're live, and they wait on the server while you're not. Click one to see
the character: its scores and the sheet it will get, its backstory, and any problems BrainWaves
finds against your rules (a race from a book you don't allow, a point buy over 27 points, too
many skills, and so on).

- **Approve** makes the character in your Characters database, linked to the campaign, with
  the same rules as BrainWaves' own **New character**. It joins **The party** on the campaign
  page, and the player sees it under **Characters**.
- **Send back** needs a note telling the player what to change. They see the note, edit the
  character and resend it.

![Reviewing a submitted character](../images/table-character-review.png)

**Seeing their character.** Players click their character to see the sheet: scores, saves and
skills with their bonuses, hit points, AC, spells, equipment and backstory. The sheet stays in
BrainWaves, and players see your changes (damage, a level up) within a few seconds. They can
also open the other party members' sheets. When you put their character's token on the map
you're showing, their page picks that token for them.

![A player's character sheet on the table site](../images/table-character-sheet.png)

Players are known by their browser: the table site keeps a random id there, so their
characters are waiting when they come back. A player who switches to another browser or device
starts afresh there (you can still give them a character from BrainWaves).

## 5. Reaching the table from outside your home

On your home network, players use your server's LAN address. For players elsewhere, put the
table behind something that gives it a public **https** address:

- **Tailscale** (players join your tailnet, or use Tailscale Funnel), or
- **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:8090`), or
- your reverse proxy (Caddy, nginx, Traefik) with a certificate. Forward WebSocket upgrades
  for `/ws/`.

Then use the https address in BrainWaves too. The links and the live connection follow it
(`wss://` for the live link).

> If BrainWaves can't reach the server, the panel says so. Check the address, that port 8090
> is open on the server's firewall, and the DM key. A wrong key shows "The table server refused
> the DM key."

## 6. How it's built

```
BrainWaves (the DM)                          bw-table (your home server)            players' browsers
──────────────────                          ────────────────────────────            ─────────────────
battle map page (a canvas)                   POST /api/rooms  (Bearer DM key)
  tokens, reveals, image  ── projection ──▶  /ws/<code>?key=…  ── scene ──────────▶  /join/<code>
  dnd.scene: grid, fog,      (only what                         ◀─ ping, draw,       canvas page
  initiative                  players may see)                     move, roll, claim,
campaign page             ── rules, party sheets ──────────────────────────────▶     submit
  dnd.table: room, rules  ◀── requests, pings, rolls, players, submissions ──
```

- **The battle map** is an ordinary BrainWaves page with the D&D role `scene`, under its
  campaign. Tokens (`token`) and cleared areas (`reveal`) are canvas elements in the page,
  with the map picture (`image`), so they sync, undo and back up like everything else
  (`crates/bw-core/src/surface.rs`). The grid, fog switch and initiative are the page's
  `dnd.scene` property; the campaign's room code and character rules are the campaign's
  `dnd.table` property (`crates/bw-core/src/dnd.rs`).
- **What players see** is computed in BrainWaves (`apps/desktop/src/dnd/live.ts`, `project`).
  It includes the largest picture, the grid, the cleared areas, and tokens that aren't hidden.
  Player characters are always included; other tokens only when their center is in a cleared
  area. Hit points are sent for player characters only, and monsters get a status instead. The
  initiative leaves out tokens players can't see. The picture is sent once (by its SHA-256);
  the rest is re-sent shortly after each change.
- **Characters** (`apps/desktop/src/dnd/tableCharacters.ts`): BrainWaves sends players the
  options the rules allow (just what the form needs: names, sources, ability bonuses, hit die,
  skill choices). Players send back their choices, not a sheet. On approval, BrainWaves looks
  the choices up in your 5etools again and builds the sheet itself. The sheet follows your
  books, not the player's page, and anything outside your rules (a made-up race, scores no
  method allows) is flagged before you approve.
- **The server** (`crates/bw-table`, Rust: axum and tokio) relays and remembers. It keeps
  each room's last scene, its pictures (the last 6), its last 60 rolls, the rules, the party
  and the submissions on disk. Players' browser ids never leave the server, and players see
  only their own submissions. It rolls
  the dice itself so nobody can fake a roll. Only someone with the DM key can open rooms, send
  scenes and answer move requests. Players can only claim and request moves for player
  characters, and the server limits each connection to 20 messages a second.
- **The player page** (`apps/table`) is plain HTML, CSS and JavaScript served by the table
  server itself, in the same campaign look (Cinzel and EB Garamond, bundled under the SIL Open
  Font License).

### The protocol

JSON messages over the WebSocket `/ws/<code>?key=<DM key or empty>&name=<name>&pid=<browser id>`.

| From | Message | |
| --- | --- | --- |
| DM | `{t:"scene", scene}` | The player-safe scene (stored, sent to players). |
| DM | `{t:"image", hash, data}` | A map picture as a data URL; players fetch `/api/rooms/<code>/image/<hash>`. |
| DM | `{t:"decide", id, accept}` | Answer a move request. |
| DM | `{t:"rules", rules}` | The character rules, with the options players choose from. |
| DM | `{t:"party", party}` | The campaign's characters and their sheets; each player sees which are theirs (`mine`). |
| DM | `{t:"review", id, approve, note, characterId?}` | Approve a submission (BrainWaves made `characterId`) or send it back. |
| player | `{t:"submit", id?, character}` | Submit a character, or resubmit one that's waiting or was sent back. |
| player | `{t:"withdraw", id}` | Take back a submission that isn't approved yet. |
| player | `{t:"claim", token}` | "This one's me" (player characters only). |
| player | `{t:"move", token, x, y}` | Ask to move their character (x, y: the token's new center). |
| anyone | `{t:"ping", x, y}` / `{t:"draw", points}` | A ping, or a drawing that fades after 8 seconds. |
| anyone | `{t:"roll", expr, label?, private?}` | Roll dice (`private` only for the DM). |
| server | `welcome`, `scene`, `players`, `dm`, `ping`, `draw`, `roll`, `request` (DM only), `pending`, `decided`, `rules`, `party`, `submissions` (a player's own), `submission` / `reviewed` / `withdrawn` (DM only), `error` | |

### Tests

- `cargo test -p bw-table`: the dice roller; a DM and players over real WebSockets (claims,
  move requests, decisions, pings, rolls, the DM key); pictures and persistence
  across a restart; characters submitted, sent back, resubmitted and approved, ownership, and
  a player finding their character again after a restart.
- `cargo test -p bw-core --test dnd`: battle map pages, scene settings, token and reveal
  validation; a campaign's room and character rules.
- End to end (Playwright, a DM in BrainWaves and a player in a second browser) for a battle map,
  tokens from the party and the compendium, fog, going live, a move request accepted, pings and
  drawings, hit points, initiative and dice. It also checks that a hidden creature never reaches
  the server. A second run covers characters: rules set in BrainWaves, a player building a
  character, the DM sending it back with a note, the player fixing it, approval into the party,
  the player's sheet, and their token picked for them on the map.

### Limits and next steps

- One picture per battle map is sent to players (the largest); other images stay with you.
- Cleared areas are rectangles (the format also takes polygons, for a future freehand tool).
- No dynamic lighting, line of sight or walls, measurement, or area templates yet.
- Players can't move NPCs or monsters; the DM moves everything else.
- Players can't edit an approved character (level ups, equipment): the DM does it in BrainWaves.
- Hit point changes on a player character's token aren't written back to the character
  sheet.
