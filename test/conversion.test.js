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
import { checkLibreOffice, convertDocxToPdf } from '../src/services/converter.js';

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

function form(data = docx, filename = 'documento.docx', type = mime, field = 'file') {
  const body = new FormData();
  body.append(field, new Blob([data], { type }), filename);
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
  t.mock.method(childProcess, 'spawn', (command, args, options) => {
    const child = new EventEmitter();
    const outputDir = args[args.indexOf('--outdir') + 1];
    const input = args.at(-1);
    calls.push({ command, args, options, outputDir, input });
    child.pid = 987654321;
    child.kill = () => { killed = true; setImmediate(() => child.emit('close', null)); return true; };
    onSpawn?.(child);
    if (mode === 'hang') return child;
    setImmediate(async () => {
      try {
        assert.deepEqual((await readFile(input)).subarray(0, docx.length), docx);
        if (mode === 'success') {
          await mkdir(path.join(outputDir, 'profile'));
          await writeFile(path.join(outputDir, 'profile', 'lock'), 'perfil simulado');
          await writeFile(path.join(outputDir, `${path.parse(input).name}.pdf`), outputPdf);
        }
        child.emit('close', mode === 'error' ? 1 : 0);
      } catch (error) {
        failure = error;
        child.emit('error', error);
        child.emit('close', 1);
      }
    });
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
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/convert`;
  const post = (body, headers) => fetch(url, { method: 'POST', body, headers });

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

  await t.test('aceita exatamente 20 MB', async () => {
    const data = Buffer.alloc(20 * 1024 * 1024);
    docx.copy(data);
    const response = await post(form(data));
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    await assertClean();
  });

  const invalidCases = [
    ['arquivo ausente', () => new FormData()],
    ['extensão incorreta com conteúdo DOCX', () => form(docx, 'documento.txt')],
    ['MIME falsificado e texto renomeado', () => form(Buffer.from('texto falso'))],
    ['arquivo vazio', () => form(Buffer.alloc(0))],
    ['ZIP comum renomeado', () => form(zip({ 'hello.txt': 'não é DOCX' }))],
    ['ZIP truncado', () => form(docx.subarray(0, 35))],
    ['campo diferente de file', () => form(docx, 'documento.docx', mime, 'upload')],
    ['mais de um arquivo', () => { const body = form(); body.append('file', new Blob([docx]), 'outro.docx'); return body; }],
    ['tamanho acima de 20 MB', () => form(Buffer.alloc(20 * 1024 * 1024 + 1))],
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

  for (const value of ['error', 'no-pdf']) {
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
  await assert.rejects(convertDocxToPdf('/input.docx', '/output', { signal: controller.signal }), /cancelada/);
  assert.equal(spawn.mock.callCount(), 0);
});
