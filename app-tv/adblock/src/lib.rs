//! Bloqueur de pubs du lecteur web (embed) de l'appli télé Movix.
//!
//! Enveloppe JNI autour d'`adblock-rust` (le moteur de Brave) pour la classe
//! Kotlin `com.movix.tv.adblock.AdblockNative`. Le moteur est construit à
//! l'avance sur la machine de build (outil `gen`), sérialisé dans les assets
//! de l'appli, puis seulement désérialisé ici : aucun téléchargement ni
//! analyse de liste sur la télé.
//!
//! Règles de robustesse :
//! - aucune panique ne doit traverser la frontière JNI (comportement indéfini
//!   côté JVM) : chaque point d'entrée passe par `catch_unwind` ;
//! - un handle à 0 (création ratée) est accepté partout et vaut « moteur
//!   absent » : on laisse tout passer.

use std::collections::HashSet;
use std::panic::{catch_unwind, AssertUnwindSafe};

use adblock::cosmetic_filter_cache::ProceduralOrActionFilter;
use adblock::request::Request;
use adblock::resources::Resource;
use adblock::Engine;
use serde::Serialize;

/// Moteur prêt à l'emploi. En lecture seule après création : `Engine` est
/// `Send + Sync` (feature `single-thread` désactivée), les appels concurrents
/// depuis les fils réseau de la WebView sont donc sûrs.
pub struct MovixEngine {
    engine: Engine,
}

impl MovixEngine {
    /// Recharge un moteur sérialisé (`engine.dat`) et ses ressources uBO
    /// (`resources.json`, tableau de `Resource` au format adblock-rust).
    pub fn load(engine_dat: &[u8], resources_json: &str) -> Result<Self, String> {
        let mut engine = Engine::default();
        engine
            .deserialize(engine_dat)
            .map_err(|e| format!("désérialisation du moteur : {e:?}"))?;
        if !resources_json.trim().is_empty() {
            let resources: Vec<Resource> = serde_json::from_str(resources_json)
                .map_err(|e| format!("lecture de resources.json : {e}"))?;
            engine.use_resources(resources);
        }
        Ok(Self { engine })
    }

    /// Décide du sort d'une requête réseau.
    ///
    /// - `None` : laisser passer ;
    /// - `Some("")` : bloquer ;
    /// - `Some("data:…")` : remplacer par la ressource de redirection uBO.
    pub fn check(&self, url: &str, source_url: &str, request_type: &str) -> Option<String> {
        // Sans page d'origine connue, la requête est sa propre origine
        // (navigation principale) : elle est alors « première partie ».
        let source = if source_url.is_empty() { url } else { source_url };
        let request = Request::new(url, source, normalize_type(request_type), "get").ok()?;
        let result = self.engine.check_network_request(&request);
        if result.should_block() {
            Some(result.redirect.unwrap_or_default())
        } else {
            None
        }
    }

    /// Cosmétique de la page ou frame `url`, en JSON :
    /// `{"css", "script", "generichide", "exceptions", "procedural"}`.
    pub fn cosmetic(&self, url: &str) -> String {
        let resources = self.engine.url_cosmetic_resources(url);

        let mut css = String::new();
        // Une règle par sélecteur : un sélecteur invalide (syntaxe propre à un
        // autre navigateur) n'annule alors que sa propre règle.
        let mut selectors: Vec<&String> = resources.hide_selectors.iter().collect();
        selectors.sort_unstable();
        for selector in selectors {
            css.push_str(selector);
            css.push_str("{display:none!important}\n");
        }

        // Filtres d'action : ceux qui s'écrivent en CSS pur (`:style(...)`)
        // rejoignent la feuille, les autres (procéduraux, `:remove()`…) sont
        // rendus tels quels au script de page.
        let mut procedural = Vec::new();
        let mut actions: Vec<&String> = resources.procedural_actions.iter().collect();
        actions.sort_unstable();
        for raw in actions {
            match serde_json::from_str::<ProceduralOrActionFilter>(raw) {
                Ok(filter) => match filter.as_css() {
                    Some((selector, style)) => {
                        css.push_str(&selector);
                        css.push('{');
                        css.push_str(&style);
                        css.push_str("}\n");
                    }
                    None => {
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
                            procedural.push(value);
                        }
                    }
                },
                Err(_) => {}
            }
        }

        // Les scriptlets uBO lisent `scriptletGlobals`, que uBO définit dans
        // l'espace privé où ils s'exécutent : on reproduit cet espace.
        let script = if resources.injected_script.trim().is_empty() {
            String::new()
        } else {
            format!(
                "(function(){{\nconst scriptletGlobals = {{}};\n{}\n}})();",
                resources.injected_script
            )
        };

        let mut exceptions: Vec<String> = resources.exceptions.into_iter().collect();
        exceptions.sort_unstable();

        #[derive(Serialize)]
        struct Cosmetic {
            css: String,
            script: String,
            generichide: bool,
            exceptions: Vec<String>,
            procedural: Vec<serde_json::Value>,
        }
        serde_json::to_string(&Cosmetic {
            css,
            script,
            generichide: resources.generichide,
            exceptions,
            procedural,
        })
        .unwrap_or_else(|_| EMPTY_COSMETIC.to_owned())
    }

    /// Sélecteurs génériques à cacher pour ces classes et ids apparus dans la
    /// page (appelé par lots depuis le MutationObserver du script de page).
    pub fn hidden_selectors(
        &self,
        classes: &[String],
        ids: &[String],
        exceptions: &[String],
    ) -> Vec<String> {
        let exceptions: HashSet<String> = exceptions.iter().cloned().collect();
        self.engine
            .hidden_class_id_selectors(classes, ids, &exceptions)
    }
}

/// Réponse cosmétique quand le moteur est absent ou qu'une erreur survient.
pub const EMPTY_COSMETIC: &str =
    r#"{"css":"","script":"","generichide":false,"exceptions":[],"procedural":[]}"#;

/// Ramène les noms de types de la WebView (ou d'ailleurs) aux types connus
/// d'adblock-rust. Les noms inconnus deviennent `other`.
fn normalize_type(request_type: &str) -> &str {
    match request_type {
        "document" | "main_frame" => "document",
        "subdocument" | "sub_frame" | "iframe" | "frame" => "subdocument",
        "script" => "script",
        "stylesheet" | "css" => "stylesheet",
        "image" | "img" | "imageset" => "image",
        "media" | "video" | "audio" => "media",
        "font" => "font",
        "xmlhttprequest" | "xhr" | "fetch" => "xmlhttprequest",
        "websocket" => "websocket",
        "ping" | "beacon" => "ping",
        _ => "other",
    }
}

// ---------------------------------------------------------------------------
// Frontière JNI
// ---------------------------------------------------------------------------

mod jni_bridge {
    use super::*;
    use jni::objects::{JByteArray, JObject, JObjectArray, JString};
    use jni::sys::{jlong, jobjectArray, jstring};
    use jni::JNIEnv;

    /// Exécute `f` en avalant toute panique : la JVM ne doit jamais voir de
    /// déroulement de pile Rust.
    fn guard<T>(fallback: T, f: impl FnOnce() -> T) -> T {
        catch_unwind(AssertUnwindSafe(f)).unwrap_or(fallback)
    }

    /// Retrouve le moteur derrière un handle ; `None` pour 0.
    ///
    /// Sûreté : un handle non nul vient forcément de `create` et reste valide
    /// jusqu'à `destroy` (contrat tenu par `AdblockEngine`, qui ne détruit
    /// jamais le moteur tant que l'appli vit).
    unsafe fn engine<'a>(handle: jlong) -> Option<&'a MovixEngine> {
        if handle == 0 {
            None
        } else {
            Some(&*(handle as *const MovixEngine))
        }
    }

    fn read_string(env: &mut JNIEnv, value: &JString) -> Option<String> {
        if value.is_null() {
            return None;
        }
        env.get_string(value).ok().map(String::from)
    }

    fn read_string_array(env: &mut JNIEnv, array: &JObjectArray) -> Vec<String> {
        if array.is_null() {
            return Vec::new();
        }
        let len = env.get_array_length(array).unwrap_or(0);
        let mut out = Vec::with_capacity(len.max(0) as usize);
        for i in 0..len {
            let Ok(element) = env.get_object_array_element(array, i) else {
                break;
            };
            let element = JString::from(element);
            if let Some(s) = read_string(env, &element) {
                out.push(s);
            }
            let _ = env.delete_local_ref(element);
        }
        out
    }

    fn new_string(env: &mut JNIEnv, value: &str) -> jstring {
        env.new_string(value)
            .map(|s| s.into_raw())
            .unwrap_or(std::ptr::null_mut())
    }

    fn new_string_array(env: &mut JNIEnv, values: &[String]) -> jobjectArray {
        let Ok(array) =
            env.new_object_array(values.len() as i32, "java/lang/String", JObject::null())
        else {
            return std::ptr::null_mut();
        };
        for (i, value) in values.iter().enumerate() {
            let Ok(s) = env.new_string(value) else {
                return std::ptr::null_mut();
            };
            if env.set_object_array_element(&array, i as i32, &s).is_err() {
                return std::ptr::null_mut();
            }
            let _ = env.delete_local_ref(s);
        }
        array.into_raw()
    }

    #[no_mangle]
    pub extern "system" fn Java_com_movix_tv_adblock_AdblockNative_create<'local>(
        mut env: JNIEnv<'local>,
        _this: JObject<'local>,
        engine_dat: JByteArray<'local>,
        resources_json: JString<'local>,
    ) -> jlong {
        guard(0, || {
            if engine_dat.is_null() {
                return 0;
            }
            let Ok(bytes) = env.convert_byte_array(&engine_dat) else {
                return 0;
            };
            let resources = read_string(&mut env, &resources_json).unwrap_or_default();
            match MovixEngine::load(&bytes, &resources) {
                Ok(engine) => Box::into_raw(Box::new(engine)) as jlong,
                Err(_) => 0,
            }
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_movix_tv_adblock_AdblockNative_check<'local>(
        mut env: JNIEnv<'local>,
        _this: JObject<'local>,
        handle: jlong,
        url: JString<'local>,
        source_url: JString<'local>,
        request_type: JString<'local>,
    ) -> jstring {
        guard(std::ptr::null_mut(), || {
            let Some(engine) = (unsafe { engine(handle) }) else {
                return std::ptr::null_mut();
            };
            let Some(url) = read_string(&mut env, &url) else {
                return std::ptr::null_mut();
            };
            let source = read_string(&mut env, &source_url).unwrap_or_default();
            let kind = read_string(&mut env, &request_type).unwrap_or_default();
            match engine.check(&url, &source, &kind) {
                Some(verdict) => new_string(&mut env, &verdict),
                None => std::ptr::null_mut(),
            }
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_movix_tv_adblock_AdblockNative_cosmetic<'local>(
        mut env: JNIEnv<'local>,
        _this: JObject<'local>,
        handle: jlong,
        url: JString<'local>,
    ) -> jstring {
        let json = guard(EMPTY_COSMETIC.to_owned(), || {
            let Some(engine) = (unsafe { engine(handle) }) else {
                return EMPTY_COSMETIC.to_owned();
            };
            match read_string(&mut env, &url) {
                Some(url) => engine.cosmetic(&url),
                None => EMPTY_COSMETIC.to_owned(),
            }
        });
        guard(std::ptr::null_mut(), || new_string(&mut env, &json))
    }

    #[no_mangle]
    pub extern "system" fn Java_com_movix_tv_adblock_AdblockNative_hiddenSelectors<'local>(
        mut env: JNIEnv<'local>,
        _this: JObject<'local>,
        handle: jlong,
        classes: JObjectArray<'local>,
        ids: JObjectArray<'local>,
        exceptions: JObjectArray<'local>,
    ) -> jobjectArray {
        let selectors = guard(Vec::new(), || {
            let Some(engine) = (unsafe { engine(handle) }) else {
                return Vec::new();
            };
            let classes = read_string_array(&mut env, &classes);
            let ids = read_string_array(&mut env, &ids);
            let exceptions = read_string_array(&mut env, &exceptions);
            engine.hidden_selectors(&classes, &ids, &exceptions)
        });
        guard(std::ptr::null_mut(), || new_string_array(&mut env, &selectors))
    }

    #[no_mangle]
    pub extern "system" fn Java_com_movix_tv_adblock_AdblockNative_destroy<'local>(
        _env: JNIEnv<'local>,
        _this: JObject<'local>,
        handle: jlong,
    ) {
        guard((), || {
            if handle != 0 {
                // Sûreté : handle issu de `Box::into_raw` dans `create`.
                drop(unsafe { Box::from_raw(handle as *mut MovixEngine) });
            }
        })
    }
}

#[cfg(test)]
mod tests;
