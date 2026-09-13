import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertDocxToPdf } from '../services/converter.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TMP_ROOT = fileURLToPath(new URL('../../tmp/', import.meta.url));
const upload = multer({
  // Nenhum arquivo fica no disco se o upload for interrompido ou inválido.
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 },
}).single('file');

function downloadName(originalName) {
  // O nome é usado apenas no cabeçalho, nunca em caminhos de armazenamento.
  const name = originalName.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '');
  return `${name.slice(0, -5) || 'documento'}.pdf`;
}

function sendDownload(res, pdfPath, filename) {
  return new Promise((resolve, reject) => {
    res.download(pdfPath, filename, (error) => error ? reject(error) : resolve());
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
      return res.status(400).json({ error: 'Selecione um arquivo .docx no campo "file".' });
    }
    if (path.extname(req.file.originalname).toLowerCase() !== '.docx') {
      return res.status(400).json({ error: 'Formato inválido. Envie um arquivo com extensão .docx.' });
    }

    let detectedType;
    try {
      detectedType = await fileTypeFromBuffer(req.file.buffer);
    } catch {
      return res.status(400).json({ error: 'Não foi possível validar o conteúdo. Envie um DOCX válido.' });
    }
    // O MIME declarado pelo cliente não participa da validação do conteúdo.
    if (detectedType?.ext !== 'docx' || detectedType.mime !== DOCX_MIME) {
      return res.status(400).json({ error: 'O conteúdo do arquivo não corresponde a um documento DOCX.' });
    }
    if (res.destroyed || controller.signal.aborted) return;

    await mkdir(TMP_ROOT, { recursive: true });
    tempDir = path.join(TMP_ROOT, randomUUID());
    await mkdir(tempDir);
    const inputPath = path.join(tempDir, `${randomUUID()}.docx`);
    await writeFile(inputPath, req.file.buffer, { flag: 'wx' });
    delete req.file.buffer;

    const pdfPath = await convertDocxToPdf(inputPath, tempDir, { signal: controller.signal });
    if (res.destroyed || controller.signal.aborted) return;
    await sendDownload(res, pdfPath, downloadName(req.file.originalname));
  } catch (error) {
    if (!res.headersSent && !res.destroyed) {
      const message = error.message.startsWith('A conversão excedeu') ||
        error.message.startsWith('O LibreOffice')
        ? error.message : 'Não foi possível converter o arquivo. Tente novamente.';
      res.status(500).json({ error: message });
    } else if (!res.destroyed) {
      res.destroy();
    }
    if (!controller.signal.aborted) console.error('Falha na conversão:', error.message);
  } finally {
    res.removeListener('close', onClose);
    if (req.file) delete req.file.buffer;
    // Remove original, PDF e perfil, também em erro, timeout ou desconexão.
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
        : 'Upload inválido. Envie somente um arquivo DOCX no campo "file", via multipart/form-data.';
      return res.status(400).json({ error: message });
    }
    handleConversion(req, res).catch(next);
  });
});

export default router;
