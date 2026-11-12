# download-ux — resolve lecture → fichier

Sandbox de contribution Movix. **Isolé** : ne touche pas `src/`, `DownloadPage`, ni les routes prod.

## Pour un mainteneur / un agent (Claude, etc.)

| | |
| --- | --- |
| **But** | Remplacer à terme le parcours **`/download` DDL** (Darki / decode) par un download qui réutilise le **même resolve que le lecteur** |
| **Référence comportement** | ksama-like : `sources → resolve playable → download_to_path` (failover candidats) — pas une copie du sidecar ksama |
| **État** | **Prototype fonctionnel** (CLI) : resolve → rank → MP4/HLS → fichier réel, déjà validé sur film + épisode. **Pas d’UI**, pas de flag produit. Avec un peu plus de travail (UI + où écrire le fichier), ça peut vraiment marcher sur le site |
| **Entrée code** | `stub/types.ts` → `stub/resolvePlayable.ts` → `stub/download.ts` → `stub/providers/` |
| **Commande de référence** | `node --experimental-strip-types sandbox/download-ux/stub/run-e2e.mjs --tv 4 7 1622` (Supernatural S04E07, fichier complet) |
| **Ne pas** | Committer `.env` / `tmp-downloads/` ; brancher le frontend sans revue ; traiter le debrid DDL comme le happy path |

---

## Où ça aide / comment ça peut améliorer le site

Aujourd’hui un utilisateur qui veut **garder** un film doit souvent quitter le lecteur, passer par **`/download`**, décoder des liens DDL (Darki, Turnstile…) — un autre monde que la lecture. Résultat : friction, échecs différents du player, et deux stacks à maintenir.

| Sur le site | Amélioration possible grâce à ce parcours |
| --- | --- |
| Fiche film / série, page Watch | Bouton **Télécharger** à côté de Lecture → même sources, même resolve |
| Page `/download` | Devenir un **repli** (liens DDL) au lieu du chemin principal |
| Embed illisible / coupé (ex. 19 s) | Le ranker prend un **autre** candidat (souvent SwiftFlow MP4) au lieu d’échouer sur le 1er hoster |
| Qualité / hoster | L’utilisateur ne choisit plus un miroir à la main : **meilleur candidat** (`mp4` > `hls`, failover) |
| VIP / catalogues | Réutilise `?resolve=1` et les proxies déjà en prod — pas une nouvelle usine DDL |
| App / TV (plus tard) | Même contrat `MediaRef → fichier` ; le web peut rester « préparer le job », un helper écrit le disque |

**Verdict** : ce n’est pas une maquette — c’est un **prototype qui marche** (hors UI). Le cœur resolve → download est solide ; il manque surtout la couche produit (bouton, progression, helper/app pour le disque). Avec ce taff en plus, le parcours peut vraiment remplacer l’UX `/download` DDL comme chemin principal.

**Déjà prouvé ici** : TV TMDB `1622` saison 4 épisode 7 — MP4 SwiftFlow **complet** (~305 Mo, ~41 min, HEVC 720p).  
**Reste pour le site** : UI + où écrire le fichier (navigateur limité → helper / app / extension).

Ordre d’intégration conseillé :

1. Stabiliser ce sandbox (multi-titres)  
2. Proto UI isolé ou helper local  
3. Feature flag : bouton « Télécharger » = ce pipeline  
4. `/download` DDL en repli seulement — pas forcément supprimé

```text
AUJOURD’HUI                         CIBLE SITE
───────────                         ──────────
/download → liens Darki / decode    Watch → resolve → fichier (flag)
Turnstile / DDL parallèle           Même pipeline que la lecture
```

---

## Flux

```text
MediaRef (TMDB : movie | tv + season/episode)
  → SourceProviders (swiftflow, watch-catalog, …)
  → merge + rank (score)
  → download(candidats, { failover })
       mp4  → fetch HTTP (Referer conservé sur redirects)
       hls  → ffmpeg (-c copy) → .mp4
  → fichier dans tmp-downloads/
```

Types et options : `stub/types.ts`.  
Registry / rank : `stub/providers/registry.ts`, `rank.ts`.

---

## Prérequis

- Node.js 18+ (recommandé 22 ; `--experimental-strip-types`)
- `ffmpeg` sur le `PATH` (HLS uniquement)
- Accès réseau à la Main API Movix
- Pour les m3u8 VIP : clé `MOVIX_ACCESS_KEY`

```bash
cp sandbox/download-ux/.env.example sandbox/download-ux/.env
# éditer MOVIX_MAIN_API et éventuellement MOVIX_ACCESS_KEY
```

| Variable | Rôle |
| --- | --- |
| `MOVIX_MAIN_API` | Base API (ex. `https://api.movix.miami`) |
| `MOVIX_ACCESS_KEY` | VIP → catalogues `?resolve=1` → `m3u8Url` |
| `MOVIX_USE_TV_MP4` | `1` = resolve MP4 SwiftFlow sans Turnstile (défaut e2e) |
| `MOVIX_TURNSTILE_TOKEN` | Optionnel si resolve MP4 « movie » protégé |

---

## Commandes

Depuis la **racine** du monorepo :

```bash
# Référence : épisode complet (MP4 prioritaire, sinon HLS)
node --experimental-strip-types sandbox/download-ux/stub/run-e2e.mjs --tv 4 7 1622

# Smoke rapide (plafond octets, fichier partiel — pas une preuve de lecture)
node --experimental-strip-types sandbox/download-ux/stub/run-e2e.mjs --smoke --tv 4 7 1622

# Sous-étapes
node --experimental-strip-types sandbox/download-ux/stub/run-stub.mjs ok
node --experimental-strip-types sandbox/download-ux/stub/run-swiftflow.mjs --tv 4 7 1622
node --experimental-strip-types sandbox/download-ux/stub/run-catalog.mjs --tv 4 7 1622
node --experimental-strip-types sandbox/download-ux/stub/run-download.mjs --smoke --tv 4 7 1622
```

Sortie : `sandbox/download-ux/tmp-downloads/` (gitignoré).

### Validation de référence

| Titre | Résultat |
| --- | --- |
| TV `1622` S4E7 (Supernatural) | MP4 SwiftFlow **complet** ~305 Mo, ~41 min, HEVC 720p, décodable |

---

## Providers

| id | Rôle | Statut |
| --- | --- | --- |
| `swiftflow` | Catalogue + `mp4/resolve` → URL MP4 | Branché |
| `watch-catalog` | Fan-out wiflix / fstream / j1f / … ; m3u8 si VIP | Branché |
| `stub` | Fake OK / empty / fail | Tests contrat |
| placeholders | Autres ids catalogue | Désactivés, à brancher idem |

Rank (simplifié) : `mp4` > `hls` > `unknown` ; embeds non résolus **ignorés** au download.

---

## Où Movix résout déjà (accroche prod)

```text
Watch / extractM3u8
  → Main API catalogues (?resolve=1 + VIP)
  → embedExtraction.js → proxiesembed
  → m3u8Url signée / lecteur
```

| Cas | Endpoint / zone | Sortie |
| --- | --- | --- |
| SwiftFlow MP4 | `POST /api/swiftflow/mp4/resolve` (+ variante TV) | URL `.mp4` |
| Catalogues VIP | `/api/wiflix/…`, `/api/fstream/…`, etc. `?resolve=1` | embeds + `m3u8Url` |
| Extraction | `API/Mainapi/utils/embedExtraction.js` → proxiesembed | HLS proxy |
| Debrid | `/api/media/debrid/unlock` | Lien DDL débridé — **adjacent**, pas le happy path |
| Page `/download` | Darki / decode | **Autre monde** — hors cible de ce sandbox |

Règle produit : pas d’URL libre côté client (anti-SSRF) — seulement `MediaRef` TMDB.

Frontend utile : `src/pages/Watch/`, `src/utils/extractM3u8.ts`.

---

## Limites assumées (phase actuelle)

- CLI locale seulement (pas de bouton site)
- HLS = `ffmpeg` + souvent VIP ; URLs proxy → options ffmpeg `allowed_extensions ALL`
- Beaucoup d’embeds restent `unknown` sans `m3u8Url` → skip (failover)
- Pas de file d’attente UI / jobs multi-users
- Debrid DDL hors chemin principal
- Licence monorepo : **CC BY-NC 4.0** — crédits, pas de monétisation

---

## Arborescence

```text
sandbox/download-ux/
|-- README.md           ← ce fichier (doc unique)
|-- .env.example
|-- .gitignore
`-- stub/
    |-- types.ts
    |-- resolvePlayable.ts
    |-- download.ts
    |-- loadEnv.ts
    |-- run-e2e.mjs      ← smoke / full
    |-- run-*.mjs
    `-- providers/
```

---

## Proposition au dépôt

Ce dossier est une **proposition expérimentale** : fork + PR ciblée sur `sandbox/` uniquement, description = but + commandes + limites.

Le dépôt public accepte déjà des contributions (issues / PR fusionnées ; pas de `CONTRIBUTING.md` formel — suivre le README racine « Points importants avant de contribuer », Matrix [#groupe-ix:matrix.org](https://matrix.to/#/%23groupe-ix:matrix.org)).

Tant que ce README dit « pas d’UI / pas branché », **ne pas** lister le sandbox dans le tableau principal du README racine comme module produit.
