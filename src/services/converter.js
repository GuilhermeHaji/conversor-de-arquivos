import childProcess from 'node:child_process';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { getInputFormat, getTarget } from './formats.js';

// Erro cuja mensagem pode ser mostrada ao usuário.
export class ConversionError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ConversionError';
    this.expose = true;
  }
}

// Caminho do FFmpeg: variável FFMPEG_PATH, binário do pacote ffmpeg-static ou "ffmpeg" do PATH.
export function ffmpegCommand() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const bundled = createRequire(import.meta.url)('ffmpeg-static');
    if (bundled) return bundled;
  } catch { /* Pacote ausente: tenta o FFmpeg instalado no sistema. */ }
  return 'ffmpeg';
}

function describeTimeout(ms) {
  return ms >= 120_000 ? `${ms / 60_000} minutos` : `${ms / 1000} segundos`;
}

function terminateProcess(child) {
  if (!child.pid) return Promise.resolve();

  // O launcher do LibreOffice pode criar filhos; encerra toda a árvore.
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      childProcess.execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, timeout: 5_000 }, (error) => {
          if (error) child.kill('SIGKILL');
          resolve();
        });
    });
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') child.kill('SIGKILL');
  }
  return Promise.resolve();
}

// Executa um motor com argumentos em array (sem shell), timeout e cancelamento.
function runProcess(command, args, { timeoutMs, signal, engineName }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Requisição cancelada.'));

    const child = childProcess.spawn(command, args, {
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    });
    let failure;
    let termination;
    let closed = false;

    const stop = (error) => {
      if (closed || termination) return;
      failure = error;
      termination = terminateProcess(child);
    };
    const onAbort = () => stop(new Error('Requisição cancelada.'));
    const timer = setTimeout(() => {
      stop(new ConversionError(`A conversão excedeu o limite de ${describeTimeout(timeoutMs)}.`));
    }, timeoutMs);

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.once('error', (error) => { failure ??= error; });
    child.once('close', async (code) => {
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // Só libera os arquivos depois que o processo e seus filhos terminarem.
      await termination;
      if (failure) return reject(failure);
      if (code !== 0) return reject(new ConversionError(`O ${engineName} não conseguiu converter o arquivo.`));
      resolve();
    });
  });
}

export async function checkLibreOffice() {
  try {
    await runProcess('soffice', ['--headless', '--version'], { timeoutMs: 10_000, engineName: 'LibreOffice' });
  } catch (error) {
    throw new Error(
      'Não foi possível executar soffice. Instale o LibreOffice e adicione sua pasta program ao PATH. ' +
      'Confirme com "soffice --version" antes de iniciar o servidor.',
      { cause: error },
    );
  }
}

export async function checkFfmpeg() {
  try {
    await runProcess(ffmpegCommand(), ['-hide_banner', '-version'], { timeoutMs: 10_000, engineName: 'FFmpeg' });
  } catch (error) {
    throw new Error(
      'Não foi possível executar o FFmpeg. Rode "npm install" na pasta do projeto para baixá-lo ' +
      '(pacote ffmpeg-static) ou defina a variável FFMPEG_PATH.',
      { cause: error },
    );
  }
}

async function assertOutput(outputPath, target, engineName) {
  const output = await stat(outputPath).catch(() => null);
  // O motor pode sair com código zero mesmo sem produzir o arquivo esperado.
  if (!output?.isFile() || output.size === 0) {
    throw new ConversionError(`O ${engineName} não gerou um arquivo ${target.extension.toUpperCase()}. ` +
      'Verifique se o arquivo está íntegro e sem senha.');
  }
  return outputPath;
}

async function convertWithLibreOffice(input, target, inputPath, outputDir, options) {
  // Um perfil por conversão evita conflito com outras instâncias do LibreOffice.
  const profileUrl = pathToFileURL(path.join(outputDir, 'profile')).href;
  await runProcess('soffice', [
    `-env:UserInstallation=${profileUrl}`,
    '--headless',
    ...(input.infilter ? [`--infilter=${input.infilter}`] : []),
    '--convert-to', target.filter, '--outdir', outputDir, inputPath,
  ], { ...options, engineName: 'LibreOffice' });
  const outputPath = path.join(outputDir, `${path.parse(inputPath).name}.${target.extension}`);
  return assertOutput(outputPath, target, 'LibreOffice');
}

async function convertWithFfmpeg(input, target, inputPath, outputDir, options) {
  // Nome fixo de saída: evita colidir com a entrada quando a extensão é a mesma (MP4 → MP4 compactado).
  const outputPath = path.join(outputDir, `saida.${target.extension}`);
  await runProcess(ffmpegCommand(), [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    // Só lê arquivos locais e com o leitor da extensão validada.
    '-protocol_whitelist', 'file', '-f', input.demuxer,
    '-i', inputPath,
    ...target.ffmpeg,
    outputPath,
  ], { ...options, engineName: 'FFmpeg' });
  return assertOutput(outputPath, target, 'FFmpeg');
}

export async function convert(inputPath, outputDir, targetId, { signal } = {}) {
  const extension = path.extname(inputPath).slice(1).toLowerCase();
  const input = getInputFormat(extension);
  const target = getTarget(extension, targetId);
  if (!input || !target) throw new Error('Par de conversão não permitido.');

  const options = { timeoutMs: input.familyInfo.timeoutMs, signal };
  if (input.familyInfo.engine === 'ffmpeg') return convertWithFfmpeg(input, target, inputPath, outputDir, options);
  return convertWithLibreOffice(input, target, inputPath, outputDir, options);
}
