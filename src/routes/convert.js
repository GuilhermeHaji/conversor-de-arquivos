import { Router } from 'express';
import { fileTypeFromFile } from 'file-type';
import { randomUUID } from 'node:crypto';
import { open, rename } from 'node:fs/promises';
import path from 'node:path';
import { convert } from '../services/converter.js';
import { getInputFormat, getTarget, MAX_UPLOAD_BYTES } from '../services/formats.js';
import { enqueue, QueueBusyError } from '../services/queue.js';
import {
  createTempDir, diskUpload, exceedsContentLength, formatMB, receive, rejectEarly,
  removeTempDir, safeName, sendDownload, watchDisconnect,
} from '../services/uploads.js';

const upload = diskUpload({ fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 1 }).single('file');
const TEXT_SAMPLE_BYTES = 64 * 1024;

// CSV não tem assinatura binária: exige UTF-8 válido, sem bytes nulos e sem formato binário conhecido.
async function looksLikeText(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(TEXT_SAMPLE_BYTES), 0, TEXT_SAMPLE_BYTES, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (bytesRead === 0 || sample.includes(0)) return false;
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
  } catch {
    return false;
  } finally {
    await handle.close();
  }
  return (await fileTypeFromFile(filePath).catch(() => undefined)) === undefined;
}

// O MIME declarado pelo cliente não participa: vale apenas o conteúdo do arquivo.
async function contentMatches(filePath, input) {
  if (input.text) return looksLikeText(filePath);
  const detected = await fileTypeFromFile(filePath).catch(() => undefined);
  return Boolean(detected && input.mimes.includes(detected.mime));
}

function downloadName(originalName, target) {
  const base = path.parse(safeName(originalName, 'arquivo')).name || 'arquivo';
  return `${base}${target.suffix ?? ''}.${target.extension}`;
}

function uploadErrorMessage(error) {
  if (error.code === 'LIMIT_FILE_SIZE') return `O arquivo excede o tamanho máximo de ${formatMB(MAX_UPLOAD_BYTES)}.`;
  return 'Upload inválido. Envie um arquivo no campo "file" e um destino no campo "to", via multipart/form-data.';
}

async function handleConversion(req, res) {
  if (exceedsContentLength(req, MAX_UPLOAD_BYTES)) {
    return rejectEarly(res, `O arquivo excede o tamanho máximo de ${formatMB(MAX_UPLOAD_BYTES)}.`);
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

    if (!req.file) {
      return res.status(400).json({ error: 'Selecione um arquivo no campo "file".' });
    }
    const extension = path.extname(req.file.originalname).slice(1).toLowerCase();
    const input = getInputFormat(extension);
    if (!input) {
      return res.status(400).json({ error: 'Formato de entrada não suportado. Consulte os formatos disponíveis.' });
    }
    if (req.file.size > input.familyInfo.maxBytes) {
      return res.status(400).json({
        error: `O arquivo excede o tamanho máximo de ${formatMB(input.familyInfo.maxBytes)} para ${input.familyInfo.label.toLowerCase()}.`,
      });
    }
    const targetId = req.body?.to;
    if (typeof targetId !== 'string' || targetId.length === 0) {
      return res.status(400).json({ error: 'Informe o formato de destino no campo de texto "to".' });
    }
    const target = getTarget(extension, targetId);
    if (!target) {
      return res.status(400).json({ error: `Destino não permitido para ${extension.toUpperCase()}. Use: ${input.outputs.join(', ')}.` });
    }
    if (!(await contentMatches(req.file.path, input))) {
      return res.status(400).json({ error: `O conteúdo do arquivo não corresponde ao formato ${extension.toUpperCase()}.` });
    }
    if (res.destroyed || signal.aborted) return;

    // Toda a validação acontece antes da fila: arquivos inválidos não ocupam vaga.
    const inputPath = path.join(tempDir, `${randomUUID()}.${extension}`);
    await rename(req.file.path, inputPath);
    const outputPath = await enqueue(() => convert(inputPath, tempDir, targetId, { signal }), { signal });
    if (res.destroyed || signal.aborted) return;
    await sendDownload(res, outputPath, downloadName(req.file.originalname, target));
  } catch (error) {
    if (!res.headersSent && !res.destroyed) {
      const queueBusy = error instanceof QueueBusyError;
      const message = queueBusy || error.expose ? error.message : 'Não foi possível converter o arquivo. Tente novamente.';
      res.status(queueBusy ? 503 : 500).json({ error: message });
    } else if (!res.destroyed) {
      res.destroy();
    }
    if (!signal.aborted && !(error instanceof QueueBusyError)) console.error('Falha na conversão:', error.message);
  } finally {
    stop();
    // Remove upload, saída e perfil, também em erro, timeout ou desconexão.
    await removeTempDir(tempDir);
  }
}

const router = Router();
router.post('/', (req, res, next) => {
  handleConversion(req, res).catch(next);
});

export default router;
