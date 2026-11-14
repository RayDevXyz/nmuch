//! Dice, rolled on the server so every roll at the table is fair: `d20`, `2d6+3`,
//! `1d8 + 1d6 + 4`, `4d6kh3` (keep the highest 3), `d20 adv` / `d20 dis`.

use rand::Rng;

#[derive(Debug, Clone, PartialEq)]
pub struct Rolled {
    /// The expression as understood, e.g. "2d6+3".
    pub expr: String,
    /// Each term's dice, e.g. "2d6 [4, 1] + 3".
    pub detail: String,
    pub total: i64,
}

pub fn roll(input: &str, rng: &mut impl Rng) -> Result<Rolled, String> {
    let raw = input.trim().to_lowercase();
    if raw.is_empty() || raw.len() > 80 {
        return Err("a roll looks like d20, 2d6+3 or d20 adv".into());
    }
    let (body, mode) = if let Some(b) = raw.strip_suffix(" adv").or_else(|| raw.strip_suffix("adv")) {
        (b.trim().to_string(), 1)
    } else if let Some(b) = raw.strip_suffix(" dis").or_else(|| raw.strip_suffix("dis")) {
        (b.trim().to_string(), -1)
    } else {
        (raw.clone(), 0)
    };
    let compact: String = body.chars().filter(|c| !c.is_whitespace()).collect();
    let mut total = 0i64;
    let mut details = vec![];
    let mut dice_count = 0;
    let mut first = true;
    for (sign, term) in split_terms(&compact)? {
        let (value, detail) = if let Some((n, rest)) = term.split_once('d') {
            let n: u32 = if n.is_empty() { 1 } else { n.parse().map_err(|_| format!("{term}?"))? };
            let (faces, keep) = match rest.split_once("kh") {
                Some((f, k)) => (f.parse::<u32>().map_err(|_| format!("{term}?"))?, Some(k.parse::<u32>().map_err(|_| format!("{term}?"))?)),
                None => (rest.parse::<u32>().map_err(|_| format!("{term}?"))?, None),
            };
            if n == 0 || n > 100 || !(2..=1000).contains(&faces) {
                return Err(format!("{term}: 1–100 dice of 2–1000 sides"));
            }
            dice_count += n;
            if dice_count > 200 {
                return Err("that's a lot of dice: at most 200 per roll".into());
            }
            // Advantage/disadvantage applies to the first single d20.
            let adv = first && mode != 0 && n == 1 && faces == 20 && keep.is_none();
            let count = if adv { 2 } else { n };
            let mut rolls: Vec<i64> = (0..count).map(|_| rng.gen_range(1..=faces as i64)).collect();
            let kept: i64 = if adv {
                if mode > 0 { *rolls.iter().max().unwrap() } else { *rolls.iter().min().unwrap() }
            } else if let Some(k) = keep {
                let mut sorted = rolls.clone();
                sorted.sort_unstable_by(|a, b| b.cmp(a));
                sorted.iter().take(k as usize).sum()
            } else {
                rolls.iter().sum()
            };
            if adv {
                rolls.sort_unstable_by(|a, b| b.cmp(a));
            }
            let label = if adv { format!("d20 {}", if mode > 0 { "adv" } else { "dis" }) } else { term.clone() };
            (kept, format!("{label} {rolls:?}"))
        } else {
            let k: i64 = term.parse().map_err(|_| format!("{term}?"))?;
            if k.abs() > 10_000 {
                return Err(format!("{term}: too big"));
            }
            (k, k.to_string())
        };
        total += sign * value;
        details.push(format!("{}{}", if first { if sign < 0 { "-" } else { "" } } else if sign < 0 { " - " } else { " + " }, detail));
        first = false;
    }
    let expr = format!("{compact}{}", match mode { 1 => " adv", -1 => " dis", _ => "" });
    Ok(Rolled { expr, detail: details.concat(), total })
}

fn split_terms(s: &str) -> Result<Vec<(i64, String)>, String> {
    let mut out = vec![];
    let mut sign = 1;
    let mut cur = String::new();
    for c in s.chars() {
        match c {
            '+' | '-' => {
                if !cur.is_empty() {
                    out.push((sign, std::mem::take(&mut cur)));
                } else if !out.is_empty() {
                    return Err("two signs in a row".into());
                }
                sign = if c == '-' { -1 } else { 1 };
            }
            c if c.is_ascii_alphanumeric() => cur.push(c),
            _ => return Err(format!("unexpected {c:?}")),
        }
    }
    if cur.is_empty() {
        return Err("a roll looks like d20, 2d6+3 or d20 adv".into());
    }
    out.push((sign, cur));
    if out.len() > 12 {
        return Err("at most 12 terms".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::roll;
    use rand::rngs::mock::StepRng;
    use rand::SeedableRng;

    #[test]
    fn expressions() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(7);
        for _ in 0..200 {
            let r = roll("2d6+3", &mut rng).unwrap();
            assert!((5..=15).contains(&r.total), "{r:?}");
            let r = roll("d20 adv", &mut rng).unwrap();
            assert!((1..=20).contains(&r.total));
            assert_eq!(r.expr, "d20 adv");
            let r = roll("4d6kh3", &mut rng).unwrap();
            assert!((3..=18).contains(&r.total));
            let r = roll("1d8 + 1d6 - 2", &mut rng).unwrap();
            assert!((0..=12).contains(&r.total));
        }
        assert!(roll("", &mut rng).is_err());
        assert!(roll("1000d6", &mut rng).is_err());
        assert!(roll("d1", &mut rng).is_err());
        assert!(roll("2d6++3", &mut rng).is_err());
        assert!(roll("rm -rf", &mut rng).is_err());
        let _ = StepRng::new(0, 1);
    }

    #[test]
    fn advantage_keeps_the_higher_and_disadvantage_the_lower() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        for _ in 0..100 {
            let a = roll("d20 adv", &mut rng).unwrap();
            let nums: Vec<i64> = a.detail.trim_start_matches("d20 adv ").trim_matches(['[', ']']).split(", ").map(|n| n.parse().unwrap()).collect();
            assert_eq!(a.total, *nums.iter().max().unwrap());
            let d = roll("d20dis", &mut rng).unwrap();
            let nums: Vec<i64> = d.detail.trim_start_matches("d20 dis ").trim_matches(['[', ']']).split(", ").map(|n| n.parse().unwrap()).collect();
            assert_eq!(d.total, *nums.iter().min().unwrap());
        }
    }
}
