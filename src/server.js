import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from './app.js';
import { checkFfmpeg, checkLibreOffice } from './services/converter.js';
import { setFamilyEnabled } from './services/formats.js';
import { removeTempDir, TMP_ROOT } from './services/uploads.js';

// Por padrão escuta só na máquina local. Em container, defina HOST=0.0.0.0 (ver Dockerfile).
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 3000;

// Se o servidor caiu no meio de uma conversão, sobram pastas temporárias: apaga tudo ao iniciar.
async function cleanLeftovers() {
  await mkdir(TMP_ROOT, { recursive: true });
  const leftovers = await readdir(TMP_ROOT);
  await Promise.all(leftovers.map((entry) => removeTempDir(path.join(TMP_ROOT, entry))));
  if (leftovers.length) console.log(`Temporários antigos removidos: ${leftovers.length}`);
}

// Verifica cada motor; uma família cujo motor falta fica desativada, sem derrubar as outras.
async function checkEngine(family, label, check) {
  try {
    await check();
    console.log(`${label}: ok`);
    return true;
  } catch (error) {
    setFamilyEnabled(family, false);
    console.warn(`${label}: indisponível. ${error.message}`);
    return false;
  }
}

await cleanLeftovers();
const office = await checkEngine('office', 'LibreOffice (documentos)', checkLibreOffice);
const video = await checkEngine('video', 'FFmpeg (vídeos)', checkFfmpeg);

if (!office && !video) {
  console.error('Nenhum motor de conversão disponível. Instale o LibreOffice e rode "npm install".');
  process.exitCode = 1;
} else {
  const server = createApp().listen(port, host, () => {
    console.log(`Conversor disponível em http://localhost:${port}`);
  });
  // Uploads grandes em conexões lentas: não derruba a requisição por tempo de espera do Node.
  server.requestTimeout = 0;
  server.on('error', (error) => {
    console.error(`Não foi possível iniciar o servidor: ${error.message}`);
    process.exitCode = 1;
  });
  // Encerramento limpo quando o Docker pede para parar (atualização do site, por exemplo).
  process.once('SIGTERM', () => server.close(() => process.exit(0)));
}
