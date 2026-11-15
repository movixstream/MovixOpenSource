#!/usr/bin/env bash
# Publie une mise à jour de Movix TV : construit la release, prend l'APK
# armeabi-v7a (Fire TV), vérifie sa signature et écrit app-tv/movix-tv.apk +
# app-tv/version.json, au format lu par l'appli (data/update/UpdateManager.kt)
# et par la page /app-tv du site.
#
#   scripts/release.sh "Notes en français" "Notes in English"
#
# Ensuite, à la main : copier les deux fichiers dans MovixOpenSource1/app-tv/,
# commit et push dans ce dépôt-là.
set -euo pipefail

if [[ $# -ne 2 || -z "$1" || -z "$2" ]]; then
  echo "Usage : $0 \"notes FR\" \"notes EN\"" >&2
  exit 2
fi
NOTES_FR="$1"
NOTES_EN="$2"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GRADLE_FILE="$ROOT/app/build.gradle.kts"
DIST="$ROOT"
BUILD_ROOT="${MOVIX_ANDROID_BUILD:-$HOME/.cache/movix-android-build}"
APK_URL="https://raw.githubusercontent.com/movixstream/MovixOpenSource/main/app-tv/movix-tv.apk"
ABI="armeabi-v7a"

export JAVA_HOME="${JAVA_HOME:-$BUILD_ROOT/jdk/jdk-17.0.20+8}"
JAVA="$JAVA_HOME/bin/java"
[[ -x "$JAVA" || -x "$JAVA.exe" ]] || { echo "JDK introuvable : $JAVA_HOME" >&2; exit 1; }

# --- Version lue dans build.gradle.kts (defaultConfig) ---
read_int() { sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p" "$GRADLE_FILE" | head -n1; }
VERSION_CODE="$(read_int versionCode)"
MIN_SDK="$(read_int minSdk)"
VERSION_NAME="$(sed -nE 's/^[[:space:]]*versionName[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$GRADLE_FILE" | head -n1)"
if [[ -z "$VERSION_CODE" || -z "$VERSION_NAME" || -z "$MIN_SDK" ]]; then
  echo "versionCode, versionName ou minSdk introuvable dans $GRADLE_FILE" >&2
  exit 1
fi
echo "Version $VERSION_NAME (versionCode $VERSION_CODE, minSdk $MIN_SDK)"

# Un versionCode déjà publié ne serait jamais proposé aux télés.
if [[ -f "$DIST/version.json" ]]; then
  PREV="$(sed -nE 's/.*"versionCode"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$DIST/version.json" | head -n1)"
  if [[ -n "$PREV" && "$VERSION_CODE" -le "$PREV" ]]; then
    echo "versionCode $VERSION_CODE <= dernier publié ($PREV) : augmente versionCode dans app/build.gradle.kts." >&2
    exit 1
  fi
fi

# --- Build ---
(cd "$ROOT" && ./gradlew :app:assembleRelease)

APK="$ROOT/app/build/outputs/apk/release/app-$ABI-release.apk"
[[ -f "$APK" ]] || { echo "APK introuvable : $APK" >&2; exit 1; }

# --- Signature : apksigner des build-tools les plus récents ---
APKSIGNER_JAR="$(ls -d "$BUILD_ROOT"/sdk/build-tools/*/lib/apksigner.jar 2>/dev/null | sort -V | tail -n1 || true)"
[[ -n "$APKSIGNER_JAR" ]] || { echo "apksigner.jar introuvable dans $BUILD_ROOT/sdk/build-tools/" >&2; exit 1; }
CERTS="$("$JAVA" -jar "$APKSIGNER_JAR" verify --print-certs "$APK")" || { echo "Signature invalide." >&2; exit 1; }
echo "$CERTS" | grep -E "certificate (DN|SHA-256 digest):" || true
# La clé de debug (CN=Android Debug) change d'un poste à l'autre : une telle
# APK ne pourrait pas mettre à jour les télés déjà installées.
if echo "$CERTS" | grep -qi "CN=Android Debug"; then
  echo "Refusé : APK signée avec la clé de debug. Configure la clé de diffusion (signingConfig release)." >&2
  exit 1
fi

# --- Copie, taille, empreinte ---
mkdir -p "$DIST"
cp "$APK" "$DIST/movix-tv.apk"
SIZE="$(wc -c < "$DIST/movix-tv.apk" | tr -d '[:space:]')"
SHA="$(sha256sum "$DIST/movix-tv.apk" | cut -d' ' -f1)"

# Chaîne JSON : antislash, guillemets, sauts de ligne, tabulations.
json_str() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\r'/}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}

cat > "$DIST/version.json" <<EOF
{
  "versionCode": $VERSION_CODE,
  "versionName": $(json_str "$VERSION_NAME"),
  "apkUrl": $(json_str "$APK_URL"),
  "apkSize": $SIZE,
  "apkSha256": "$SHA",
  "minSdk": $MIN_SDK,
  "notes": {
    "fr": $(json_str "$NOTES_FR"),
    "en": $(json_str "$NOTES_EN")
  }
}
EOF

echo
echo "Prêt dans $DIST :"
echo "  movix-tv.apk  $SIZE octets  sha256 $SHA"
echo "  version.json"
echo "Copie ces deux fichiers dans MovixOpenSource1/app-tv/, puis commit et push."
