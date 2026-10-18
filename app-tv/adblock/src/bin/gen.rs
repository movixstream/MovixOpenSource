//! Outil de génération (machine de build uniquement, feature `gen`).
//!
//! Usage : `gen <dossier-cache> <dossier-assets>`
//!
//! - `<dossier-cache>/lists/manifest.tsv` : une ligne par liste,
//!   `fichier<TAB>confiance(0|1)<TAB>titre`, écrite par `build.sh` après le
//!   téléchargement ; les fichiers inclus (`!#include`) sont à côté.
//! - `<dossier-cache>/resources.json` : ressources uBO (redirections et
//!   scriptlets) assemblées par `gen/ubo-resources.mjs`.
//!
//! Produit `<dossier-assets>/engine.dat` (moteur sérialisé) et
//! `<dossier-assets>/resources.json` (ressources vérifiées, JSON compact).

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use adblock::lists::{FilterSet, ParseOptions};
use adblock::resources::{PermissionMask, Resource};
use adblock::Engine;
use movix_adblock::MovixEngine;

/// Environnement vu par les directives `!#if` de uBO : on se présente comme
/// uBlock Origin sur Chromium mobile (la WebView Android), sans filtrage HTML
/// (`##^`), que ni adblock-rust ni la WebView ne savent appliquer.
const ENV_TRUE: &[&str] = &["ext_ublock", "env_chromium", "env_mobile"];

/// Permission des listes de confiance (uBO, Movix) : autorise les scriptlets
/// `trusted-*` marqués `requiresTrust` dans uBO.
const TRUSTED: PermissionMask = PermissionMask::from_bits(1);

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage : gen <dossier-cache> <dossier-assets>");
        std::process::exit(2);
    }
    let cache = PathBuf::from(&args[1]);
    let out = PathBuf::from(&args[2]);
    fs::create_dir_all(&out).expect("création du dossier des assets");

    // 1. Listes de filtres.
    let lists_dir = cache.join("lists");
    let manifest =
        fs::read_to_string(lists_dir.join("manifest.tsv")).expect("lecture de lists/manifest.tsv");
    let mut filter_set = FilterSet::new(false);
    let mut total_lines = 0usize;
    for line in manifest.lines().filter(|l| !l.trim().is_empty()) {
        let mut cols = line.split('\t');
        let file = cols.next().expect("colonne fichier");
        let trusted = cols.next() == Some("1");
        let title = cols.next().unwrap_or(file);
        let mut seen = HashSet::new();
        let text = preprocess(&lists_dir, file, &mut seen);
        let count = text.lines().count();
        total_lines += count;
        println!("  {title} : {count} lignes{}", if trusted { " (confiance)" } else { "" });
        let opts = ParseOptions {
            permissions: if trusted { TRUSTED } else { PermissionMask::default() },
            ..ParseOptions::default()
        };
        filter_set.add_filter_list(text, opts);
    }
    println!("  total : {total_lines} lignes");

    let engine = Engine::new_with_filter_set(filter_set);
    let dat = engine.serialize();
    fs::write(out.join("engine.dat"), &dat).expect("écriture de engine.dat");
    println!("engine.dat : {} octets", dat.len());

    // 2. Ressources uBO : relues, validées par adblock-rust, réécrites compactes.
    let raw = fs::read_to_string(cache.join("resources.json")).expect("lecture de resources.json");
    let resources: Vec<Resource> = serde_json::from_str(&raw).expect("resources.json valide");
    let count = resources.len();
    let compact = serde_json::to_string(&resources).expect("sérialisation des ressources");
    fs::write(out.join("resources.json"), &compact).expect("écriture de resources.json");
    println!("resources.json : {count} ressources, {} octets", compact.len());

    // 3. Contrôle : le moteur rechargé comme sur la télé doit bloquer une pub
    //    évidente et laisser passer une page de lecteur.
    let reloaded = MovixEngine::load(&dat, &compact).expect("rechargement du moteur");
    let ad = reloaded.check(
        "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
        "https://voe.sx/e/abc",
        "script",
    );
    assert!(ad.is_some(), "doubleclick devrait être bloqué");
    let player = reloaded.check("https://voe.sx/e/abc", "https://voe.sx/e/abc", "document");
    assert!(player.is_none(), "la page du lecteur ne doit pas être bloquée");
    println!("contrôles : OK");
}

/// Résout `!#include` (fichiers voisins, une seule fois chacun) et les blocs
/// `!#if … !#else … !#endif` de uBO, comme le ferait l'extension.
fn preprocess(dir: &Path, file: &str, seen: &mut HashSet<String>) -> String {
    if !seen.insert(file.to_owned()) {
        return String::new();
    }
    let path = dir.join(file);
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("  avertissement : {} illisible ({e}), ignoré", path.display());
            return String::new();
        }
    };
    let mut out = String::with_capacity(text.len());
    // Pile des conditions : (parent actif, valeur de la condition, dans le
    // `!#else`). Une ligne est gardée si le sommet est actif.
    let mut stack: Vec<(bool, bool, bool)> = Vec::new();
    let active = |stack: &Vec<(bool, bool, bool)>| {
        stack
            .last()
            .map(|&(parent, cond, in_else)| parent && (cond != in_else))
            .unwrap_or(true)
    };
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(cond) = trimmed.strip_prefix("!#if ") {
            let parent = active(&stack);
            stack.push((parent, eval_condition(cond), false));
            continue;
        }
        if trimmed == "!#else" {
            if let Some(top) = stack.last_mut() {
                top.2 = true;
            }
            continue;
        }
        if trimmed == "!#endif" {
            stack.pop();
            continue;
        }
        if !active(&stack) {
            continue;
        }
        if let Some(included) = trimmed.strip_prefix("!#include ") {
            let included = included.trim();
            // Seuls les fichiers voisins sont suivis (comme uBO).
            if !included.contains('/') && !included.contains('\\') {
                out.push_str(&preprocess(dir, included, seen));
                out.push('\n');
            }
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// Évalue une condition `!#if` : jetons, `!`, `&&`, `||`, parenthèses.
fn eval_condition(cond: &str) -> bool {
    let tokens = tokenize(cond);
    let mut pos = 0;
    parse_or(&tokens, &mut pos)
}

fn tokenize(cond: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = cond.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if c == '(' || c == ')' || c == '!' {
            tokens.push(c.to_string());
            i += 1;
        } else if (c == '&' || c == '|') && i + 1 < chars.len() && chars[i + 1] == c {
            tokens.push(format!("{c}{c}"));
            i += 2;
        } else {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            if i == start {
                i += 1;
            } else {
                tokens.push(chars[start..i].iter().collect());
            }
        }
    }
    tokens
}

fn parse_or(tokens: &[String], pos: &mut usize) -> bool {
    let mut value = parse_and(tokens, pos);
    while tokens.get(*pos).map(String::as_str) == Some("||") {
        *pos += 1;
        let rhs = parse_and(tokens, pos);
        value = value || rhs;
    }
    value
}

fn parse_and(tokens: &[String], pos: &mut usize) -> bool {
    let mut value = parse_unary(tokens, pos);
    while tokens.get(*pos).map(String::as_str) == Some("&&") {
        *pos += 1;
        let rhs = parse_unary(tokens, pos);
        value = value && rhs;
    }
    value
}

fn parse_unary(tokens: &[String], pos: &mut usize) -> bool {
    match tokens.get(*pos).map(String::as_str) {
        Some("!") => {
            *pos += 1;
            !parse_unary(tokens, pos)
        }
        Some("(") => {
            *pos += 1;
            let value = parse_or(tokens, pos);
            if tokens.get(*pos).map(String::as_str) == Some(")") {
                *pos += 1;
            }
            value
        }
        Some(token) => {
            *pos += 1;
            ENV_TRUE.contains(&token)
        }
        None => false,
    }
}
