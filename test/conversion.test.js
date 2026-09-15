import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import express from 'express';
import router from '../src/routes/convert.js';
import formatsRouter from '../src/routes/formats.js';
import statusRouter from '../src/routes/status.js';
import { MAX_CONCURRENT, MAX_WAITING, MAX_WAIT_MS, enqueue } from '../src/services/queue.js';
import { checkLibreOffice, convert } from '../src/services/converter.js';

const tmpRoot = fileURLToPath(new URL('../tmp/', import.meta.url));
const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const pdf = Buffer.from('%PDF-1.4\nPDF simulado somente para testar o transporte.\n%%EOF');

// Monta um DOCX mínimo em memória, sem dependências de teste adicionais.
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [filename, text] of Object.entries(entries)) {
    const name = Buffer.from(filename);
    const data = Buffer.from(text);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    header.copy(directory, 6, 4, 30);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

const docx = zip({
  '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Teste de conversão</w:t></w:r></w:p></w:body></w:document>',
});

// As outras famílias exercitam a identificação real do conteúdo ZIP pelo file-type.
function officeFixture(part, contentType, xml) {
  return zip({
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${part}" ContentType="${contentType}"/></Types>`,
    [part]: xml,
  });
}
const fixtures = {
  docx,
  odt: zip({
    mimetype: 'application/vnd.oasis.opendocument.text',
    'content.xml': '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"/>',
  }),
  xlsx: officeFixture('xl/workbook.xml',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'),
  pptx: officeFixture('ppt/presentation.xml',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'),
};

function form(data = docx, filename = 'documento.docx', type = mime, field = 'file', to = 'pdf') {
  const body = new FormData();
  body.append(field, new Blob([data], { type }), filename);
  body.append('to', to);
  return body;
}

async function assertClean() {
  // O cliente pode receber o último byte antes que o finally termine no servidor.
  for (let attempt = 0; attempt < 100; attempt++) {
    const entries = await readdir(tmpRoot).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    if (entries.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.deepEqual(await readdir(tmpRoot), []);
}

test('API HTTP e limpeza dos temporários', async (t) => {
  let mode = 'success';
  let outputPdf = pdf;
  let calls = [];
  let onSpawn;
  let killed = false;
  let failure;
  let activeProcesses = 0;
  let peakProcesses = 0;
  const releases = [];
  t.mock.method(childProcess, 'spawn', (command, args, options) => {
    const child = new EventEmitter();
    activeProcesses++;
    peakProcesses = Math.max(peakProcesses, activeProcesses);
    child.once('close', () => { activeProcesses--; });
    const outputDir = args[args.indexOf('--outdir') + 1];
    const input = args.at(-1);
    const target = args[args.indexOf('--convert-to') + 1].split(':')[0];
    calls.push({ command, args, options, outputDir, input });
    child.pid = 987654321;
    child.kill = () => { killed = true; setImmediate(() => child.emit('close', null)); return true; };
    onSpawn?.(child);
    if (mode === 'hang') return child;
    const finish = async () => {
      try {
        const fixture = fixtures[path.extname(input).slice(1)];
        assert.deepEqual((await readFile(input)).subarray(0, fixture.length), fixture);
        if (mode === 'success' || mode === 'controlled' || mode === 'wrong-extension' || mode === 'empty-output') {
          await mkdir(path.join(outputDir, 'profile'));
          await writeFile(path.join(outputDir, 'profile', 'lock'), 'perfil simulado');
          const output = target === 'pdf' ? outputPdf : fixtures[target] || Buffer.from('Produto,Quantidade\nCafé,2\n');
          const outputExtension = mode === 'wrong-extension' ? 'unexpected' : target;
          await writeFile(path.join(outputDir, `${path.parse(input).name}.${outputExtension}`),
            mode === 'empty-output' ? Buffer.alloc(0) : output);
        }
        child.emit('close', mode === 'error' ? 1 : 0);
      } catch (error) {
        failure = error;
        child.emit('error', error);
        child.emit('close', 1);
      }
    };
    if (mode === 'controlled') releases.push(() => setImmediate(finish));
    else setImmediate(finish);
    return child;
  });
  if (process.platform === 'win32') {
    t.mock.method(childProcess, 'execFile', (command, args, options, callback) => {
      assert.equal(command, 'taskkill');
      assert.deepEqual(args, ['/PID', '987654321', '/T', '/F']);
      killed = true;
      setImmediate(() => { callback(null); pendingChild.emit('close', null); });
    });
  } else {
    t.mock.method(process, 'kill', (pid, signal) => {
      assert.equal(pid, -987654321);
      assert.equal(signal, 'SIGKILL');
      killed = true;
      setImmediate(() => pendingChild.emit('close', null));
    });
  }
  let pendingChild;
  const app = express();
  app.use('/convert', router);
  app.use('/formats', formatsRouter);
  app.use('/status', statusRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/convert`;
  const post = (body, headers) => fetch(url, { method: 'POST', body, headers });
  const status = async () => (await fetch(new URL('/status', url))).json();
  const waitForStatus = async (ativas, aguardando) => {
    const expected = { ativas, aguardando, limite: MAX_CONCURRENT };
    for (let attempt = 0; attempt < 100; attempt++) {
      const actual = await status();
      if (actual.ativas === ativas && actual.aguardando === aguardando) {
        assert.deepEqual(actual, expected);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.deepEqual(await status(), expected);
  };
  const finishRequests = async (requests) => {
    // Libera os processos simulados por rodadas, mantendo as vagas ocupadas até o close.
    while (true) {
      const current = await status();
      if (current.ativas === 0 && current.aguardando === 0) break;
      releases.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const responses = await Promise.all(requests);
    for (const response of responses) {
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    await assertClean();
  };

  await t.test('GET /formats expõe somente as quatro entradas e os sete pares permitidos', async () => {
    const response = await fetch(new URL('/formats', url));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(Object.keys(data), ['docx', 'odt', 'xlsx', 'pptx']);
    assert.deepEqual(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.outputs])), {
      docx: ['pdf', 'odt'], odt: ['pdf', 'docx'], xlsx: ['pdf', 'csv'], pptx: ['pdf'],
    });
    for (const [extension, entry] of Object.entries(data)) {
      assert.equal(entry.extension, extension);
      assert.equal(typeof entry.mime, 'string');
    }
  });

  await t.test('download, Unicode, MIME real e nomes UUID', async () => {
    const response = await post(form(docx, 'relatório final.DOCX', 'text/plain'));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/pdf/);
    assert.match(response.headers.get('content-disposition'), /^attachment;/);
    assert.match(response.headers.get('content-disposition'), /filename="relatório final.pdf"/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
    const call = calls.at(-1);
    assert.equal(call.command, 'soffice');
    assert.equal(call.options.shell, false);
    assert.match(path.basename(call.input), /^[0-9a-f-]{36}\.docx$/);
    assert.match(path.basename(call.outputDir), /^[0-9a-f-]{36}$/);
    assert.equal(call.args.includes('relatório final.DOCX'), false);
    await assertClean();
  });

  await t.test('nome Unicode fora de Latin-1 usa filename*', async () => {
    const response = await post(form(docx, 'documento 日本.docx'));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8''documento%20%E6%97%A5%E6%9C%AC.pdf/);
    await response.arrayBuffer();
    await assertClean();
  });

  for (const [source, to, expectedMime] of [
    ['docx', 'odt', 'application/vnd.oasis.opendocument.text'],
    ['odt', 'pdf', 'application/pdf'],
    ['odt', 'docx', mime],
    ['xlsx', 'pdf', 'application/pdf'],
    ['xlsx', 'csv', 'text/csv'],
    ['pptx', 'pdf', 'application/pdf'],
  ]) {
    await t.test(`converte ${source.toUpperCase()} → ${to.toUpperCase()}`, async () => {
      const response = await post(form(fixtures[source], `relatório.final.${source}`, 'application/octet-stream', 'file', to));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type').split(';')[0], expectedMime);
      assert.ok(response.headers.get('content-disposition').includes(`relatório.final.${to}`));
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes, to === 'pdf' ? pdf : fixtures[to] || Buffer.from('Produto,Quantidade\nCafé,2\n'));
      const call = calls.at(-1);
      assert.equal(path.extname(call.input), `.${source}`);
      assert.equal(call.args[call.args.indexOf('--convert-to') + 1].split(':')[0], to);
      assert.equal(call.options.shell, false);
      assert.match(call.args[0], /^-env:UserInstallation=file:/);
      await assertClean();
    });
  }

  await t.test('aceita exatamente 20 MB', async () => {
    const data = Buffer.alloc(20 * 1024 * 1024);
    docx.copy(data);
    const response = await post(form(data));
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    await assertClean();
  });

  const invalidCases = [
    ['campo to ausente', () => { const body = form(); body.delete('to'); return body; }],
    ['campo to vazio', () => form(docx, 'documento.docx', mime, 'file', '')],
    ['destino não permitido para DOCX', () => form(docx, 'documento.docx', mime, 'file', 'csv')],
    ['destino não permitido para PPTX', () => form(fixtures.pptx, 'slides.pptx', mime, 'file', 'odt')],
    ['destino com opções de linha de comando', () => form(docx, 'documento.docx', mime, 'file', 'pdf:../../escape')],
    ['destino duplicado', () => { const body = form(); body.append('to', 'odt'); return body; }],
    ['destino como array', () => { const body = form(); body.delete('to'); body.append('to[]', 'pdf'); return body; }],
    ['campo de texto adicional', () => { const body = form(); body.append('extra', 'valor'); return body; }],
    ['PDF como entrada', () => form(pdf, 'documento.pdf')],
    ['extensão válida de outra família', () => form(docx, 'documento.xlsx')],
    ['chave herdada como extensão', () => form(docx, 'documento.constructor')],
    ['arquivo ausente', () => new FormData()],
    ['extensão incorreta com conteúdo DOCX', () => form(docx, 'documento.txt')],
    ['MIME falsificado e texto renomeado', () => form(Buffer.from('texto falso'))],
    ['arquivo vazio', () => form(Buffer.alloc(0))],
    ['ZIP comum renomeado', () => form(zip({ 'hello.txt': 'não é DOCX' }))],
    ['ZIP truncado', () => form(docx.subarray(0, 35))],
    ['campo diferente de file', () => form(docx, 'documento.docx', mime, 'upload')],
    ['mais de um arquivo', () => { const body = form(); body.append('file', new Blob([docx]), 'outro.docx'); return body; }],
    ['tamanho acima de 20 MB', () => form(Buffer.alloc(20 * 1024 * 1024 + 1))],
    ...['odt', 'xlsx', 'pptx'].map((ext) => [`conteúdo falsificado para ${ext}`, () => form(Buffer.from('texto falso'), `arquivo.${ext}`)]),
  ];
  for (const [name, body] of invalidCases) {
    await t.test(`400: ${name}`, async () => {
      const count = calls.length;
      const response = await post(body());
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).error, 'string');
      assert.equal(calls.length, count);
      await assertClean();
    });
  }

  await t.test('400: multipart malformado', async () => {
    const response = await post('multipart inválido', { 'Content-Type': 'multipart/form-data' });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
    await assertClean();
  });

  await t.test('nomes maliciosos não viram caminhos ou comandos', async () => {
    const response = await post(form(docx, '../../$(touch injected);.docx'));
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    assert.equal(calls.at(-1).args.some((arg) => arg.includes('injected')), false);
    await assertClean();
  });

  await t.test('requisições simultâneas têm pastas e perfis isolados', async () => {
    calls = [];
    const responses = await Promise.all([post(form()), post(form())]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    assert.equal(new Set(calls.map((call) => call.outputDir)).size, 2);
    await assertClean();
  });

  for (const value of ['error', 'no-pdf', 'wrong-extension', 'empty-output']) {
    await t.test(`500 e limpeza: ${value}`, async () => {
      mode = value;
      const response = await post(form());
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /LibreOffice/);
      await assertClean();
    });
  }

  await t.test('timeout de 60 segundos mata processo, responde 500 e limpa', async (t) => {
    mode = 'hang';
    killed = false;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const spawned = new Promise((resolve) => { onSpawn = (child) => { pendingChild = child; resolve(); }; });
    const request = post(form());
    await spawned;
    t.mock.timers.tick(60_000);
    const response = await request;
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /60 segundos/);
    assert.equal(killed, true);
    t.mock.timers.reset();
    onSpawn = null;
    await assertClean();
  });

  await t.test('desconexão durante a conversão mata processo e limpa', async () => {
    mode = 'hang';
    killed = false;
    const spawned = new Promise((resolve) => { onSpawn = (child) => { pendingChild = child; resolve(); }; });
    const boundary = 'test-boundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="to"\r\n\r\npdf\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="teste.docx"\r\nContent-Type: ${mime}\r\n\r\n`),
      docx, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const request = http.request(url, { method: 'POST', headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length,
    } });
    request.on('error', () => {});
    request.end(body);
    await spawned;
    request.destroy();
    await assertClean();
    assert.equal(killed, true);
    onSpawn = null;
  });

  await t.test('upload interrompido não deixa temporários', async () => {
    const count = calls.length;
    const request = http.request(url, { method: 'POST', headers: {
      'Content-Type': 'multipart/form-data; boundary=incomplete',
      'Content-Length': 10_000_000,
    } });
    request.on('error', () => {});
    request.write('--incomplete\r\nContent-Disposition: form-data; name="file"; filename="test.docx"\r\n\r\n');
    request.write(docx);
    await new Promise((resolve) => setTimeout(resolve, 30));
    request.destroy();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await assertClean();
    assert.equal(calls.length, count);
  });

  await t.test('download interrompido remove original e PDF', async () => {
    mode = 'success';
    outputPdf = Buffer.alloc(16 * 1024 * 1024);
    pdf.copy(outputPdf);
    const request = new Request(url, { method: 'POST', body: form() });
    const body = Buffer.from(await request.arrayBuffer());
    await new Promise((resolve, reject) => {
      const outgoing = http.request(url, { method: 'POST', headers: {
        'Content-Type': request.headers.get('content-type'), 'Content-Length': body.length,
      } }, (response) => {
        assert.equal(response.statusCode, 200);
        response.once('data', () => { response.destroy(); resolve(); });
        response.on('error', () => {});
      });
      outgoing.on('error', reject);
      outgoing.end(body);
    });
    await assertClean();
    outputPdf = pdf;
  });

  await t.test('cinco requisições respeitam a concorrência e atualizam GET /status', async () => {
    mode = 'controlled';
    calls = [];
    peakProcesses = 0;
    const initial = await fetch(new URL('/status', url));
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await initial.json(), { ativas: 0, aguardando: 0, limite: MAX_CONCURRENT });
    const requests = Array.from({ length: 5 }, () => post(form()));
    await waitForStatus(MAX_CONCURRENT, 5 - MAX_CONCURRENT);
    assert.equal(calls.length, MAX_CONCURRENT);
    await finishRequests(requests);
    assert.equal(calls.length, 5);
    assert.equal(peakProcesses, MAX_CONCURRENT);
    await waitForStatus(0, 0);
  });

  await t.test('fila cheia retorna 503 sem processo novo e valida entradas antes da fila', async () => {
    mode = 'controlled';
    calls = [];
    const requests = Array.from({ length: MAX_CONCURRENT + MAX_WAITING }, () => post(form()));
    await waitForStatus(MAX_CONCURRENT, MAX_WAITING);
    const rejected = await post(form());
    assert.equal(rejected.status, 503);
    assert.deepEqual(await rejected.json(), { error: 'Servidor ocupado no momento. Tente novamente em instantes.' });
    assert.equal(calls.length, MAX_CONCURRENT);
    const invalid = await post(form(Buffer.from('não é DOCX')));
    assert.equal(invalid.status, 400);
    await invalid.json();
    await waitForStatus(MAX_CONCURRENT, MAX_WAITING);
    await finishRequests(requests);
    assert.equal(calls.length, MAX_CONCURRENT + MAX_WAITING);
  });

  await t.test('desconexão na espera remove a entrada e os temporários sem iniciar processo', async () => {
    mode = 'controlled';
    calls = [];
    const requests = Array.from({ length: MAX_CONCURRENT }, () => post(form()));
    await waitForStatus(MAX_CONCURRENT, 0);
    const activeDirs = await readdir(tmpRoot);
    const controller = new AbortController();
    const disconnected = fetch(url, { method: 'POST', body: form(), signal: controller.signal }).catch((error) => error);
    await waitForStatus(MAX_CONCURRENT, 1);
    const queuedDir = (await readdir(tmpRoot)).find((entry) => !activeDirs.includes(entry));
    assert.ok(queuedDir);
    controller.abort();
    assert.equal((await disconnected).name, 'AbortError');
    await waitForStatus(MAX_CONCURRENT, 0);
    for (let attempt = 0; attempt < 100 && (await readdir(tmpRoot)).includes(queuedDir); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal((await readdir(tmpRoot)).includes(queuedDir), false);
    await finishRequests(requests);
    assert.equal(calls.length, MAX_CONCURRENT);
  });

  await t.test('espera de 90 segundos retorna 503 e limpa sem executar conversão', async (t) => {
    const unblock = [];
    const blockers = Array.from({ length: MAX_CONCURRENT }, () => enqueue(() => new Promise((resolve) => unblock.push(resolve))));
    const count = calls.length;
    const request = post(form());
    await waitForStatus(MAX_CONCURRENT, 1);
    // Avança o relógio para a drenagem reconhecer a expiração antes do próximo trabalho.
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    t.mock.timers.tick(MAX_WAIT_MS);
    unblock.forEach((resolve) => resolve());
    await Promise.all(blockers);
    const response = await request;
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Servidor ocupado no momento. Tente novamente em instantes.' });
    assert.equal(calls.length, count);
    t.mock.timers.reset();
    await assertClean();
    await waitForStatus(0, 0);
  });
  assert.equal(failure, undefined);
});

test('inicialização explica como instalar LibreOffice ausente', async (t) => {
  t.mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter();
    setImmediate(() => {
      child.emit('error', Object.assign(new Error('spawn soffice ENOENT'), { code: 'ENOENT' }));
      child.emit('close', -1);
    });
    return child;
  });
  await assert.rejects(checkLibreOffice(), /Instale o LibreOffice.*PATH/);
});

test('cancelamento anterior ao spawn não inicia conversão', async (t) => {
  const spawn = t.mock.method(childProcess, 'spawn', () => { throw new Error('Não deve executar'); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(convert('/input.docx', '/output', 'pdf', { signal: controller.signal }), /cancelada/);
  assert.equal(spawn.mock.callCount(), 0);
});

test('serviço recusa destinos arbitrários antes de executar o motor', async (t) => {
  const spawn = t.mock.method(childProcess, 'spawn', () => { throw new Error('Não deve executar'); });
  await assert.rejects(convert('/input.docx', '/output', '../../escape'), /não permitido/);
  await assert.rejects(convert('/input.pdf', '/output', 'docx'), /não permitido/);
  assert.equal(spawn.mock.callCount(), 0);
});
