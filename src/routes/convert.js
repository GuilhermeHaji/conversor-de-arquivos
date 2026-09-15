import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../services/converter.js';
import { getInputFormat, getConversionArgument } from '../services/formats.js';
import { enqueue, QueueBusyError } from '../services/queue.js';

const TMP_ROOT = fileURLToPath(new URL('../../tmp/', import.meta.url));
const upload = multer({
  // Nenhum arquivo fica no disco se o upload for interrompido ou inválido.
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 1 },
}).single('file');

function downloadName(originalName, targetFormat) {
  // O nome é usado apenas no cabeçalho, nunca em caminhos de armazenamento.
  const name = originalName.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '');
  return `${path.parse(name).name || 'documento'}.${targetFormat}`;
}

function sendDownload(res, outputPath, filename) {
  return new Promise((resolve, reject) => {
    res.download(outputPath, filename, (error) => error ? reject(error) : resolve());
  });
}

async function handleConversion(req, res) {
  let tempDir;
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.once('close', onClose);

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Selecione um arquivo no campo "file".' });
    }
    const extension = path.extname(req.file.originalname).slice(1).toLowerCase();
    const inputFormat = getInputFormat(extension);
    if (!inputFormat) {
      return res.status(400).json({ error: 'Formato de entrada não suportado. Consulte os formatos disponíveis.' });
    }
    const targetFormat = req.body?.to;
    if (typeof targetFormat !== 'string' || targetFormat.length === 0) {
      return res.status(400).json({ error: 'Informe o formato de destino no campo de texto "to".' });
    }
    if (!getConversionArgument(extension, targetFormat)) {
      return res.status(400).json({ error: `Destino não permitido para ${extension.toUpperCase()}. Use: ${inputFormat.outputs.join(', ')}.` });
    }

    let detectedType;
    try {
      detectedType = await fileTypeFromBuffer(req.file.buffer);
    } catch {
      return res.status(400).json({ error: 'Não foi possível validar o conteúdo. Envie um arquivo válido.' });
    }
    // O MIME declarado pelo cliente não participa da validação do conteúdo.
    if (detectedType?.ext !== inputFormat.extension || detectedType.mime !== inputFormat.mime) {
      return res.status(400).json({ error: `O conteúdo do arquivo não corresponde ao formato ${extension.toUpperCase()}.` });
    }
    if (res.destroyed || controller.signal.aborted) return;

    await mkdir(TMP_ROOT, { recursive: true });
    tempDir = path.join(TMP_ROOT, randomUUID());
    await mkdir(tempDir);
    const inputPath = path.join(tempDir, `${randomUUID()}.${inputFormat.extension}`);
    await writeFile(inputPath, req.file.buffer, { flag: 'wx' });
    delete req.file.buffer;

    const outputPath = await enqueue(
      () => convert(inputPath, tempDir, targetFormat, { signal: controller.signal }),
      { signal: controller.signal },
    );
    if (res.destroyed || controller.signal.aborted) return;
    await sendDownload(res, outputPath, downloadName(req.file.originalname, targetFormat));
  } catch (error) {
    if (!res.headersSent && !res.destroyed) {
      const queueBusy = error instanceof QueueBusyError;
      const message = queueBusy || error.message.startsWith('A conversão excedeu') ||
        error.message.startsWith('O LibreOffice')
        ? error.message : 'Não foi possível converter o arquivo. Tente novamente.';
      res.status(queueBusy ? 503 : 500).json({ error: message });
    } else if (!res.destroyed) {
      res.destroy();
    }
    if (!controller.signal.aborted && !(error instanceof QueueBusyError)) console.error('Falha na conversão:', error.message);
  } finally {
    res.removeListener('close', onClose);
    if (req.file) delete req.file.buffer;
    // Remove original, saída e perfil, também em erro, timeout ou desconexão.
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
}

const router = Router();
router.post('/', (req, res, next) => {
  upload(req, res, (error) => {
    if (error) {
      if (res.destroyed) return;
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'O arquivo excede o tamanho máximo de 20 MB.'
        : 'Upload inválido. Envie um arquivo no campo "file" e um destino no campo "to", via multipart/form-data.';
      return res.status(400).json({ error: message });
    }
    handleConversion(req, res).catch(next);
  });
});

export default router;
