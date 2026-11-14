//! Importing a world from Azgaar's Fantasy Map Generator into a campaign (see `dnd.rs`).
//!
//! The generator runs in the browser and exports two things the user saves: the map picture
//! (PNG/SVG) and a JSON file with its states, cities ("burgs"), landmark markers with notes, and
//! religions. The app reads that JSON (it can be tens of megabytes, mostly terrain cells) and
//! sends the parts that matter here, already normalized, as an [`AzgaarWorld`]. This module turns
//! them into the campaign's pages and map:
//!
//! - states → Locations of kind *region*; cities → *city* or *village*; markers → *landmark*;
//! - religions → Factions;
//! - the picture → the World map's background, at the map's own size (one canvas unit per map
//!   pixel), and a pin for every city and landmark at its spot.
//!
//! Every page and pin remembers which Azgaar thing it is (`dnd.azgaar`, e.g. `burg:12`), so
//! importing again after editing the map updates names, kinds, the picture and pin positions in
//! place. Text written on those pages is never touched: generated text goes only onto new pages.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::core::Core;
use crate::dnd::MODULE_ID;
use crate::doc::{Inline, NewBlock, RefKind};
use crate::error::{Error, Result};
use crate::schema::{new_id, PageId};
use crate::surface::MAX_IMAGE;

const KEY: &str = "dnd.azgaar";
/// The background picture's element id on the map page.
const IMAGE_ID: &str = "azgaar-map";
const PIN_PREFIX: &str = "azgaar-pin-";

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AzgaarWorld {
    pub name: String,
    pub width: f64,
    pub height: f64,
    /// The map picture as a data URL; `None` keeps the current one.
    pub image: Option<String>,
    pub regions: Vec<AzPlace>,
    pub places: Vec<AzPlace>,
    pub factions: Vec<AzFaction>,
}

/// A state, city or landmark.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AzPlace {
    /// Azgaar's identity: `state:3`, `burg:12`, `marker:7`.
    pub key: String,
    pub title: String,
    /// region / city / village / landmark.
    pub kind: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    /// The region (`state:…` key) a city lies in.
    pub region: Option<String>,
    /// Lines of text for a new page.
    pub text: Vec<String>,
    /// Pin color name (gold for capitals, …).
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AzFaction {
    pub key: String,
    pub title: String,
    pub goal: String,
    pub text: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AzgaarReport {
    pub created: usize,
    pub updated: usize,
    pub pins: usize,
    pub removed_pins: usize,
    pub factions: usize,
    pub map: PageId,
}

const KINDS: [&str; 4] = ["region", "city", "village", "landmark"];

impl Core {
    pub fn dnd_import_azgaar(
        &mut self,
        campaign: &str,
        world: &AzgaarWorld,
    ) -> Result<AzgaarReport> {
        if !(world.width > 0.0
            && world.height > 0.0
            && world.width < 100_000.0
            && world.height < 100_000.0)
        {
            return Err(Error::Invalid(
                "the map needs its width and height (from the JSON export's info)".into(),
            ));
        }
        if let Some(img) = &world.image {
            if !img.starts_with("data:image/") || img.len() > MAX_IMAGE {
                return Err(Error::Invalid(format!(
                    "the map picture must be an image of at most {} MB",
                    MAX_IMAGE >> 20
                )));
            }
        }
        let parts = self
            .dnd_campaign(campaign)?
            .parts
            .ok_or_else(|| Error::Invalid("campaign has no parts".into()))?;
        let mut report = AzgaarReport {
            map: parts.map.clone(),
            ..Default::default()
        };

        // Pages already imported, by Azgaar key.
        let mut known: BTreeMap<String, PageId> = BTreeMap::new();
        for db in [&parts.locations, &parts.factions] {
            for row in self.module_query(MODULE_ID, db, None)?.rows {
                if let Some(k) = self
                    .module_props(MODULE_ID, &row.id)?
                    .get(KEY)
                    .and_then(|v| v.as_str())
                {
                    known.insert(k.to_string(), row.id);
                }
            }
        }

        // Regions first, so cities can link to theirs.
        for place in world.regions.iter().chain(&world.places) {
            if place.key.is_empty() || place.title.trim().is_empty() {
                continue;
            }
            let kind = if KINDS.contains(&place.kind.as_str()) {
                place.kind.as_str()
            } else {
                "landmark"
            };
            match known.get(&place.key).cloned() {
                Some(id) => {
                    self.module_set_value(MODULE_ID, &id, "title", json!(place.title.trim()))?;
                    self.module_set_value(MODULE_ID, &id, "kind", json!(kind))?;
                    report.updated += 1;
                }
                None => {
                    let id = new_id();
                    self.module_create_row(
                        MODULE_ID,
                        &parts.locations,
                        &id,
                        place.title.trim(),
                        &BTreeMap::from([("kind".to_string(), json!(kind))]),
                    )?;
                    self.module_set_props(
                        MODULE_ID,
                        &id,
                        &BTreeMap::from([(KEY.to_string(), json!(place.key))]),
                    )?;
                    let region = place.region.as_ref().and_then(|r| known.get(r)).cloned();
                    self.write_lines(&id, &place.text, region.as_deref())?;
                    known.insert(place.key.clone(), id);
                    report.created += 1;
                }
            }
        }

        for f in &world.factions {
            if f.key.is_empty() || f.title.trim().is_empty() {
                continue;
            }
            match known.get(&f.key).cloned() {
                Some(id) => {
                    self.module_set_value(MODULE_ID, &id, "title", json!(f.title.trim()))?;
                    self.module_set_value(MODULE_ID, &id, "goal", json!(f.goal))?;
                    report.updated += 1;
                }
                None => {
                    let id = new_id();
                    self.module_create_row(
                        MODULE_ID,
                        &parts.factions,
                        &id,
                        f.title.trim(),
                        &BTreeMap::from([("goal".to_string(), json!(f.goal))]),
                    )?;
                    self.module_set_props(
                        MODULE_ID,
                        &id,
                        &BTreeMap::from([(KEY.to_string(), json!(f.key))]),
                    )?;
                    self.write_lines(&id, &f.text, None)?;
                    known.insert(f.key.clone(), id);
                    report.factions += 1;
                }
            }
        }

        // The map: picture under everything at the map's own size, a pin per placed thing.
        let pins: Vec<(String, Value)> = world
            .places
            .iter()
            .filter_map(|p| {
                let (x, y) = (p.x?, p.y?);
                let page = known.get(&p.key)?;
                if !(0.0..=world.width).contains(&x) || !(0.0..=world.height).contains(&y) {
                    return None;
                }
                let size = if p.kind == "city" { 22.0 } else { 18.0 };
                Some((
                    format!("{PIN_PREFIX}{}", p.key.replace(':', "-")),
                    json!({
                        "type": "pin", "index": format!("m{}", p.key.replace(':', "")),
                        "xywh": [(x - size / 2.0).round(), (y - size).round(), size, size],
                        "page": page, "text": p.title.trim(), "color": p.color.clone().unwrap_or_else(|| "red".into()),
                        "azgaar": true,
                    }),
                ))
            })
            .collect();
        let wanted: BTreeSet<String> = pins.iter().map(|(id, _)| id.clone()).collect();
        let existing: Vec<String> = self
            .snapshot(&parts.map)?
            .blocks
            .iter()
            .filter(|b| b.flavour == "surface.pin" && b.id.starts_with(PIN_PREFIX))
            .map(|b| b.id.clone())
            .collect();
        report.pins = pins.len();
        report.removed_pins = existing.iter().filter(|id| !wanted.contains(*id)).count();
        let (w, h) = (world.width.round(), world.height.round());
        self.transact(&parts.map, |t| {
            if let Some(img) = &world.image {
                t.set_element(IMAGE_ID, json!({ "type": "image", "index": "A0", "xywh": [0, 0, w, h], "src": img, "azgaar": true }))?;
            }
            for id in &existing {
                if !wanted.contains(id) {
                    t.remove_element(id);
                }
            }
            for (id, el) in pins {
                t.set_element(&id, el)?;
            }
            // The map's note goes beside the picture, out of its way.
            let note = t.first_note()?;
            t.set_note_layout(&note, Some([-800.0, 0.0, 720.0, 80.0]), None)
        })?;
        if !world.name.trim().is_empty() {
            self.module_set_props(
                MODULE_ID,
                &parts.map,
                &BTreeMap::from([("dnd.mapName".to_string(), json!(world.name.trim()))]),
            )?;
        }
        Ok(report)
    }

    /// Generated text for a new page: one paragraph per line; a line starting with `@region`
    /// becomes "In <region>" with a link to the region's page.
    fn write_lines(&mut self, page: &str, lines: &[String], region: Option<&str>) -> Result<()> {
        if lines.is_empty() && region.is_none() {
            return Ok(());
        }
        self.transact(page, |t| {
            let note = t.first_note()?;
            let mut i = 0;
            if let Some(r) = region {
                t.insert(
                    &note,
                    Some(i),
                    NewBlock::paragraph_with(vec![
                        Inline::Text("In ".into()),
                        Inline::Ref {
                            kind: RefKind::Page,
                            target: r.to_string(),
                        },
                        Inline::Text(".".into()),
                    ]),
                )?;
                i += 1;
            }
            for line in lines.iter().filter(|l| !l.trim().is_empty()).take(40) {
                let text: String = line.chars().take(4000).collect();
                t.insert(&note, Some(i), NewBlock::paragraph(&text))?;
                i += 1;
            }
            Ok(())
        })
    }
}
