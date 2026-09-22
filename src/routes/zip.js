import { Router } from 'express';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { zipLimits } from '../services/formats.js';
import { enqueue, QueueBusyError } from '../services/queue.js';
import {
  createTempDir, diskUpload, exceedsContentLength, formatMB, receive, rejectEarly,
  removeTempDir, safeName, sendDownload, watchDisconnect,
} from '../services/uploads.js';

const upload = diskUpload({
  fileSize: zipLimits.maxTotalBytes, files: zipLimits.maxFiles, fields: 0,
}).array('files', zipLimits.maxFiles);

// Formatos já comprimidos: guardar sem recompressão economiza CPU sem perder espaço.
const ALREADY_COMPRESSED = new Set([
  'zip', 'rar', '7z', 'gz', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp3', 'mp4', 'mov', 'webm', 'mkv', 'avi',
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'pdf',
]);

// Evita duas entradas com o mesmo nome no ZIP: "foto.jpg", "foto (2).jpg"...
function uniqueNames(names) {
  const used = new Set();
  return names.map((name) => {
    const { name: base, ext } = path.parse(name);
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

async function createZip(entries, zipPath, signal) {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    const extension = path.extname(entry.name).slice(1).toLowerCase();
    zip.addFile(entry.path, entry.name, { compress: !ALREADY_COMPRESSED.has(extension) });
  }
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(zipPath), { signal });
  return zipPath;
}

function uploadErrorMessage(error) {
  if (error.code === 'LIMIT_FILE_SIZE') return `Os arquivos somam mais que ${formatMB(zipLimits.maxTotalBytes)}.`;
  if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
    return `Envie no máximo ${zipLimits.maxFiles} arquivos, no campo "files".`;
  }
  return 'Upload inválido. Envie os arquivos no campo "files", via multipart/form-data.';
}

async function handleZip(req, res) {
  if (exceedsContentLength(req, zipLimits.maxTotalBytes)) {
    return rejectEarly(res, `Os arquivos somam mais que ${formatMB(zipLimits.maxTotalBytes)}.`);
  }
  const tempDir = await createTempDir();
  req.tempDir = tempDir;
  const { signal, stop } = watchDisconnect(res);

  try {
    try {
      await receive(upload, req, res);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) res.status(400).json({ error: uploadErrorMessage(error) });
      return;
    }

    const files = req.files ?? [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'Selecione ao menos um arquivo no campo "files".' });
    }
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > zipLimits.maxTotalBytes) {
      return res.status(400).json({ error: `Os arquivos somam mais que ${formatMB(zipLimits.maxTotalBytes)}.` });
    }
    if (res.destroyed || signal.aborted) return;

    const names = uniqueNames(files.map((file) => safeName(file.originalname)));
    const entries = files.map((file, index) => ({ path: file.path, name: names[index] }));
    const zipPath = path.join(tempDir, 'arquivos.zip');
    await enqueue(() => createZip(entries, zipPath, signal), { signal });
    if (res.destroyed || signal.aborted) return;

    const downloadName = files.length === 1 ? `${path.parse(names[0]).name || 'arquivo'}.zip` : 'arquivos.zip';
    await sendDownload(res, zipPath, downloadName);
  } catch (error) {
    if (!res.headersSent && !res.destroyed) {
      const queueBusy = error instanceof QueueBusyError;
      res.status(queueBusy ? 503 : 500).json({
        error: queueBusy ? error.message : 'Não foi possível compactar os arquivos. Tente novamente.',
      });
    } else if (!res.destroyed) {
      res.destroy();
    }
    if (!signal.aborted && !(error instanceof QueueBusyError)) console.error('Falha ao compactar:', error.message);
  } finally {
    stop();
    await removeTempDir(tempDir);
  }
}

const router = Router();
router.post('/', (req, res, next) => {
  handleZip(req, res).catch(next);
});

export default router;
