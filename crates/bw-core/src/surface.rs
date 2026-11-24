//! Edgeless elements: what lives on a page's canvas besides its notes.
//!
//! The canvas shows a page's **notes** (placed by their `xywh`) and the elements in the page's
//! `surface` map. Each element is a `Y.Map` of plain values, one per field, so two people
//! editing different fields of the same shape never conflict:
//!
//! | type        | fields                                                                  |
//! |-------------|-------------------------------------------------------------------------|
//! | `shape`     | `xywh`, `shape` (rect / ellipse / diamond), `fill`, `stroke`, `text`     |
//! | `text`      | `xywh`, `text`, `fontSize`, `color`                                      |
//! | `connector` | `source`, `target` (each `{ id }` of a note or element, or `{ point: [x, y] }`), `text`, `stroke` |
//! | `frame`     | `xywh`, `text` (the frame's title), `fill`                               |
//! | `image`     | `xywh`, `src` (a `data:image/…` URL, e.g. a world map)                   |
//! | `pin`       | `xywh`, `page` (the page it marks), `text` (its label), `icon`           |
//! | `token`     | `xywh`, `text` (name), `page` (character/NPC/monster page), `hidden` (DM only), `hp`, `maxHp`, `ac`, `color`, `owner` |
//! | `reveal`    | `xywh` (its bounds), optional `points` (a polygon): an area cleared of fog |
//! | `bookmark`  | `xywh`, `url`, `text` (title), `burrowId`, `image`, `site`: a link card (e.g. from Burrow) |
//! | `area`      | `xywh`, `shape` (rect / ellipse / poly / path), `pts` (0–1 in the box), `width`, `op` (add / carve), `material`: a battle map's floor or terrain |
//! | `wall`      | `xywh`, `pts` (0–1 in the box), `kind` (wall / door / secret / window / half / bars), `open`: a battle map's wall or opening |
//! | `prop`      | `xywh`, `asset` (`b:<built-in>` or `u:<upload hash>`), `light`, `flip`: a battle map's prop |
//! | `light`     | `xywh`, `light` (`bright`, `dim` in feet, `color`, `flicker`, `cone`): a light on a battle map |
//!
//! Battle map elements also carry `layer` (terrain / architecture / props / gm / tokens).
//!
//! Every element also has `id`, `type` and `index`, a fractional key for the stacking order
//! (and the order frames are presented in). Any element may also carry `rotate` (degrees),
//! `opacity`, `locked`, `visible` (false: kept but not drawn) and `group` (a shared id); text and
//! shapes may carry `fontFamily`, `bold`, `italic`, `underline` and `align`, and shapes
//! `strokeWidth` and `color`. Colors are a name or a `#hex`. Fields this version doesn't know are kept as they
//! are, so a newer client's additions survive an older one.
//!
//! The index stores each element as a block with flavour `surface.<type>` and its `text`, so
//! search finds words written on the canvas. A pin is also a reference to its page, so the page's
//! backlinks show the maps it is marked on. An image's `src` is left out of the index: it is the
//! picture itself, often megabytes.

use std::collections::BTreeMap;

use serde_json::Value;
use yrs::{Any, Map, MapRef, Out, ReadTxn};

use crate::doc::to_json;
use crate::error::{Error, Result};
use crate::schema::keys;

pub const TYPES: [&str; 13] = [
    "shape",
    "text",
    "connector",
    "frame",
    "image",
    "pin",
    "token",
    "reveal",
    "bookmark",
    "area",
    "wall",
    "prop",
    "light",
];

/// Largest image an element may hold (as a data URL).
pub const MAX_IMAGE: usize = 16 * 1024 * 1024;

/// An element as read back from the doc.
#[derive(Debug, Clone, PartialEq)]
pub struct Element {
    pub id: String,
    pub kind: String,
    pub index: String,
    pub text: String,
    /// Every field except `id` and `text`, as JSON (including `type` and `index`).
    pub attrs: BTreeMap<String, Value>,
}

fn bad(id: &str, why: impl std::fmt::Display) -> Error {
    Error::Invalid(format!("element {id}: {why}"))
}

fn is_xywh(v: &Value) -> bool {
    matches!(v, Value::Array(a) if a.len() == 4
        && a.iter().all(|n| n.as_f64().is_some_and(f64::is_finite))
        && a[2].as_f64().unwrap_or(0.0) >= 0.0
        && a[3].as_f64().unwrap_or(0.0) >= 0.0)
}

fn is_end(v: &Value) -> bool {
    match v {
        Value::Object(o) => match (o.get("id"), o.get("point")) {
            (Some(Value::String(s)), _) => !s.is_empty(),
            (None, Some(Value::Array(p))) => {
                p.len() == 2 && p.iter().all(|n| n.as_f64().is_some_and(f64::is_finite))
            }
            _ => false,
        },
        _ => false,
    }
}

/// Check an element before it's written; returns its fields with `id` filled in.
pub fn validate(id: &str, element: Value) -> Result<BTreeMap<String, Value>> {
    let Value::Object(fields) = element else {
        return Err(bad(id, "must be a JSON object"));
    };
    let mut fields: BTreeMap<String, Value> = fields.into_iter().collect();
    let kind = match fields.get(keys::EL_TYPE) {
        Some(Value::String(t)) if TYPES.contains(&t.as_str()) => t.clone(),
        other => {
            return Err(bad(
                id,
                format!("type must be one of {TYPES:?}, not {other:?}"),
            ))
        }
    };
    if kind == "connector" {
        for end in ["source", "target"] {
            if !fields.get(end).is_some_and(is_end) {
                return Err(bad(
                    id,
                    format!("{end} must be {{ id }} or {{ point: [x, y] }}"),
                ));
            }
        }
    } else if !fields.get("xywh").is_some_and(is_xywh) {
        return Err(bad(id, "xywh must be [x, y, w, h] with w, h >= 0"));
    }
    if kind == "image" {
        let ok = fields
            .get("src")
            .and_then(Value::as_str)
            .is_some_and(|s| s.starts_with("data:image/") && s.len() <= MAX_IMAGE);
        if !ok {
            return Err(bad(
                id,
                format!(
                    "src must be a data:image/ URL of at most {} MB",
                    MAX_IMAGE >> 20
                ),
            ));
        }
    }
    if kind == "pin"
        && !fields
            .get("page")
            .and_then(Value::as_str)
            .is_some_and(|p| !p.is_empty())
    {
        return Err(bad(id, "a pin needs the page it marks"));
    }
    if kind == "bookmark"
        && !fields
            .get("url")
            .and_then(Value::as_str)
            .is_some_and(|u| (u.starts_with("http://") || u.starts_with("https://")) && u.len() <= 4096)
    {
        return Err(bad(id, "a bookmark needs an http(s) url"));
    }
    if kind == "wall" || (kind == "area" && matches!(fields.get("shape").and_then(Value::as_str), Some("poly" | "path"))) {
        let ok = matches!(fields.get("pts"), Some(Value::Array(p)) if p.len() >= 2 && p.len() <= 4000
            && p.iter().all(|pt| matches!(pt, Value::Array(xy) if xy.len() == 2 && xy.iter().all(|n| n.as_f64().is_some_and(f64::is_finite)))));
        if !ok {
            return Err(bad(id, "pts are 2 to 4000 [x, y] pairs"));
        }
    }
    if kind == "prop" && !fields.get("asset").and_then(Value::as_str).is_some_and(|a| a.starts_with("b:") || a.starts_with("u:")) {
        return Err(bad(id, "a prop's asset is b:<built-in> or u:<upload>"));
    }
    if kind == "token" && fields.get("hidden").is_some_and(|h| !h.is_boolean()) {
        return Err(bad(id, "a token's hidden is true or false"));
    }
    if kind == "reveal" {
        if let Some(points) = fields.get("points") {
            let ok = matches!(points, Value::Array(p) if p.len() >= 3 && p.len() <= 4000
                && p.iter().all(|pt| matches!(pt, Value::Array(xy) if xy.len() == 2 && xy.iter().all(|n| n.as_f64().is_some_and(f64::is_finite)))));
            if !ok {
                return Err(bad(
                    id,
                    "a revealed area's points are 3 to 4000 [x, y] pairs",
                ));
            }
        }
    }
    if fields.get(keys::EL_TEXT).is_some_and(|t| !t.is_string()) {
        return Err(bad(id, "text must be a string"));
    }
    if !fields.get(keys::EL_INDEX).is_some_and(Value::is_string) {
        fields.insert(keys::EL_INDEX.into(), Value::String("a0".into()));
    }
    fields.insert(keys::ID.into(), Value::String(id.to_string()));
    Ok(fields)
}

/// The surface's elements in stacking order. Entries that aren't elements are skipped.
pub(crate) fn read_elements<T: ReadTxn>(txn: &T, surface: &MapRef) -> Vec<Element> {
    let mut out: Vec<Element> = surface
        .iter(txn)
        .filter_map(|(id, v)| {
            let Out::YMap(m) = v else { return None };
            let mut attrs = BTreeMap::new();
            let mut text = String::new();
            for (k, v) in m.iter(txn) {
                let Out::Any(a) = v else { continue };
                match (k, &a) {
                    (keys::ID, _) => {}
                    (keys::EL_TEXT, Any::String(s)) => text = s.to_string(),
                    // The picture stays in the doc; the index only notes that there is one.
                    ("src", _) => {
                        attrs.insert("hasSrc".to_string(), Value::Bool(true));
                    }
                    _ => {
                        attrs.insert(k.to_string(), to_json(&a));
                    }
                }
            }
            let kind = attrs.get(keys::EL_TYPE)?.as_str()?.to_string();
            if !TYPES.contains(&kind.as_str()) {
                return None;
            }
            let index = attrs
                .get(keys::EL_INDEX)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            Some(Element {
                id: id.to_string(),
                kind,
                index,
                text,
                attrs,
            })
        })
        .collect();
    out.sort_by(|a, b| (&a.index, &a.id).cmp(&(&b.index, &b.id)));
    out
}
