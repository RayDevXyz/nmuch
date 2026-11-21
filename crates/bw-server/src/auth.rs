//! Who may use a hosted BrainWaves: one owner (the first account made), their browser sessions,
//! and API tokens for other apps (Burrow, scripts).
//!
//! Kept in `auth.json` in the data folder. Passwords are hashed with Argon2id; sessions and
//! tokens are random and stored only as SHA-256 hashes, so the file can't be used to log in.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const SESSION_DAYS: u64 = 30;
const MAX_SESSIONS: usize = 50;
const MAX_TOKENS: usize = 50;

#[derive(Default, Serialize, Deserialize)]
pub struct Owner {
    pub name: String,
    hash: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Token {
    pub id: String,
    pub name: String,
    hash: String,
    pub created: u64,
    pub last_used: Option<u64>,
}

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    owner: Option<Owner>,
    /// Session hash → expiry (ms).
    sessions: HashMap<String, u64>,
    tokens: Vec<Token>,
}

pub struct Auth {
    path: PathBuf,
    saved: Saved,
    /// Failed logins in the current window, by client: (window start, count).
    failures: HashMap<String, (u64, u32)>,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn random_hex(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn sha(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|x| format!("{x:02x}")).collect()
}

impl Auth {
    pub fn load(path: PathBuf) -> Self {
        let saved = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Self { path, saved, failures: HashMap::new() }
    }

    fn save(&self) -> Result<(), String> {
        let tmp = self.path.with_extension("json.tmp");
        let bytes = serde_json::to_vec_pretty(&self.saved).map_err(|e| e.to_string())?;
        std::fs::write(&tmp, bytes).and_then(|_| std::fs::rename(&tmp, &self.path)).map_err(|e| format!("could not save the login: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    pub fn has_owner(&self) -> bool {
        self.saved.owner.is_some()
    }
    pub fn owner_name(&self) -> Option<String> {
        self.saved.owner.as_ref().map(|o| o.name.clone())
    }

    fn hash_password(password: &str) -> Result<String, String> {
        let salt = SaltString::generate(&mut rand::thread_rng());
        Argon2::default().hash_password(password.as_bytes(), &salt).map(|h| h.to_string()).map_err(|e| e.to_string())
    }

    fn check_password_rules(password: &str) -> Result<(), String> {
        if password.chars().count() < 10 {
            return Err("Use a password of at least 10 characters.".into());
        }
        if password.len() > 512 {
            return Err("That password is too long.".into());
        }
        Ok(())
    }

    /// Make the owner (only while there is none). Returns a new session.
    pub fn setup(&mut self, name: &str, password: &str) -> Result<String, String> {
        if self.has_owner() {
            return Err("This BrainWaves already has its owner.".into());
        }
        let name = name.trim();
        if name.is_empty() || name.len() > 60 {
            return Err("Choose a name (up to 60 characters).".into());
        }
        Self::check_password_rules(password)?;
        self.saved.owner = Some(Owner { name: name.to_string(), hash: Self::hash_password(password)? });
        let s = self.new_session();
        self.save()?;
        Ok(s)
    }

    /// Too many wrong passwords from one client: wait before trying again.
    pub fn locked_out(&self, client: &str) -> Option<u64> {
        let (start, n) = *self.failures.get(client)?;
        let window = 15 * 60 * 1000;
        if n >= 5 && now_ms() < start + window {
            Some((start + window - now_ms()) / 1000 + 1)
        } else {
            None
        }
    }

    pub fn login(&mut self, client: &str, name: &str, password: &str) -> Result<String, String> {
        if let Some(wait) = self.locked_out(client) {
            return Err(format!("Too many attempts. Try again in {} minutes.", wait.div_ceil(60)));
        }
        let ok = match &self.saved.owner {
            Some(o) => o.name.eq_ignore_ascii_case(name.trim()) && PasswordHash::new(&o.hash).is_ok_and(|h| Argon2::default().verify_password(password.as_bytes(), &h).is_ok()),
            None => false,
        };
        if !ok {
            let e = self.failures.entry(client.to_string()).or_insert((now_ms(), 0));
            if now_ms() > e.0 + 15 * 60 * 1000 {
                *e = (now_ms(), 0);
            }
            e.1 += 1;
            return Err("That name and password don't match.".into());
        }
        self.failures.remove(client);
        let s = self.new_session();
        self.save()?;
        Ok(s)
    }

    pub fn change_password(&mut self, current: &str, new: &str) -> Result<(), String> {
        let o = self.saved.owner.as_ref().ok_or("No owner yet.")?;
        let ok = PasswordHash::new(&o.hash).is_ok_and(|h| Argon2::default().verify_password(current.as_bytes(), &h).is_ok());
        if !ok {
            return Err("The current password isn't right.".into());
        }
        Self::check_password_rules(new)?;
        let hash = Self::hash_password(new)?;
        if let Some(o) = self.saved.owner.as_mut() {
            o.hash = hash;
        }
        // Everyone else is signed out.
        self.saved.sessions.clear();
        self.save()
    }

    fn new_session(&mut self) -> String {
        let token = random_hex(32);
        let expires = now_ms() + Duration::from_secs(SESSION_DAYS * 86400).as_millis() as u64;
        self.saved.sessions.retain(|_, exp| *exp > now_ms());
        if self.saved.sessions.len() >= MAX_SESSIONS {
            if let Some(oldest) = self.saved.sessions.iter().min_by_key(|(_, e)| **e).map(|(k, _)| k.clone()) {
                self.saved.sessions.remove(&oldest);
            }
        }
        self.saved.sessions.insert(sha(&token), expires);
        token
    }

    pub fn session_ok(&self, token: &str) -> bool {
        !token.is_empty() && self.saved.sessions.get(&sha(token)).is_some_and(|exp| *exp > now_ms())
    }

    pub fn logout(&mut self, token: &str) {
        if self.saved.sessions.remove(&sha(token)).is_some() {
            let _ = self.save();
        }
    }

    /// A Bearer token from another app. Marks it used (saved at most once a minute).
    pub fn token_ok(&mut self, token: &str) -> bool {
        let h = sha(token);
        let Some(t) = self.saved.tokens.iter_mut().find(|t| t.hash == h) else { return false };
        let now = now_ms();
        let stale = t.last_used.is_none_or(|u| now > u + 60_000);
        t.last_used = Some(now);
        if stale {
            let _ = self.save();
        }
        true
    }

    pub fn tokens(&self) -> Vec<Token> {
        self.saved.tokens.clone()
    }

    /// A new API token; the secret is returned this once.
    pub fn create_token(&mut self, name: &str) -> Result<(Token, String), String> {
        let name = name.trim();
        if name.is_empty() || name.len() > 60 {
            return Err("Name the token (up to 60 characters), e.g. Burrow.".into());
        }
        if self.saved.tokens.len() >= MAX_TOKENS {
            return Err("Too many tokens: delete some first.".into());
        }
        let secret = format!("bw_{}", random_hex(24));
        let t = Token { id: random_hex(8), name: name.to_string(), hash: sha(&secret), created: now_ms(), last_used: None };
        self.saved.tokens.push(t.clone());
        self.save()?;
        Ok((t, secret))
    }

    pub fn delete_token(&mut self, id: &str) -> Result<(), String> {
        self.saved.tokens.retain(|t| t.id != id);
        self.save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("bw-auth-{}", random_hex(6)));
        std::fs::create_dir_all(&d).unwrap();
        d.join("auth.json")
    }

    #[test]
    fn owner_sessions_tokens() {
        let p = temp();
        let mut a = Auth::load(p.clone());
        assert!(!a.has_owner());
        assert!(a.setup("Ray", "short").is_err());
        let s = a.setup("Ray", "correct horse battery").unwrap();
        assert!(a.session_ok(&s));
        assert!(a.setup("Eve", "another long password").is_err(), "only one owner");
        assert!(a.login("ip", "ray", "wrong password!").is_err());
        let s2 = a.login("ip", "RAY", "correct horse battery").unwrap();
        // Saved and reloaded: sessions survive, and the file holds no secrets.
        let (t, secret) = a.create_token("Burrow").unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(!raw.contains(&s2) && !raw.contains(&secret) && !raw.contains("correct horse"));
        let mut b = Auth::load(p.clone());
        assert!(b.session_ok(&s2));
        assert!(b.token_ok(&secret));
        assert!(!b.token_ok("bw_nope"));
        b.delete_token(&t.id).unwrap();
        assert!(!b.token_ok(&secret));
        b.logout(&s2);
        assert!(!b.session_ok(&s2));
        // Changing the password signs every session out.
        b.change_password("correct horse battery", "a brand new passphrase").unwrap();
        assert!(!b.session_ok(&s));
    }

    #[test]
    fn too_many_wrong_passwords_wait() {
        let mut a = Auth::load(temp());
        a.setup("Ray", "correct horse battery").unwrap();
        for _ in 0..5 {
            assert!(a.login("1.2.3.4", "Ray", "nope nope nope").is_err());
        }
        let e = a.login("1.2.3.4", "Ray", "correct horse battery").unwrap_err();
        assert!(e.contains("Too many"), "{e}");
        assert!(a.login("5.6.7.8", "Ray", "correct horse battery").is_ok(), "other clients aren't locked out");
    }
}
