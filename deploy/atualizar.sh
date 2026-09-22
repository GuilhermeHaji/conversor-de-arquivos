#!/usr/bin/env bash
# Atualiza o site com a versão mais recente do GitHub.
# Uso:  bash ~/conversor-de-arquivos/deploy/atualizar.sh
set -euo pipefail

cd "$(dirname "$0")/.."
echo "==> Baixando a versão mais recente"
git pull --ff-only
echo "==> Reconstruindo e reiniciando (o site fica fora do ar por alguns segundos)"
sudo docker compose up -d --build
echo "==> Limpando imagens antigas"
sudo docker image prune -f
sudo docker compose ps
