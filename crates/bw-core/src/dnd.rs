//! The D&D module: first-party, held to the same capability checks as any module.
//!
//! - **Campaigns** and **Characters** are two databases (one of each per workspace). A
//!   character's *Campaign* is a two-way relation, so a campaign's page lists its party.
//! - A **campaign** is a row of Campaigns. Setting one up gives it its own databases, as sub-pages
//!   of the campaign: NPCs, Locations, Factions, Sessions and Story beats (all linked to each
//!   other), plus a World map page for the canvas.
//! - **Story beats** are planned, foreshadowed, happened or skipped, belong to an arc, and link the
//!   NPCs, locations and factions they involve and the session they happened in. A **template**
//!   (three-act, hero's journey, five-room dungeon, mystery, heist) adds an arc's beats in one go.
//! - A **character sheet** is a character row's `dnd.sheet` prop (abilities, HP, spells,
//!   inventory, …). A few of its values are mirrored into columns, so the Characters table and
//!   the party view show them.
//! - **5e content** comes from the user's own 5etools site. The module stores its address; the
//!   host fetches its data files (see `bw-api/src/fivee.rs`). None of that content is stored here.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::core::Core;
use crate::database::{NewRelation, PropType, Property, SelectOption, Sort, View, ViewKind};
use crate::error::{Error, Result};
use crate::modules::ModuleManifest;
use crate::schema::{new_id, PageId, PageMeta};

pub const MODULE_ID: &str = "brainwaves.dnd";

const ROLE: &str = "dnd.role";
const SHEET: &str = "dnd.sheet";
const PARTS: &str = "dnd.parts";

pub fn manifest() -> ModuleManifest {
    ModuleManifest {
        id: MODULE_ID.into(),
        name: "Dungeons & Dragons".into(),
        description: "Campaigns, story beats, world maps and character sheets, with 5e content from your own 5etools.".into(),
        version: "1".into(),
        icon: "🐉".into(),
        namespace: "dnd".into(),
        capabilities: vec!["db.own".into()],
    }
}

/// The databases and pages of one campaign.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignParts {
    pub npcs: PageId,
    pub locations: PageId,
    pub factions: PageId,
    pub sessions: PageId,
    pub beats: PageId,
    pub map: PageId,
    /// Relation columns of Story beats, by what they point at.
    pub beat_session: String,
    pub beat_npcs: String,
    pub beat_locations: String,
    pub beat_factions: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub campaigns: PageId,
    pub characters: PageId,
    /// Characters → Campaign, and its other side (the party) on Campaigns.
    pub character_campaign: String,
    pub campaign_party: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Campaign {
    pub id: PageId,
    pub title: String,
    pub parts: Option<CampaignParts>,
}

fn prop(id: &str, name: &str, kind: PropType, order: &str) -> Property {
    Property {
        id: id.into(),
        name: name.into(),
        kind,
        order: order.into(),
        options: vec![],
        relation: None,
        rollup: None,
    }
}

fn select(id: &str, name: &str, order: &str, opts: &[(&str, &str, &str)]) -> Property {
    Property {
        options: opts
            .iter()
            .map(|(i, n, c)| SelectOption {
                id: (*i).into(),
                name: (*n).into(),
                color: (*c).into(),
            })
            .collect(),
        ..prop(id, name, PropType::Select, order)
    }
}

/// A story-beat template: (title, what happens).
pub fn beat_template(name: &str) -> Option<(&'static str, Vec<(&'static str, &'static str)>)> {
    Some(match name {
        "three-act" => (
            "Three acts",
            vec![
                (
                    "The hook",
                    "Something disturbs the status quo and pulls the party in.",
                ),
                (
                    "Point of no return",
                    "The party commits; turning back now costs too much.",
                ),
                (
                    "Rising trouble",
                    "Complications pile up; allies and enemies show their hand.",
                ),
                (
                    "Midpoint twist",
                    "A revelation changes what the party thinks the story is about.",
                ),
                ("Darkest hour", "The plan fails or a loss hits hard."),
                ("Climax", "The final confrontation, on ground that matters."),
                (
                    "Resolution",
                    "Consequences land; seeds for what comes next.",
                ),
            ],
        ),
        "heros-journey" => (
            "Hero's journey",
            vec![
                ("Ordinary world", "Show what the heroes stand to lose."),
                ("Call to adventure", "A messenger, an omen or a disaster."),
                ("Mentor", "Someone offers knowledge, a gift or a warning."),
                (
                    "Crossing the threshold",
                    "The party leaves the familiar behind.",
                ),
                ("Tests, allies, enemies", "The new world shows its rules."),
                (
                    "The ordeal",
                    "Face the greatest fear; something dies, literally or not.",
                ),
                (
                    "The reward",
                    "The treasure, the truth or the power, and its price.",
                ),
                (
                    "The road back",
                    "The enemy strikes back as the party heads home.",
                ),
                (
                    "Return with the elixir",
                    "The world is changed by what they bring back.",
                ),
            ],
        ),
        "five-room" => (
            "Five-room dungeon",
            vec![
                (
                    "Entrance and guardian",
                    "A reason the place has stayed hidden or untouched.",
                ),
                (
                    "Puzzle or roleplay",
                    "A challenge that can't be solved with steel.",
                ),
                (
                    "Setback or trick",
                    "A trap, a betrayal or the floor giving way.",
                ),
                ("Climax", "The big fight or the big choice."),
                (
                    "Reward and revelation",
                    "Treasure, and a twist that points onward.",
                ),
            ],
        ),
        "mystery" => (
            "Mystery",
            vec![
                ("The crime", "What happened, as the party first hears it."),
                ("First clues", "Three clues that point to the first lead."),
                ("Suspects", "People with motive, means or opportunity."),
                ("Red herring", "A lead that is wrong in an interesting way."),
                ("The real lead", "A clue that reframes everything."),
                (
                    "Confrontation",
                    "The culprit is cornered, and fights, flees or bargains.",
                ),
                ("Aftermath", "Justice, mercy or a cover-up."),
            ],
        ),
        "heist" => (
            "Heist",
            vec![
                ("The job", "Who wants what stolen, and why the party."),
                ("Casing the target", "Guards, wards, schedules and secrets."),
                ("The plan", "Roles, tools and the getaway."),
                ("Complication", "Something nobody planned for."),
                ("The score", "Inside, at the vault."),
                ("The double-cross", "Someone wasn't who they said."),
                ("The getaway", "Out, with or without the prize."),
            ],
        ),
        _ => return None,
    })
}

impl Core {
    pub fn register_dnd_module(&mut self) -> Result<()> {
        self.install_module(&manifest(), "", true)
    }

    // ---- 5etools

    /// Where the user's 5etools site runs, e.g. `http://localhost:5050/`.
    pub fn dnd_set_source(&mut self, url: &str) -> Result<String> {
        let url = url.trim();
        let ok = (url.starts_with("http://") || url.starts_with("https://"))
            && url.len() < 512
            && !url.contains(char::is_whitespace);
        if !ok {
            return Err(Error::Invalid(format!("{url:?} is not an http(s) address")));
        }
        let url = if url.ends_with('/') {
            url.to_string()
        } else {
            format!("{url}/")
        };
        self.conn().execute(
            "DELETE FROM module_grants WHERE module_id = ?1 AND kind = 'source'",
            [MODULE_ID],
        )?;
        self.conn().execute(
            "INSERT INTO module_grants(module_id, kind, value, granted_at) VALUES (?1, 'source', ?2, ?3)",
            rusqlite::params![MODULE_ID, url, crate::store::now_millis()],
        )?;
        Ok(url)
    }

    pub fn dnd_source(&self) -> Result<Option<String>> {
        use rusqlite::OptionalExtension;
        Ok(self
            .conn()
            .query_row(
                "SELECT value FROM module_grants WHERE module_id = ?1 AND kind = 'source'",
                [MODULE_ID],
                |r| r.get(0),
            )
            .optional()?)
    }

    // ---- the workspace's Campaigns and Characters

    /// The Campaigns and Characters databases, created (at the top level) the first time.
    pub fn dnd_workspace(&mut self) -> Result<Workspace> {
        if let Some(c) = self
            .pages_with_prop(ROLE, &json!("campaigns"))?
            .into_iter()
            .next()
        {
            let p = self.module_props(MODULE_ID, &c)?;
            let s = |k: &str| p.get(k).and_then(|v| v.as_str()).map(String::from);
            if let (Some(characters), Some(cc), Some(cp)) = (
                s("dnd.characters"),
                s("dnd.characterCampaign"),
                s("dnd.campaignParty"),
            ) {
                return Ok(Workspace {
                    campaigns: c,
                    characters,
                    character_campaign: cc,
                    campaign_party: cp,
                });
            }
        }
        let m = MODULE_ID;
        let meta = |title: &str, icon: &str| PageMeta {
            title: title.into(),
            icon: icon.into(),
            ..Default::default()
        };
        let campaigns = self.module_create_database(m, &new_id(), meta("Campaigns", "🗺️"))?;
        let characters = self.module_create_database(m, &new_id(), meta("Characters", "🛡️"))?;

        self.set_property(
            &campaigns,
            select(
                "status",
                "Status",
                "a1",
                &[
                    ("planning", "Planning", "gray"),
                    ("active", "Active", "green"),
                    ("paused", "Paused", "yellow"),
                    ("finished", "Finished", "brown"),
                ],
            ),
        )?;
        self.set_property(
            &campaigns,
            prop("dm", "Dungeon master", PropType::Text, "a2"),
        )?;
        self.set_property(&campaigns, prop("setting", "Setting", PropType::Text, "a3"))?;

        self.set_property(&characters, prop("player", "Player", PropType::Text, "a1"))?;
        self.set_property(&characters, prop("race", "Race", PropType::Text, "a2"))?;
        self.set_property(&characters, prop("class", "Class", PropType::Text, "a3"))?;
        self.set_property(&characters, prop("level", "Level", PropType::Number, "a4"))?;
        self.set_property(&characters, prop("hp", "HP", PropType::Number, "a5"))?;
        self.set_property(&characters, prop("maxHp", "Max HP", PropType::Number, "a6"))?;
        self.set_property(&characters, prop("ac", "AC", PropType::Number, "a7"))?;

        let (cc, cp) = self.create_relation(
            &characters,
            &NewRelation {
                name: "Campaign".into(),
                target_database: campaigns.clone(),
                two_way: true,
                reverse_name: Some("Party".into()),
            },
        )?;
        let cp =
            cp.ok_or_else(|| Error::Malformed("two-way relation without a reverse column".into()))?;
        let mut gallery = view("Party", ViewKind::Gallery);
        gallery.hidden = vec!["maxHp".into()];
        self.set_view(&characters, gallery)?;

        let s = |v: &str| Value::String(v.to_string());
        self.module_set_props(
            m,
            &campaigns,
            &BTreeMap::from([
                (ROLE.into(), s("campaigns")),
                ("dnd.characters".into(), s(&characters)),
                ("dnd.characterCampaign".into(), s(&cc)),
                ("dnd.campaignParty".into(), s(&cp)),
            ]),
        )?;
        self.module_set_props(
            m,
            &characters,
            &BTreeMap::from([(ROLE.into(), s("characters"))]),
        )?;
        Ok(Workspace {
            campaigns,
            characters,
            character_campaign: cc,
            campaign_party: cp,
        })
    }

    /// A new campaign with its NPCs, Locations, Factions, Sessions, Story beats and World map.
    pub fn dnd_create_campaign(&mut self, title: &str) -> Result<Campaign> {
        let w = self.dnd_workspace()?;
        let id = new_id();
        let title = if title.trim().is_empty() {
            "New campaign"
        } else {
            title.trim()
        };
        self.module_create_row(
            MODULE_ID,
            &w.campaigns,
            &id,
            title,
            &BTreeMap::from([("status".into(), json!("planning"))]),
        )?;
        self.module_set_props(
            MODULE_ID,
            &id,
            &BTreeMap::from([(ROLE.into(), json!("campaign"))]),
        )?;
        let parts = self.dnd_campaign_parts(&id)?;
        Ok(Campaign {
            id,
            title: title.into(),
            parts: Some(parts),
        })
    }

    /// Create a campaign's databases (once) under its page.
    fn dnd_campaign_parts(&mut self, campaign: &str) -> Result<CampaignParts> {
        if let Some(p) = self.module_props(MODULE_ID, campaign)?.get(PARTS) {
            if let Ok(parts) = serde_json::from_value::<CampaignParts>(p.clone()) {
                return Ok(parts);
            }
        }
        let m = MODULE_ID;
        let under = |title: &str, icon: &str| PageMeta {
            title: title.into(),
            icon: icon.into(),
            parent_id: Some(campaign.to_string()),
            ..Default::default()
        };
        let npcs = self.module_create_database(m, &new_id(), under("NPCs", "🧙"))?;
        let locations = self.module_create_database(m, &new_id(), under("Locations", "🏰"))?;
        let factions = self.module_create_database(m, &new_id(), under("Factions", "⚜️"))?;
        let sessions = self.module_create_database(m, &new_id(), under("Sessions", "📜"))?;
        let beats = self.module_create_database(m, &new_id(), under("Story beats", "✒️"))?;
        let map = self.create_page(under("World map", "🧭"))?;

        self.set_property(&npcs, prop("role", "Role", PropType::Text, "a1"))?;
        self.set_property(
            &npcs,
            select(
                "attitude",
                "Attitude",
                "a2",
                &[
                    ("friendly", "Friendly", "green"),
                    ("neutral", "Neutral", "gray"),
                    ("hostile", "Hostile", "red"),
                ],
            ),
        )?;
        self.set_property(
            &npcs,
            select(
                "status",
                "Status",
                "a3",
                &[
                    ("alive", "Alive", "green"),
                    ("dead", "Dead", "red"),
                    ("missing", "Missing", "yellow"),
                    ("unknown", "Unknown", "gray"),
                ],
            ),
        )?;
        self.set_property(
            &locations,
            select(
                "kind",
                "Kind",
                "a1",
                &[
                    ("region", "Region", "green"),
                    ("city", "City", "yellow"),
                    ("village", "Village", "brown"),
                    ("dungeon", "Dungeon", "red"),
                    ("wilderness", "Wilderness", "green"),
                    ("landmark", "Landmark", "blue"),
                ],
            ),
        )?;
        self.set_property(&factions, prop("goal", "Goal", PropType::Text, "a1"))?;
        self.set_property(&sessions, prop("number", "Session", PropType::Number, "a1"))?;
        self.set_property(&sessions, prop("date", "Date", PropType::Date, "a2"))?;
        self.set_property(&sessions, prop("summary", "Summary", PropType::Text, "a3"))?;
        self.set_property(
            &beats,
            select(
                "status",
                "Status",
                "a1",
                &[
                    ("planned", "Planned", "gray"),
                    ("foreshadowed", "Foreshadowed", "purple"),
                    ("happened", "Happened", "green"),
                    ("skipped", "Skipped", "brown"),
                ],
            ),
        )?;
        self.set_property(&beats, prop("arc", "Arc", PropType::Text, "a2"))?;
        self.set_property(&beats, prop("order", "Order", PropType::Number, "a3"))?;
        self.set_property(&beats, prop("notes", "Notes", PropType::Text, "a4"))?;

        let rel = |core: &mut Core,
                   from: &str,
                   to: &str,
                   name: &str,
                   back: &str|
         -> Result<(String, String)> {
            let (a, b) = core.create_relation(
                from,
                &NewRelation {
                    name: name.into(),
                    target_database: to.into(),
                    two_way: true,
                    reverse_name: Some(back.into()),
                },
            )?;
            Ok((a, b.unwrap_or_default()))
        };
        rel(self, &npcs, &locations, "Location", "NPCs")?;
        rel(self, &npcs, &factions, "Faction", "Members")?;
        let (beat_session, _) = rel(self, &beats, &sessions, "Session", "Story beats")?;
        let (beat_npcs, _) = rel(self, &beats, &npcs, "NPCs", "Story beats")?;
        let (beat_locations, _) = rel(self, &beats, &locations, "Locations", "Story beats")?;
        let (beat_factions, _) = rel(self, &beats, &factions, "Factions", "Story beats")?;

        // Story beats: a board by status, and the plan in order.
        let mut board = view("Board", ViewKind::Board);
        board.group_by = Some("status".into());
        board.sorts = vec![Sort {
            property: "order".into(),
            desc: false,
        }];
        self.set_view(&beats, board)?;
        let mut table = self.database_def(&beats)?.views[0].clone();
        table.sorts = vec![
            Sort {
                property: "arc".into(),
                desc: false,
            },
            Sort {
                property: "order".into(),
                desc: false,
            },
        ];
        self.set_view(&beats, table)?;
        let mut stable = self.database_def(&sessions)?.views[0].clone();
        stable.sorts = vec![Sort {
            property: "number".into(),
            desc: true,
        }];
        self.set_view(&sessions, stable)?;

        let parts = CampaignParts {
            npcs,
            locations,
            factions,
            sessions,
            beats,
            map,
            beat_session,
            beat_npcs,
            beat_locations,
            beat_factions,
        };
        let mut props = BTreeMap::from([(
            PARTS.to_string(),
            serde_json::to_value(&parts).map_err(|e| Error::Invalid(e.to_string()))?,
        )]);
        for (db, role) in [
            (&parts.npcs, "npcs"),
            (&parts.locations, "locations"),
            (&parts.factions, "factions"),
            (&parts.sessions, "sessions"),
            (&parts.beats, "beats"),
        ] {
            self.module_set_props(
                MODULE_ID,
                db,
                &BTreeMap::from([
                    (ROLE.to_string(), json!(role)),
                    ("dnd.campaign".to_string(), json!(campaign)),
                ]),
            )?;
        }
        self.transact(&parts.map, |t| {
            t.set_prop(&parts.map, ROLE, json!("map"))?;
            t.set_prop(&parts.map, "dnd.campaign", json!(campaign))
        })?;
        props.insert(ROLE.into(), json!("campaign"));
        self.module_set_props(MODULE_ID, campaign, &props)?;
        Ok(parts)
    }

    /// Every campaign, oldest first.
    pub fn dnd_campaigns(&mut self) -> Result<Vec<Campaign>> {
        let w = self.dnd_workspace()?;
        let rows = self.module_query(MODULE_ID, &w.campaigns, None)?.rows;
        let mut out = vec![];
        for r in rows {
            let parts = self
                .module_props(MODULE_ID, &r.id)?
                .get(PARTS)
                .and_then(|p| serde_json::from_value(p.clone()).ok());
            out.push(Campaign {
                id: r.id,
                title: r.title,
                parts,
            });
        }
        Ok(out)
    }

    /// A campaign; its databases are created the first time (for a row added by hand).
    pub fn dnd_campaign(&mut self, id: &str) -> Result<Campaign> {
        let w = self.dnd_workspace()?;
        let meta = self.snapshot(id)?.meta;
        if meta.database_id.as_deref() != Some(w.campaigns.as_str()) {
            return Err(Error::Invalid(format!("{id} is not a campaign")));
        }
        let parts = self.dnd_campaign_parts(id)?;
        Ok(Campaign {
            id: id.into(),
            title: meta.title,
            parts: Some(parts),
        })
    }

    /// Add a template's beats to a campaign, as a new arc. Returns the new rows.
    pub fn dnd_add_beats(
        &mut self,
        campaign: &str,
        template: &str,
        arc: &str,
    ) -> Result<Vec<PageId>> {
        let (name, beats) = beat_template(template)
            .ok_or_else(|| Error::Invalid(format!("no story template {template:?}")))?;
        let parts = self.dnd_campaign(campaign)?.parts.unwrap_or_default();
        let arc = if arc.trim().is_empty() {
            name.to_string()
        } else {
            arc.trim().to_string()
        };
        let mut out = vec![];
        for (i, (title, notes)) in beats.into_iter().enumerate() {
            let id = new_id();
            let values = BTreeMap::from([
                ("status".to_string(), json!("planned")),
                ("arc".to_string(), json!(arc)),
                ("order".to_string(), json!(i + 1)),
                ("notes".to_string(), json!(notes)),
            ]);
            self.module_create_row(MODULE_ID, &parts.beats, &id, title, &values)?;
            out.push(id);
        }
        Ok(out)
    }

    // ---- characters

    /// A new character (optionally in a campaign) with its sheet.
    pub fn dnd_create_character(
        &mut self,
        name: &str,
        sheet: Value,
        campaign: Option<&str>,
    ) -> Result<PageId> {
        let w = self.dnd_workspace()?;
        let id = new_id();
        let mut values = BTreeMap::new();
        if let Some(c) = campaign {
            values.insert(w.character_campaign.clone(), json!([c]));
        }
        self.module_create_row(MODULE_ID, &w.characters, &id, name, &values)?;
        self.dnd_set_sheet(&id, sheet)?;
        Ok(id)
    }

    /// Save a character's sheet, and mirror its headline values into the Characters columns.
    pub fn dnd_set_sheet(&mut self, character: &str, sheet: Value) -> Result<()> {
        let w = self.dnd_workspace()?;
        if self.snapshot(character)?.meta.database_id.as_deref() != Some(w.characters.as_str()) {
            return Err(Error::Invalid(format!("{character} is not a character")));
        }
        if !sheet.is_object() {
            return Err(Error::Invalid("a character sheet is a JSON object".into()));
        }
        if sheet.to_string().len() > 512 * 1024 {
            return Err(Error::Invalid(
                "character sheet is larger than 512 KB".into(),
            ));
        }
        self.module_set_props(
            MODULE_ID,
            character,
            &BTreeMap::from([(SHEET.to_string(), sheet.clone())]),
        )?;
        let current = self
            .module_query(MODULE_ID, &w.characters, None)?
            .rows
            .into_iter()
            .find(|r| r.id == character)
            .map(|r| r.values)
            .unwrap_or_default();
        let text = |k: &str| {
            sheet
                .get(k)
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| json!(s))
        };
        let num = |v: Option<&Value>| v.and_then(|v| v.as_f64()).map(|n| json!(n));
        let mirror = [
            ("player", text("player")),
            ("race", text("race")),
            ("class", text("classLabel").or_else(|| text("class"))),
            ("level", num(sheet.get("level"))),
            ("hp", num(sheet.pointer("/hp/current"))),
            ("maxHp", num(sheet.pointer("/hp/max"))),
            ("ac", num(sheet.get("ac"))),
        ];
        for (col, v) in mirror {
            let v = v.unwrap_or(Value::Null);
            let same = current.get(col) == Some(&v) || (v.is_null() && !current.contains_key(col));
            if !same {
                self.module_set_value(MODULE_ID, character, col, v)?;
            }
        }
        Ok(())
    }

    pub fn dnd_sheet(&mut self, character: &str) -> Result<Value> {
        Ok(self
            .module_props(MODULE_ID, character)?
            .remove(SHEET)
            .unwrap_or_else(|| json!({})))
    }

    /// Pages that get the campaign look: the D&D databases and every campaign's and character's
    /// page (the app also themes their sub-pages).
    pub fn dnd_themed_roots(&self) -> Result<Vec<PageId>> {
        let mut out = vec![];
        for role in ["campaigns", "characters", "campaign"] {
            out.extend(self.pages_with_prop(ROLE, &json!(role))?);
        }
        if let Some(chars) = self.pages_with_prop(ROLE, &json!("characters"))?.first() {
            let rows: Vec<String> = self
                .conn()
                .prepare("SELECT id FROM page_meta WHERE database_id = ?1 AND trashed_at IS NULL")?
                .query_map([chars], |r| r.get(0))?
                .collect::<std::result::Result<_, _>>()?;
            out.extend(rows);
        }
        out.sort();
        out.dedup();
        Ok(out)
    }
}

fn view(name: &str, kind: ViewKind) -> View {
    View {
        id: new_id(),
        name: name.into(),
        kind,
        order: String::new(),
        filters: vec![],
        sorts: vec![],
        group_by: None,
        hidden: vec![],
    }
}
