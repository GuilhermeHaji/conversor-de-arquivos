import express from 'express';
import { fileURLToPath } from 'node:url';
import convertRouter from './routes/convert.js';
import formatsRouter from './routes/formats.js';
import statusRouter from './routes/status.js';
import zipRouter from './routes/zip.js';
import { config } from './services/config.js';
import { createIpLimiter, securityHeaders } from './services/protection.js';

// Monta a aplicação sem abrir porta (o server.js cuida disso; os testes usam direto).
export function createApp(options = config) {
  const app = express();
  app.disable('x-powered-by');
  // Atrás do Caddy, o IP real do visitante vem no cabeçalho X-Forwarded-For.
  if (options.trustProxy > 0) app.set('trust proxy', options.trustProxy);

  app.use(securityHeaders);

  // O limite por IP vale só para o que consome processamento.
  const limiter = createIpLimiter({
    max: options.rateLimitMax,
    windowMs: options.rateLimitWindowMs,
    maxActive: options.maxActivePerIp,
  });
  app.use('/convert', limiter, convertRouter);
  app.use('/zip', limiter, zipRouter);
  app.use('/formats', formatsRouter);
  app.use('/status', statusRouter);
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url)), { extensions: ['html'] }));

  app.use((error, req, res, next) => {
    console.error('Erro interno:', error.message);
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'Ocorreu um erro interno. Tente novamente.' });
  });

  app.limiter = limiter;
  return app;
}
