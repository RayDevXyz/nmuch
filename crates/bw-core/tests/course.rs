//! The Course module: a folder becomes a course, stays in sync with it, and tracks what you watch.

use std::path::{Path, PathBuf};

use bw_core::course::{clean_name, natural_cmp, today, video_minutes, MODULE_ID};
use bw_core::{Core, Error};
use serde_json::json;

fn temp_dir(name: &str) -> PathBuf {
    let stamp = format!("{:?}", std::time::SystemTime::now())
        .replace(|c: char| !c.is_ascii_alphanumeric(), "");
    let d = std::env::temp_dir().join(format!("bw-course-{name}-{stamp}"));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// A minimal MP4: `ftyp`, then `moov` holding an `mvhd` (version 0) with the given length.
fn mp4(seconds: u32) -> Vec<u8> {
    let mut mvhd = vec![0u8; 100];
    mvhd[12..16].copy_from_slice(&1000u32.to_be_bytes()); // timescale
    mvhd[16..20].copy_from_slice(&(seconds * 1000).to_be_bytes()); // duration
    let boxed = |kind: &[u8; 4], body: &[u8]| {
        let mut b = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        b.extend_from_slice(kind);
        b.extend_from_slice(body);
        b
    };
    let mut out = boxed(b"ftyp", b"isom\0\0\0\0");
    out.extend(boxed(b"free", &[0; 16]));
    out.extend(boxed(b"moov", &boxed(b"mvhd", &mvhd)));
    out
}

fn write(dir: &Path, rel: &str, data: &[u8]) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, data).unwrap();
}

struct Lesson {
    title: String,
    order: f64,
    section: String,
    minutes: Option<f64>,
    missing: bool,
}

fn lessons(core: &mut Core, lessons_db: &str) -> Vec<Lesson> {
    let mut rows: Vec<Lesson> = core
        .query_database(lessons_db, None, None)
        .unwrap()
        .rows
        .into_iter()
        .map(|r| Lesson {
            title: r.title,
            order: r
                .values
                .get("order")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            section: r
                .values
                .get("section")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            minutes: r.values.get("minutes").and_then(|v| v.as_f64()),
            missing: r.values.get("missing") == Some(&json!(true)),
        })
        .collect();
    rows.sort_by(|a, b| a.order.partial_cmp(&b.order).unwrap());
    rows
}

#[test]
fn a_folder_becomes_a_course_in_natural_order() {
    let mut core = Core::open_in_memory().unwrap();
    let dir = temp_dir("rust");
    write(&dir, "01 - Intro.mp4", &mp4(125));
    write(&dir, "2 - Setup.mkv", b"not really a video");
    write(&dir, "10 - Wrap_up.pdf", b"%PDF");
    write(&dir, "Part 2/1_Deep_dive.md", b"# notes");
    write(&dir, "cover.jpg", b"image");
    write(&dir, ".DS_Store.mp4", b"hidden");

    let t = core.course_setup(None).unwrap();
    // Without the folder being given to the module, nothing is read.
    assert!(matches!(
        core.course_import(&t.courses, dir.to_str().unwrap()),
        Err(Error::Forbidden(_))
    ));
    core.grant_folder(MODULE_ID, dir.to_str().unwrap()).unwrap();
    let report = core
        .course_import(&t.courses, dir.to_str().unwrap())
        .unwrap();
    assert_eq!(report.added, 4);

    let ls = lessons(&mut core, &t.lessons);
    let titles: Vec<_> = ls.iter().map(|l| l.title.as_str()).collect();
    assert_eq!(titles, ["Intro", "Setup", "Wrap up", "Deep dive"]);
    assert_eq!(ls[0].minutes, Some(3.0), "125 s rounds up to 3 min");
    assert_eq!(ls[1].minutes, None);
    assert_eq!(ls[3].section, "Part 2");

    let course = core
        .query_database(&t.courses, None, None)
        .unwrap()
        .rows
        .remove(0);
    let folder_name = dir.file_name().unwrap().to_string_lossy().to_string();
    assert_eq!(course.title, clean_name(&folder_name));
    assert_eq!(course.values["status"], json!("todo"));
    assert_eq!(course.values["progress"], json!(0));

    // Importing the same folder again doesn't duplicate anything.
    let again = core
        .course_import(&t.courses, dir.to_str().unwrap())
        .unwrap();
    assert_eq!(again.added, 0);
    assert_eq!(
        core.query_database(&t.courses, None, None)
            .unwrap()
            .rows
            .len(),
        1
    );
    assert_eq!(lessons(&mut core, &t.lessons).len(), 4);
}

#[test]
fn sync_adds_new_files_and_flags_missing_ones_without_losing_progress() {
    let mut core = Core::open_in_memory().unwrap();
    let dir = temp_dir("sync");
    write(&dir, "1 - A.mp4", &mp4(60));
    write(&dir, "2 - B.mp4", &mp4(60));
    write(&dir, "3 - C.mp4", &mp4(60));
    let t = core.course_setup(None).unwrap();
    core.grant_folder(MODULE_ID, dir.to_str().unwrap()).unwrap();
    let course = core
        .course_import(&t.courses, dir.to_str().unwrap())
        .unwrap()
        .course;

    // Tick B done, then the folder changes under us.
    let b = core
        .query_database(&t.lessons, None, None)
        .unwrap()
        .rows
        .into_iter()
        .find(|r| r.title == "B")
        .unwrap()
        .id;
    core.set_value(&b, "done", json!(true)).unwrap();
    write(&dir, "2b - Extra.mp4", &mp4(30));
    std::fs::remove_file(dir.join("2 - B.mp4")).unwrap();

    let r = core.course_sync(&course).unwrap();
    assert_eq!((r.added, r.missing, r.restored), (1, 1, 0));
    let ls = lessons(&mut core, &t.lessons);
    let view: Vec<_> = ls
        .iter()
        .filter(|l| !l.missing)
        .map(|l| (l.title.as_str(), l.order))
        .collect();
    assert_eq!(view, [("A", 1.0), ("Extra", 2.0), ("C", 3.0)]);
    assert!(
        ls.iter().any(|l| l.title == "B" && l.missing),
        "kept, flagged"
    );

    // B comes back: unflagged, still done.
    write(&dir, "2 - B.mp4", &mp4(60));
    let r = core.course_sync(&course).unwrap();
    assert_eq!((r.added, r.missing, r.restored), (0, 0, 1));
    let row = core
        .query_database(&t.lessons, None, None)
        .unwrap()
        .rows
        .into_iter()
        .find(|r| r.id == b)
        .unwrap();
    assert_eq!(row.values["done"], json!(true));
    assert!(row.values.get("missing").is_none_or(|v| v == &json!(false)));

    // The host's watcher entry point finds the course by folder.
    write(&dir, "4 - D.pdf", b"%PDF");
    let reports = core
        .course_sync_under(&std::fs::canonicalize(&dir).unwrap())
        .unwrap();
    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0].added, 1);

    // A folder that disappears entirely doesn't flag every lesson.
    std::fs::remove_dir_all(&dir).unwrap();
    let r = core.course_sync(&course).unwrap();
    assert_eq!(r.missing, 0);
}

#[test]
fn opening_a_lesson_marks_it_watched_and_starts_the_course() {
    let mut core = Core::open_in_memory().unwrap();
    let dir = temp_dir("open");
    write(&dir, "1 - Hello.mp4", &mp4(60));
    let t = core.course_setup(None).unwrap();
    core.grant_folder(MODULE_ID, dir.to_str().unwrap()).unwrap();
    let course = core
        .course_import(&t.courses, dir.to_str().unwrap())
        .unwrap()
        .course;
    let lesson = core
        .query_database(&t.lessons, None, None)
        .unwrap()
        .rows
        .remove(0)
        .id;

    let path = core.course_open_lesson(&lesson).unwrap();
    assert!(path.ends_with("1 - Hello.mp4"));
    let row = core
        .query_database(&t.lessons, None, None)
        .unwrap()
        .rows
        .remove(0);
    assert_eq!(row.values["watched"], json!(today()));
    let c = core
        .query_database(&t.courses, None, None)
        .unwrap()
        .rows
        .into_iter()
        .find(|r| r.id == course)
        .unwrap();
    assert_eq!(c.values["status"], json!("doing"));

    // A lesson pointed (by hand) at a file outside the course's folder can't be opened.
    let outside = temp_dir("outside");
    write(&outside, "secret.pdf", b"%PDF");
    core.set_value(
        &lesson,
        "file",
        json!(outside.join("secret.pdf").to_string_lossy()),
    )
    .unwrap();
    assert!(matches!(
        core.course_open_lesson(&lesson),
        Err(Error::Forbidden(_))
    ));
}

#[test]
fn names_and_order() {
    assert_eq!(clean_name("01 - Getting_started"), "Getting started");
    assert_eq!(clean_name("3. Basics"), "Basics");
    assert_eq!(clean_name("2024"), "2024");
    assert_eq!(clean_name("Intro"), "Intro");
    assert_eq!(clean_name("2b - Extra"), "Extra");
    assert_eq!(clean_name("3D printing"), "3D printing");
    let mut v = vec![
        "10 - a",
        "2 - b",
        "1 - c",
        "Part 2/1",
        "Part 10/1",
        "part 3/1",
    ];
    v.sort_by(|a, b| natural_cmp(a, b));
    assert_eq!(
        v,
        [
            "1 - c",
            "2 - b",
            "10 - a",
            "Part 2/1",
            "part 3/1",
            "Part 10/1"
        ]
    );
    let dir = temp_dir("mp4");
    write(&dir, "x.mp4", &mp4(3600));
    assert_eq!(video_minutes(&dir.join("x.mp4")), Some(60));
    write(&dir, "y.mp4", b"garbage");
    assert_eq!(video_minutes(&dir.join("y.mp4")), None);
    assert_eq!(today().len(), 10);
}
