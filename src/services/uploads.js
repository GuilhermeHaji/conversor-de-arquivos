import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TMP_ROOT = fileURLToPath(new URL('../../tmp/', import.meta.url));

// Folga para os cabeçalhos do multipart ao comparar com o Content-Length.
const MULTIPART_OVERHEAD = 1024 * 1024;

export function formatMB(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// Cada requisição recebe uma pasta própria com UUID; tudo dentro dela é apagado no final.
export async function createTempDir() {
  await mkdir(TMP_ROOT, { recursive: true });
  const dir = path.join(TMP_ROOT, randomUUID());
  await mkdir(dir);
  return dir;
}

export function removeTempDir(dir) {
  return rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// Uploads vão direto para o disco (dentro da pasta da requisição), com nome gerado pelo servidor.
export function diskUpload(limits) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, callback) => callback(null, req.tempDir),
      filename: (req, file, callback) => callback(null, `upload-${randomUUID()}`),
    }),
    defParamCharset: 'utf8',
    limits,
  });
}

export function receive(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, (error) => (error ? reject(error) : resolve()));
  });
}

// Recusa antes de receber o corpo quando o navegador já informa um tamanho acima do limite.
export function exceedsContentLength(req, limit) {
  const length = Number(req.headers['content-length']);
  return Number.isFinite(length) && length > limit + MULTIPART_OVERHEAD;
}

export function rejectEarly(res, message) {
  res.set('Connection', 'close');
  res.status(400).json({ error: message });
}

// O nome enviado pelo usuário só é usado para nomear downloads e entradas do ZIP, nunca caminhos.
export function safeName(originalName, fallback = 'arquivo') {
  const name = String(originalName ?? '')
    .split(/[\\/]/).pop()
    .replace(/[\x00-\x1f\x7f<>:"|?*]/g, '')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 150);
  return name || fallback;
}

export function sendDownload(res, filePath, filename) {
  return new Promise((resolve, reject) => {
    res.download(filePath, filename, (error) => (error ? reject(error) : resolve()));
  });
}

// Controla o cancelamento quando o cliente desconecta antes de receber a resposta.
export function watchDisconnect(res) {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.once('close', onClose);
  return { signal: controller.signal, stop: () => res.removeListener('close', onClose) };
}
