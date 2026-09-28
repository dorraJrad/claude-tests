#!/bin/sh
# Double-cliquez sur ce fichier pour lancer l'application (macOS).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Installez la version LTS depuis https://nodejs.org puis relancez."
  open "https://nodejs.org/fr/download"
  printf "Appuyez sur Entrée pour fermer…"; read -r _
  exit 1
fi
OPEN_BROWSER=1 exec node --disable-warning=ExperimentalWarning src/index.js
