//! The D&D module: campaigns with their databases, story beats, characters, and map pins.

use bw_core::dnd::{beat_template, MODULE_ID};
use bw_core::{Core, Error, PageMeta};
use serde_json::json;

#[test]
fn a_campaign_gets_linked_databases_and_a_map() {
    let mut core = Core::open_in_memory().unwrap();
    let c = core.dnd_create_campaign("Curse of the Pale King").unwrap();
    let parts = c.parts.clone().unwrap();

    // The campaign's databases live under its page and are owned by the module.
    for (db, title) in [
        (&parts.npcs, "NPCs"),
        (&parts.locations, "Locations"),
        (&parts.factions, "Factions"),
        (&parts.sessions, "Sessions"),
        (&parts.beats, "Story beats"),
    ] {
        let meta = core.snapshot(db).unwrap().meta;
        assert_eq!(meta.title, title);
        assert_eq!(meta.parent_id.as_deref(), Some(c.id.as_str()));
        assert!(core.module_query(MODULE_ID, db, None).is_ok());
    }
    assert_eq!(core.snapshot(&parts.map).unwrap().meta.title, "World map");

    // Asking again doesn't make a second set; the campaign is listed.
    let again = core.dnd_campaign(&c.id).unwrap();
    assert_eq!(again.parts.unwrap(), parts);
    let all = core.dnd_campaigns().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].title, "Curse of the Pale King");

    // Beats link to sessions, NPCs and locations; the other side lists the beats.
    let npc = "npc-1";
    core.create_row(&parts.npcs, npc, "Strahd", &Default::default())
        .unwrap();
    let beat = core.dnd_add_beats(&c.id, "five-room", "The crypt").unwrap()[0].clone();
    core.set_value(&beat, &parts.beat_npcs, json!([npc]))
        .unwrap();
    let npcs = core.query_database(&parts.npcs, None, None).unwrap();
    let back = npcs
        .properties
        .iter()
        .find(|p| p.name == "Story beats")
        .unwrap();
    assert_eq!(npcs.rows[0].values[&back.id], json!([beat]));
}

#[test]
fn story_templates_add_an_arc_of_planned_beats() {
    let mut core = Core::open_in_memory().unwrap();
    let c = core.dnd_create_campaign("Heists of Waterdeep").unwrap();
    let ids = core.dnd_add_beats(&c.id, "heist", "").unwrap();
    assert_eq!(ids.len(), beat_template("heist").unwrap().1.len());
    let rows = core
        .query_database(&c.parts.unwrap().beats, None, None)
        .unwrap()
        .rows;
    assert!(rows
        .iter()
        .all(|r| r.values["status"] == json!("planned") && r.values["arc"] == json!("Heist")));
    let first = rows.iter().find(|r| r.values["order"] == json!(1)).unwrap();
    assert_eq!(first.title, "The job");
    assert!(matches!(
        core.dnd_add_beats(&c.id, "nope", ""),
        Err(Error::Invalid(_))
    ));
}

#[test]
fn characters_keep_a_sheet_and_join_a_party() {
    let mut core = Core::open_in_memory().unwrap();
    let c = core.dnd_create_campaign("Lost Mine").unwrap();
    let sheet = json!({
        "player": "Ray", "race": "Elf", "class": "Wizard", "classLabel": "Wizard 3", "level": 3,
        "abilities": { "str": 8, "dex": 14, "con": 13, "int": 16, "wis": 12, "cha": 10 },
        "hp": { "current": 14, "max": 17, "temp": 0 }, "ac": 12
    });
    let id = core
        .dnd_create_character("Maho", sheet.clone(), Some(&c.id))
        .unwrap();
    assert_eq!(core.dnd_sheet(&id).unwrap(), sheet);

    let w = core.dnd_workspace().unwrap();
    let row = core
        .query_database(&w.characters, None, None)
        .unwrap()
        .rows
        .remove(0);
    assert_eq!(row.title, "Maho");
    assert_eq!(
        (
            row.values["class"].clone(),
            row.values["level"].clone(),
            row.values["hp"].clone(),
            row.values["ac"].clone()
        ),
        (json!("Wizard 3"), json!(3), json!(14), json!(12))
    );
    let campaign = core
        .query_database(&w.campaigns, None, None)
        .unwrap()
        .rows
        .remove(0);
    assert_eq!(campaign.values[&w.campaign_party], json!([id]));

    // Taking damage updates the column too; only character pages take sheets.
    let mut hurt = sheet.clone();
    hurt["hp"]["current"] = json!(4);
    core.dnd_set_sheet(&id, hurt).unwrap();
    let row = core
        .query_database(&w.characters, None, None)
        .unwrap()
        .rows
        .remove(0);
    assert_eq!(row.values["hp"], json!(4));
    let page = core
        .create_page(PageMeta {
            title: "Notes".into(),
            ..Default::default()
        })
        .unwrap();
    assert!(core.dnd_set_sheet(&page, json!({})).is_err());
    assert!(core.dnd_set_sheet(&id, json!("not an object")).is_err());

    // Campaign and character pages get the campaign look.
    let themed = core.dnd_themed_roots().unwrap();
    assert!(themed.contains(&id) && themed.contains(&c.id) && themed.contains(&w.characters));
    assert!(!themed.contains(&page));

    let roles = core.dnd_roles().unwrap();
    assert_eq!(
        roles.get(&w.characters).map(String::as_str),
        Some("characters")
    );
    assert_eq!(roles.get(&c.id).map(String::as_str), Some("campaign"));
    assert_eq!(
        roles
            .get(&c.parts.as_ref().unwrap().beats)
            .map(String::as_str),
        Some("beats")
    );

    // One Campaigns and one Characters database per workspace.
    core.dnd_create_campaign("Second").unwrap();
    assert_eq!(core.dnd_workspace().unwrap(), w);
}

#[test]
fn the_5etools_address_is_checked() {
    let mut core = Core::open_in_memory().unwrap();
    assert_eq!(core.dnd_source().unwrap(), None);
    assert_eq!(
        core.dnd_set_source(" http://localhost:5050 ").unwrap(),
        "http://localhost:5050/"
    );
    assert_eq!(
        core.dnd_source().unwrap().as_deref(),
        Some("http://localhost:5050/")
    );
    assert!(core.dnd_set_source("file:///etc/passwd").is_err());
    assert!(core.dnd_set_source("javascript:alert(1)").is_err());
    core.dnd_set_source("https://5e.example.org/").unwrap();
    assert_eq!(
        core.dnd_source().unwrap().as_deref(),
        Some("https://5e.example.org/")
    );
}

#[test]
fn map_pins_link_pages_and_images_stay_out_of_the_index() {
    let mut core = Core::open_in_memory().unwrap();
    let c = core.dnd_create_campaign("Maps").unwrap();
    let parts = c.parts.unwrap();
    let town = "loc-town";
    core.create_row(&parts.locations, town, "Phandalin", &Default::default())
        .unwrap();
    let picture = format!("data:image/png;base64,{}", "A".repeat(4000));
    core.transact(&parts.map, |t| {
        t.set_element("img", json!({ "type": "image", "index": "a0", "xywh": [0, 0, 2000, 1400], "src": picture }))?;
        t.set_element("pin", json!({ "type": "pin", "index": "a1", "xywh": [640, 420, 32, 32], "page": town, "text": "Phandalin" }))
    })
    .unwrap();

    let back = core.backlinks(town).unwrap();
    assert_eq!(back.len(), 1);
    assert_eq!(
        (back[0].page_id.as_str(), back[0].block_id.as_str()),
        (parts.map.as_str(), "pin")
    );
    let dump = core.index_dump().unwrap();
    assert!(
        !format!("{dump:?}").contains("AAAA"),
        "the picture is not copied into the index"
    );
    assert_eq!(
        core.search("phandalin", 10)
            .unwrap()
            .iter()
            .filter(|h| h.block_id.as_deref() == Some("pin"))
            .count(),
        1
    );

    let bad = core.transact(&parts.map, |t| {
        t.set_element(
            "x",
            json!({ "type": "image", "xywh": [0, 0, 1, 1], "src": "http://evil.example/x.png" }),
        )
    });
    assert!(matches!(bad, Err(Error::Invalid(_))));
    let bad = core.transact(&parts.map, |t| {
        t.set_element("y", json!({ "type": "pin", "xywh": [0, 0, 1, 1] }))
    });
    assert!(matches!(bad, Err(Error::Invalid(_))));
}
