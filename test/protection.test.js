import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { createApp } from '../src/app.js';
import { createIpLimiter } from '../src/services/protection.js';

async function listen(app, t) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('limite por IP: bloqueia após o máximo na janela e libera quando ela passa', async (t) => {
  let clock = 1_000_000;
  const limiter = createIpLimiter({ max: 3, windowMs: 60_000, now: () => clock });
  t.after(() => limiter.stop());
  const app = express();
  app.set('trust proxy', 1);
  app.post('/convert', limiter, (req, res) => res.json({ ok: true }));
  const url = await listen(app, t);
  const post = (ip) => fetch(`${url}/convert`, { method: 'POST', headers: { 'X-Forwarded-For': ip } });

  for (let i = 0; i < 3; i++) assert.equal((await post('1.1.1.1')).status, 200);
  const blocked = await post('1.1.1.1');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '60');
  assert.match((await blocked.json()).error, /Muitas conversões/);
  // Outro visitante não é afetado.
  assert.equal((await post('2.2.2.2')).status, 200);
  // Passada a janela, o primeiro volta a poder converter.
  clock += 60_001;
  assert.equal((await post('1.1.1.1')).status, 200);
});

test('limite por IP: tarefas simultâneas são liberadas ao terminar, com erro ou desconexão', async (t) => {
  const limiter = createIpLimiter({ maxActive: 2 });
  t.after(() => limiter.stop());
  const pending = [];
  const app = express();
  app.post('/convert', limiter, (req, res) => pending.push(res));
  const url = await listen(app, t);
  const post = (signal) => fetch(`${url}/convert`, { method: 'POST', signal }).catch((error) => error);

  const controller = new AbortController();
  const first = post(controller.signal);
  const second = post();
  while (pending.length < 2) await new Promise((resolve) => setTimeout(resolve, 10));
  const third = await post();
  assert.equal(third.status, 429);
  assert.match((await third.json()).error, /em andamento/);

  // Uma desconexão libera a vaga.
  controller.abort();
  assert.equal((await first).name, 'AbortError');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const fourth = post();
  while (pending.length < 3) await new Promise((resolve) => setTimeout(resolve, 10));
  // Uma resposta com erro também libera.
  pending[1].status(500).end();
  pending[2].json({ ok: true });
  assert.equal((await second).status, 500);
  assert.equal((await fourth).status, 200);

  // Com as duas vagas livres de novo, duas novas tarefas entram ao mesmo tempo.
  const again = [post(), post()];
  while (pending.length < 5) await new Promise((resolve) => setTimeout(resolve, 10));
  pending[3].end();
  pending[4].end();
  for (const response of await Promise.all(again)) assert.equal(response.status, 200);
});

test('limites desligados (padrão local) não bloqueiam nada', async (t) => {
  const limiter = createIpLimiter();
  t.after(() => limiter.stop());
  const app = express();
  app.post('/convert', limiter, (req, res) => res.end('ok'));
  const url = await listen(app, t);
  const responses = await Promise.all(Array.from({ length: 30 }, () => fetch(`${url}/convert`, { method: 'POST' })));
  assert.ok(responses.every((response) => response.status === 200));
});

test('a aplicação envia cabeçalhos de segurança e serve a página de privacidade', async (t) => {
  const app = createApp({ trustProxy: 0, rateLimitMax: 0, rateLimitWindowMs: 60_000, maxActivePerIp: 0 });
  t.after(() => app.limiter.stop());
  const url = await listen(app, t);

  const home = await fetch(`${url}/`);
  assert.equal(home.status, 200);
  const csp = home.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal(home.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(home.headers.get('x-powered-by'), null);
  assert.match(await home.text(), /href="\/privacidade"/);

  const privacy = await fetch(`${url}/privacidade`);
  assert.equal(privacy.status, 200);
  const text = await privacy.text();
  assert.match(text, /LGPD/);
  assert.match(text, /apagados/);
  // A página não carrega nada de fora do site (compatível com a CSP).
  assert.equal(/<script|src="https?:|href="https?:[^"]*\.css/.test(text), false);
});

test('configuração inválida impede o servidor de iniciar com mensagem clara', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/services/config.js')"], {
    env: { ...process.env, MAX_VIDEO_MB: 'cem' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Valor inválido para MAX_VIDEO_MB/);
});

test('limites por variável de ambiente chegam ao /formats', () => {
  const script = "const { publicFormats } = await import('./src/services/formats.js'); console.log(JSON.stringify(publicFormats()));";
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, MAX_VIDEO_MB: '100', MAX_DOC_MB: '10', ZIP_MAX_MB: '50', ZIP_MAX_FILES: '5' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const { formatos, zip } = JSON.parse(result.stdout);
  assert.equal(formatos.mp4.maxBytes, 100 * 1024 * 1024);
  assert.equal(formatos.docx.maxBytes, 10 * 1024 * 1024);
  assert.deepEqual(zip, { maxFiles: 5, maxTotalBytes: 50 * 1024 * 1024 });
});
