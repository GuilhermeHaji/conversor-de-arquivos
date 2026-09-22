import express from 'express';
import { fileURLToPath } from 'node:url';
import convertRouter from './routes/convert.js';
import formatsRouter from './routes/formats.js';
import statusRouter from './routes/status.js';
import zipRouter from './routes/zip.js';
import { checkFfmpeg, checkLibreOffice } from './services/converter.js';
import { setFamilyEnabled } from './services/formats.js';

const app = express();
// Por padrão escuta só na máquina local. Em container, defina HOST=0.0.0.0 (ver Dockerfile).
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 3000;
app.disable('x-powered-by');
app.use('/convert', convertRouter);
app.use('/zip', zipRouter);
app.use('/formats', formatsRouter);
app.use('/status', statusRouter);
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
app.use((error, req, res, next) => {
  console.error('Erro interno:', error.message);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Ocorreu um erro interno. Tente novamente.' });
});

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

const office = await checkEngine('office', 'LibreOffice (documentos)', checkLibreOffice);
const video = await checkEngine('video', 'FFmpeg (vídeos)', checkFfmpeg);

if (!office && !video) {
  console.error('Nenhum motor de conversão disponível. Instale o LibreOffice e rode "npm install".');
  process.exitCode = 1;
} else {
  const server = app.listen(port, host, () => {
    console.log(`Conversor disponível em http://localhost:${port}`);
  });
  server.on('error', (error) => {
    console.error(`Não foi possível iniciar o servidor: ${error.message}`);
    process.exitCode = 1;
  });
}
