import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, getQueueStatus, MAX_CONCURRENT, MAX_WAIT_MS, QueueBusyError } from '../src/services/queue.js';

test('o timer remove uma espera vencida mesmo quando nenhuma vaga é liberada', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const releases = [];
  const active = Array.from({ length: MAX_CONCURRENT }, () => enqueue(() => new Promise((resolve) => releases.push(resolve))));
  let started = false;
  const waiting = enqueue(() => { started = true; });
  const rejected = assert.rejects(waiting, QueueBusyError);
  t.mock.timers.tick(MAX_WAIT_MS);
  await rejected;
  assert.equal(started, false);
  assert.deepEqual(getQueueStatus(), { ativas: MAX_CONCURRENT, aguardando: 0, limite: MAX_CONCURRENT });
  releases.forEach((resolve) => resolve());
  await Promise.all(active);
  assert.equal(getQueueStatus().ativas, 0);
});

test('erros síncronos e assíncronos liberam vagas e preservam a ordem da fila', async () => {
  const releases = [];
  const active = Array.from({ length: MAX_CONCURRENT }, () => enqueue(() => new Promise((resolve) => releases.push(resolve))));
  const order = [];
  const sync = assert.rejects(enqueue(() => { order.push(1); throw new Error('Falha síncrona'); }), /síncrona/);
  const asyncError = assert.rejects(enqueue(async () => { order.push(2); throw new Error('Falha assíncrona'); }), /assíncrona/);
  const last = enqueue(() => { order.push(3); return 'concluído'; });
  releases.forEach((resolve) => resolve());
  await Promise.all([...active, sync, asyncError]);
  assert.equal(await last, 'concluído');
  assert.deepEqual(order, [1, 2, 3]);
  assert.deepEqual(getQueueStatus(), { ativas: 0, aguardando: 0, limite: MAX_CONCURRENT });
});

test('sinal previamente cancelado não ocupa vaga nem executa o trabalho', async () => {
  const controller = new AbortController();
  controller.abort();
  let started = false;
  await assert.rejects(enqueue(() => { started = true; }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(started, false);
  assert.deepEqual(getQueueStatus(), { ativas: 0, aguardando: 0, limite: MAX_CONCURRENT });
});
