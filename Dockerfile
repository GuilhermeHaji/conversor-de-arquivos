# Imagem do conversor: Node.js 22 + LibreOffice (Writer, Calc e Impress) em uma única imagem.
# Uso:
#   docker build -t conversor-de-arquivos .
#   docker run --rm -p 3000:3000 conversor-de-arquivos
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Apenas os módulos do LibreOffice usados pelas conversões e fontes básicas para o PDF.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    fonts-liberation \
    fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala só as dependências de produção, aproveitando o cache de camadas.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

# Pasta de temporários gravável pelo usuário sem privilégios.
RUN mkdir -p tmp && chown -R node:node /app
USER node

# Dentro do container o servidor precisa aceitar conexões de fora (HOST=0.0.0.0).
ENV HOST=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/status').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
