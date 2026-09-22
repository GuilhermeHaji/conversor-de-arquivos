export const MAX_CONCURRENT = 2;
export const MAX_WAITING = 10;
// Vídeos podem levar minutos; a espera na fila acompanha esse tempo.
export const MAX_WAIT_MS = 10 * 60_000;

export class QueueBusyError extends Error {
  constructor() {
    super('Servidor ocupado no momento. Tente novamente em instantes.');
    this.name = 'QueueBusyError';
  }
}

let active = 0;
const waiting = [];

function abortError() {
  const error = new Error('Requisição cancelada.');
  error.name = 'AbortError';
  return error;
}

function clearWaiting(entry) {
  clearTimeout(entry.timer);
  entry.signal?.removeEventListener('abort', entry.onAbort);
}

function removeWaiting(entry, error) {
  const index = waiting.indexOf(entry);
  if (index === -1) return;
  waiting.splice(index, 1);
  clearWaiting(entry);
  entry.reject(error);
}

function drain() {
  // Preserva a ordem de chegada e nunca inicia entradas canceladas ou vencidas.
  while (active < MAX_CONCURRENT && waiting.length > 0) {
    const entry = waiting.shift();
    clearWaiting(entry);
    if (entry.signal?.aborted) entry.reject(abortError());
    else if (Date.now() >= entry.deadline) entry.reject(new QueueBusyError());
    else run(entry);
  }
}

async function run(entry) {
  active++;
  try {
    if (entry.signal?.aborted) throw abortError();
    entry.resolve(await entry.task());
  } catch (error) {
    entry.reject(error);
  } finally {
    // A vaga só é liberada quando a conversão termina, inclusive em erro.
    active--;
    drain();
  }
}

export function enqueue(task, { signal } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (active >= MAX_CONCURRENT && waiting.length >= MAX_WAITING) {
    return Promise.reject(new QueueBusyError());
  }

  return new Promise((resolve, reject) => {
    const entry = { task, signal, resolve, reject };
    if (active < MAX_CONCURRENT) {
      run(entry);
      return;
    }

    entry.deadline = Date.now() + MAX_WAIT_MS;
    entry.onAbort = () => removeWaiting(entry, abortError());
    entry.timer = setTimeout(() => removeWaiting(entry, new QueueBusyError()), MAX_WAIT_MS);
    waiting.push(entry);
    signal?.addEventListener('abort', entry.onAbort, { once: true });
  });
}

export function getQueueStatus() {
  return { ativas: active, aguardando: waiting.length, limite: MAX_CONCURRENT };
}
