#!/usr/bin/env bash
# Instala e coloca o conversor no ar num servidor Ubuntu (feito para a Oracle Cloud, funciona em outros).
# Uso:  curl -fsSL https://raw.githubusercontent.com/GuilhermeHaji/conversor-de-arquivos/main/deploy/instalar.sh | bash -s -- seudominio.com.br
set -euo pipefail

REPO="https://github.com/GuilhermeHaji/conversor-de-arquivos.git"
PASTA="$HOME/conversor-de-arquivos"
DOMINIO="${1:-}"

passo() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
aviso() { printf '\033[1;33mAviso: %s\033[0m\n' "$1"; }

if [ -z "$DOMINIO" ]; then
  read -rp "Digite o seu domínio (ex.: meuconversor.com.br): " DOMINIO < /dev/tty
fi
DOMINIO="${DOMINIO#http://}"; DOMINIO="${DOMINIO#https://}"; DOMINIO="${DOMINIO#www.}"; DOMINIO="${DOMINIO%%/*}"
if ! [[ "$DOMINIO" =~ ^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
  echo "Domínio inválido: $DOMINIO"; exit 1
fi

passo "1/5 Atualizando o sistema e instalando o Git"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates

passo "2/5 Instalando o Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
else
  echo "Docker já instalado: $(docker --version)"
fi
sudo systemctl enable --now docker

passo "3/5 Liberando as portas 80 e 443 no firewall do servidor"
# As imagens Ubuntu da Oracle bloqueiam tudo além do SSH por padrão.
for porta in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$porta" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 1 -p tcp --dport "$porta" -j ACCEPT
done
sudo iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null \
  || sudo iptables -I INPUT 1 -p udp --dport 443 -j ACCEPT
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save
else
  aviso "netfilter-persistent não encontrado; as regras valem até o próximo reinício."
fi

passo "4/5 Baixando o código do GitHub"
if [ -d "$PASTA/.git" ]; then
  git -C "$PASTA" pull --ff-only
else
  git clone "$REPO" "$PASTA"
fi
cd "$PASTA"
if [ -f .env ] && grep -q '^DOMINIO=' .env; then
  sed -i "s/^DOMINIO=.*/DOMINIO=$DOMINIO/" .env
else
  echo "DOMINIO=$DOMINIO" >> .env
fi

passo "5/5 Construindo e iniciando (a primeira vez leva alguns minutos)"
sudo docker compose up -d --build

# Confere se o domínio já aponta para este servidor (necessário para o HTTPS).
IP_SERVIDOR="$(curl -fsS https://api.ipify.org || true)"
IP_DOMINIO="$(getent ahostsv4 "$DOMINIO" | awk 'NR==1 {print $1}' || true)"
echo
if [ -n "$IP_SERVIDOR" ] && [ "$IP_SERVIDOR" = "$IP_DOMINIO" ]; then
  echo "O domínio $DOMINIO já aponta para este servidor ($IP_SERVIDOR)."
  echo "Em até 1 minuto o site estará em: https://$DOMINIO"
else
  aviso "o domínio $DOMINIO ainda não aponta para este servidor."
  echo "  IP deste servidor: ${IP_SERVIDOR:-desconhecido}"
  echo "  IP do domínio:     ${IP_DOMINIO:-nenhum}"
  echo "Crie no Registro.br um registro A de $DOMINIO (e de www.$DOMINIO) para ${IP_SERVIDOR:-o IP do servidor}."
  echo "Quando o DNS propagar, o Caddy obtém o certificado sozinho. Não precisa rodar nada de novo."
fi
echo
echo "Ver os registros:   cd $PASTA && sudo docker compose logs -f"
echo "Atualizar o site:   bash $PASTA/deploy/atualizar.sh"
