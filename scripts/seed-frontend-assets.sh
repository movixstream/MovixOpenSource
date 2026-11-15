#!/usr/bin/env bash
# Run on the Coolify host before the first deployment using asset-history.mjs.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  printf 'Usage: sudo bash %s loadix|movix CONTAINER\n' "$0" >&2
  exit 1
fi
project="$1"
container="$2"
case "$project" in
  loadix|movix) archive="/data/frontend-assets/$project" ;;
  *) printf 'Application inconnue : %s\n' "$project" >&2; exit 1 ;;
esac
if [ "$(id -u)" -ne 0 ]; then
  printf 'Exécuter ce script avec sudo ou root pour préparer les permissions.\n' >&2
  exit 1
fi
if [ "$(docker inspect --format '{{.State.Running}}' "$container")" != true ]; then
  printf 'Le conteneur doit être démarré : %s\n' "$container" >&2
  exit 1
fi

# Loadix's old image had a flat /app layout; the new images use /app/dist.
if docker exec "$container" test -f /app/dist/index.html; then
  dist=/app/dist
elif [ "$project" = loadix ] && docker exec "$container" test -f /app/index.html; then
  dist=/app
else
  printf 'Build frontend introuvable dans ce conteneur.\n' >&2
  exit 1
fi
docker exec "$container" test -d "$dist/assets"

# Only these two explicit directories may receive recursive ownership changes.
if [ "$(realpath -m -- "$archive")" != "$archive" ]; then
  printf 'Le dossier de stockage ne doit pas passer par un lien symbolique.\n' >&2
  exit 1
fi
install -d -m 0755 -o 1000 -g 1000 -- "$archive"
if [ -e "$archive/seed" ]; then
  printf 'Un import existe déjà dans %s/seed ; il a été conservé.\n' "$archive" >&2
  exit 1
fi
if [ -d "$archive/releases" ] && [ -n "$(find "$archive/releases" -maxdepth 1 -type f -name '*.json' -print -quit)" ]; then
  printf 'Historique déjà initialisé dans %s ; aucun nouvel import nécessaire.\n' "$archive"
  exit 0
fi

# Publish the seed only after both copies complete. Interrupted copies remain
# in their private staging directory and are never imported by the server.
staging="$(mktemp -d "$archive/.seed-XXXXXXXX")"
docker cp "$container:$dist/index.html" "$staging/index.html"
docker cp "$container:$dist/assets" "$staging/assets"
touch "$staging/ready"
chmod 0755 "$staging"
chown -R -h 1000:1000 -- "$staging"
mv -T -- "$staging" "$archive/seed"
printf '%s : fichiers de %s prêts dans %s/seed\n' "$project" "$container" "$archive"
printf 'Le prochain démarrage du nouveau frontend importera cette version.\n'
