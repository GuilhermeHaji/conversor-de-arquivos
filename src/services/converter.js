import childProcess from 'node:child_process';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const CONVERSION_TIMEOUT_MS = 60_000;

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

function runOffice(args, { timeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Requisição cancelada.'));

    // Argumentos separados e caminhos internos impedem injeção pelo nome enviado.
    const child = childProcess.spawn('soffice', args, {
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
      stop(new Error(`A conversão excedeu o limite de ${timeoutMs / 1000} segundos.`));
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
      if (code !== 0) return reject(new Error('O LibreOffice não conseguiu converter o arquivo.'));
      resolve();
    });
  });
}

export async function checkLibreOffice() {
  try {
    await runOffice(['--headless', '--version'], { timeoutMs: 10_000 });
  } catch (error) {
    throw new Error(
      'Não foi possível executar soffice. Instale o LibreOffice e adicione sua pasta program ao PATH. ' +
      'Confirme com "soffice --version" antes de iniciar o servidor.',
      { cause: error },
    );
  }
}

export async function convertDocxToPdf(inputPath, outputDir, { signal } = {}) {
  // Um perfil por conversão evita conflito com outras instâncias do LibreOffice.
  const profileUrl = pathToFileURL(path.join(outputDir, 'profile')).href;
  await runOffice([
    `-env:UserInstallation=${profileUrl}`,
    '--headless', '--convert-to', 'pdf', '--outdir', outputDir, inputPath,
  ], { timeoutMs: CONVERSION_TIMEOUT_MS, signal });

  const pdfPath = path.join(outputDir, `${path.parse(inputPath).name}.pdf`);
  const pdf = await stat(pdfPath).catch(() => null);
  // O LibreOffice pode sair com código zero mesmo sem produzir um PDF.
  if (!pdf?.isFile() || pdf.size === 0) {
    throw new Error('O LibreOffice não gerou um PDF. Verifique se o DOCX está íntegro e sem senha.');
  }
  return pdfPath;
}
