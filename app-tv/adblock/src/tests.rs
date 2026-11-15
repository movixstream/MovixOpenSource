//! Tests hôte (`cargo test`) sur le vrai moteur des assets de l'appli : le
//! code JNI ne se teste pas en JVM, mais tout ce qu'il appelle passe ici.

use super::*;
use std::sync::OnceLock;
use std::time::Instant;

fn engine() -> &'static MovixEngine {
    static ENGINE: OnceLock<MovixEngine> = OnceLock::new();
    ENGINE.get_or_init(|| {
        let assets = concat!(env!("CARGO_MANIFEST_DIR"), "/../app/src/main/assets/adblock");
        let dat = std::fs::read(format!("{assets}/engine.dat"))
            .expect("engine.dat absent : lancer ./build.sh --no-ndk");
        let resources = std::fs::read_to_string(format!("{assets}/resources.json"))
            .expect("resources.json absent : lancer ./build.sh --no-ndk");
        MovixEngine::load(&dat, &resources).expect("chargement du moteur")
    })
}

const PLAYER: &str = "https://voe.sx/e/abc";

#[test]
fn bloque_les_regies() {
    let e = engine();
    assert!(e
        .check("https://securepubads.g.doubleclick.net/tag/js/gpt.js", PLAYER, "script")
        .is_some());
    assert!(e.check("https://ad.doubleclick.net/ddm/ad/x", PLAYER, "image").is_some());
    assert!(e.check("https://c1.popads.net/pop.js", PLAYER, "script").is_some());
    assert!(e.check("https://www.popads.net/", PLAYER, "subdocument").is_some());
}

#[test]
fn laisse_passer_les_lecteurs() {
    let e = engine();
    assert_eq!(e.check(PLAYER, "", "document"), None);
    assert_eq!(e.check(PLAYER, "https://movix.example/", "subdocument"), None);
    assert_eq!(e.check("https://uqload.cx/embed-abc.html", "", "document"), None);
    assert_eq!(
        e.check("https://cdn.example-video.net/hls/master.m3u8", PLAYER, "xmlhttprequest"),
        None
    );
}

#[test]
fn redirection_vers_une_ressource_data() {
    let e = engine();
    // Google IMA : uBO le remplace par un faux SDK (`google-ima.js`) pour que
    // les lecteurs qui l'attendent démarrent quand même.
    let verdict = e.check(
        "https://imasdk.googleapis.com/js/sdkloader/ima3.js",
        PLAYER,
        "script",
    );
    match verdict {
        Some(v) => assert!(v.is_empty() || v.starts_with("data:"), "verdict inattendu : {v}"),
        None => panic!("ima3.js devrait être bloqué ou redirigé"),
    }
}

#[test]
fn cosmetique_non_vide() {
    let e = engine();
    let json: serde_json::Value =
        serde_json::from_str(&e.cosmetic("https://www.lemonde.fr/")).expect("JSON valide");
    let css = json["css"].as_str().unwrap();
    assert!(!css.is_empty(), "aucun CSS pour lemonde.fr");
    assert!(css.contains("{display:none!important}"));
    assert!(json["generichide"].is_boolean());
    assert!(json["exceptions"].is_array());
}

#[test]
fn scriptlets_des_hebergeurs() {
    let e = engine();
    let json: serde_json::Value =
        serde_json::from_str(&e.cosmetic(PLAYER)).expect("JSON valide");
    let script = json["script"].as_str().unwrap();
    // `nowoif` de lists/movix.txt : la fonction de uBO et son appel.
    assert!(script.contains("scriptletGlobals"), "script vide pour voe.sx");
    assert!(script.contains("noWindowOpenIf") || script.contains("window.open"));
}

#[test]
fn selecteurs_generiques() {
    let e = engine();
    let selectors = e.hidden_selectors(
        &["ADBox".to_owned(), "contenu-normal".to_owned()],
        &["AD_300".to_owned()],
        &[],
    );
    // EasyList : `##.ADBox` et `###AD_300`.
    assert!(selectors.iter().any(|s| s == ".ADBox"), "{selectors:?}");
    assert!(selectors.iter().any(|s| s == "#AD_300"), "{selectors:?}");
    assert!(selectors.iter().all(|s| !s.contains("contenu-normal")));
}

#[test]
fn entrees_invalides_sans_panique() {
    let e = engine();
    assert_eq!(e.check("", "", ""), None);
    assert_eq!(e.check("pas une url", "n'importe quoi", "bidule"), None);
    assert_eq!(e.check("data:text/plain,abc", "", "image"), None);
    let json: serde_json::Value = serde_json::from_str(&e.cosmetic("")).unwrap();
    assert_eq!(json["css"], "");
    assert!(MovixEngine::load(b"pas un moteur", "").is_err());
    assert!(MovixEngine::load(&[], "[]").is_err());
}

#[test]
fn temps_moyen_de_check() {
    let e = engine();
    let urls = [
        ("https://securepubads.g.doubleclick.net/tag/js/gpt.js", "script"),
        ("https://voe.sx/cdn/player.js", "script"),
        ("https://cdn.example-video.net/hls/seg-001.ts", "xmlhttprequest"),
        ("https://www.google-analytics.com/analytics.js", "script"),
        ("https://fonts.gstatic.com/s/roboto.woff2", "font"),
        ("https://i.imgur.com/abc.png", "image"),
    ];
    let rounds = 2000;
    let start = Instant::now();
    for _ in 0..rounds {
        for (url, kind) in urls {
            std::hint::black_box(e.check(url, PLAYER, kind));
        }
    }
    let per_check = start.elapsed().as_secs_f64() * 1e6 / (rounds * urls.len()) as f64;
    println!("temps moyen d'un check (hôte) : {per_check:.2} µs");
}
