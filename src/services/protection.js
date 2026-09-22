// Proteções para uso público: limite por IP e cabeçalhos de segurança.

function tooMany(res, message, retryAfterSeconds) {
  if (retryAfterSeconds) res.set('Retry-After', String(retryAfterSeconds));
  // A resposta sai antes de o corpo ser recebido; fechar a conexão evita ler um upload inútil.
  res.set('Connection', 'close');
  res.status(429).json({ error: message });
}

// Limita, por IP, quantas conversões podem ser iniciadas numa janela de tempo (max)
// e quantas podem estar em andamento ao mesmo tempo (maxActive). Zero desliga cada limite.
export function createIpLimiter({ max = 0, windowMs = 10 * 60_000, maxActive = 0, now = Date.now } = {}) {
  const hits = new Map();
  const active = new Map();

  // Remove IPs sem atividade recente para a memória não crescer indefinidamente.
  const sweep = setInterval(() => {
    const limit = now() - windowMs;
    for (const [ip, times] of hits) {
      if (times.at(-1) <= limit) hits.delete(ip);
    }
  }, Math.max(windowMs, 60_000));
  sweep.unref();

  function middleware(req, res, next) {
    const ip = req.ip ?? 'desconhecido';

    if (max > 0) {
      const current = now();
      const times = (hits.get(ip) ?? []).filter((time) => time > current - windowMs);
      if (times.length >= max) {
        hits.set(ip, times);
        const retry = Math.ceil((times[0] + windowMs - current) / 1000);
        return tooMany(res, 'Muitas conversões em pouco tempo. Tente novamente em alguns minutos.', retry);
      }
      times.push(current);
      hits.set(ip, times);
    }

    if (maxActive > 0) {
      const running = active.get(ip) ?? 0;
      if (running >= maxActive) {
        return tooMany(res, 'Você já tem conversões em andamento. Aguarde terminarem para enviar outra.');
      }
      active.set(ip, running + 1);
      // "close" acontece ao fim de toda resposta, inclusive em erro ou desconexão.
      res.once('close', () => {
        const left = (active.get(ip) ?? 1) - 1;
        if (left > 0) active.set(ip, left);
        else active.delete(ip);
      });
    }

    next();
  }

  middleware.stop = () => clearInterval(sweep);
  return middleware;
}

// Cabeçalhos que endurecem a página no navegador. A página só carrega arquivos do próprio site.
export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  next();
}
