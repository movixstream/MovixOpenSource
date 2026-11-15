#!/usr/bin/env bash
# Régénère le bloqueur du lecteur web : listes, moteur sérialisé, ressources
# uBO et bibliothèques natives pour les trois ABI de l'appli.
#
# Prérequis (voir README.md) : rustup + cibles Android, cargo-ndk, Node.js,
# curl, tar, NDK Android (ANDROID_NDK_HOME, sinon le NDK du cache Movix).
#
# Usage : ./build.sh            (tout)
#         ./build.sh --no-ndk   (listes + assets seulement)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/../app/src/main"
CACHE="$HERE/target/gen-cache"
LISTS="$CACHE/lists"
ASSETS="$APP/assets/adblock"

# Version épinglée de uBlock Origin pour les redirections et scriptlets.
UBO_TAG="1.75.0"

export PATH="$HOME/.cargo/bin:$PATH"
if [ -z "${ANDROID_NDK_HOME:-}" ]; then
    export ANDROID_NDK_HOME="$HOME/.cache/movix-android-build/sdk/ndk/26.1.10909125"
fi

# Listes : fichier<TAB>confiance<TAB>titre<TAB>URL. « confiance » = 1 pour
# les listes autorisées à utiliser les scriptlets `trusted-*` de uBO.
LIST_TABLE="$(cat <<'TABLE'
easylist.txt	0	EasyList	https://easylist.to/easylist/easylist.txt
liste_fr.txt	0	Liste FR	https://easylist-downloads.adblockplus.org/liste_fr.txt
filters.txt	1	uBlock filters	https://ublockorigin.github.io/uAssets/filters/filters.txt
badware.txt	1	uBlock filters – Badware risks	https://ublockorigin.github.io/uAssets/filters/badware.txt
privacy.txt	1	uBlock filters – Privacy	https://ublockorigin.github.io/uAssets/filters/privacy.txt
unbreak.txt	1	uBlock filters – Unbreak	https://ublockorigin.github.io/uAssets/filters/unbreak.txt
quick-fixes.txt	1	uBlock filters – Quick fixes	https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt
peter-lowe.txt	0	Peter Lowe's Ad and tracking server list	https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext
TABLE
)"

fetch() { # url fichier
    curl -sSfL --retry 3 -o "$2" "$1"
}

echo "== Listes de filtres"
rm -rf "$LISTS"
mkdir -p "$LISTS"
: > "$LISTS/manifest.tsv"
while IFS=$'\t' read -r file trusted title url; do
    [ -n "$file" ] || continue
    echo "  $title"
    fetch "$url" "$LISTS/$file"
    printf '%s\t%s\t%s\n' "$file" "$trusted" "$title" >> "$LISTS/manifest.tsv"
    # `!#include` : fichiers voisins sur le même serveur (récursif).
    base="${url%/*}"
    pending=("$file")
    while [ ${#pending[@]} -gt 0 ]; do
        current="${pending[0]}"
        pending=("${pending[@]:1}")
        while read -r inc; do
            [ -n "$inc" ] || continue
            case "$inc" in */*|*\\*) continue ;; esac
            [ -f "$LISTS/$inc" ] && continue
            echo "    + $inc"
            fetch "$base/$inc" "$LISTS/$inc"
            pending+=("$inc")
        done < <(sed -n 's/^!#include[[:space:]]\+\([^[:space:]]*\).*/\1/p' "$LISTS/$current" | tr -d '\r')
    done
done <<< "$LIST_TABLE"
cp "$HERE/lists/movix.txt" "$LISTS/movix.txt"
printf '%s\t%s\t%s\n' "movix.txt" "1" "Movix – lecteurs web" >> "$LISTS/manifest.tsv"

echo "== Ressources uBlock Origin $UBO_TAG"
UBO="$CACHE/ubo-$UBO_TAG"
if [ ! -d "$UBO/src" ]; then
    rm -rf "$UBO"
    mkdir -p "$UBO"
    fetch "https://codeload.github.com/gorhill/uBlock/tar.gz/refs/tags/$UBO_TAG" "$CACHE/ubo-$UBO_TAG.tar.gz"
    tar -xzf "$CACHE/ubo-$UBO_TAG.tar.gz" -C "$UBO" --strip-components=1
fi
node "$HERE/gen/ubo-resources.mjs" "$UBO" "$CACHE/resources.json"

echo "== Moteur sérialisé"
mkdir -p "$ASSETS"
(cd "$HERE" && cargo run --quiet --release --features gen --bin gen -- "$CACHE" "$ASSETS")

echo "== Tests du crate"
(cd "$HERE" && cargo test --quiet --release)

if [ "${1:-}" = "--no-ndk" ]; then
    exit 0
fi

echo "== Bibliothèques Android"
(cd "$HERE" && cargo ndk -t armeabi-v7a -t arm64-v8a -t x86 -o ../app/src/main/jniLibs build --release)

echo "== Tailles"
ls -l "$ASSETS"
ls -l "$APP"/jniLibs/*/libmovix_adblock.so
