import express from 'express';
import { fileURLToPath } from 'node:url';
import convertRouter from './routes/convert.js';
import formatsRouter from './routes/formats.js';
import statusRouter from './routes/status.js';
import { checkLibreOffice } from './services/converter.js';

const app = express();
const port = 3000;
app.disable('x-powered-by');
app.use('/convert', convertRouter);
app.use('/formats', formatsRouter);
app.use('/status', statusRouter);
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
app.use((error, req, res, next) => {
  console.error('Erro interno:', error.message);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Ocorreu um erro interno. Tente novamente.' });
});

try {
  // Só abre a porta após confirmar que o motor pode ser executado.
  await checkLibreOffice();
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Conversor disponível em http://localhost:${port}`);
  });
  server.on('error', (error) => {
    console.error(`Não foi possível iniciar o servidor: ${error.message}`);
    process.exitCode = 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
