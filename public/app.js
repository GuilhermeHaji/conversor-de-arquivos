const form = document.querySelector('#convert-form');
const fileInput = document.querySelector('#file-input');
const selectButton = document.querySelector('#select-button');
const dropZone = document.querySelector('#drop-zone');
const fileName = document.querySelector('#file-name');
const convertButton = document.querySelector('#convert-button');
const buttonLabel = document.querySelector('#button-label');
const spinner = document.querySelector('#spinner');
const status = document.querySelector('#status');
const errorBox = document.querySelector('#error');
const targetField = document.querySelector('#target-field');
const targetSelect = document.querySelector('#target-format');
const fileLimit = document.querySelector('#file-limit');
const progress = document.querySelector('#progress');
const progressBar = document.querySelector('#progress-bar');

// "zip" é tratado só no navegador: envia para /zip em vez de /convert.
const ZIP_OPTION = 'zip';
const FAMILY_NAMES = { office: 'documentos', video: 'vídeos' };
let selectedFiles = [];
let busy = false;
let formatsPromise;
let selectionVersion = 0;

function formatMB(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// Tamanho de um arquivo escolhido: KB abaixo de 1 MB, MB com uma casa acima disso.
function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function describeLimits({ formatos, zip }) {
  const byFamily = {};
  for (const entry of Object.values(formatos)) {
    byFamily[entry.family] ??= { maxBytes: entry.maxBytes, extensions: [] };
    byFamily[entry.family].extensions.push(entry.extension.toUpperCase());
  }
  const parts = Object.entries(byFamily).map(([family, { maxBytes, extensions }]) =>
    `${extensions.join(', ')} até ${formatMB(maxBytes)}`);
  parts.push(`ZIP: qualquer arquivo, até ${zip.maxFiles} por vez (${formatMB(zip.maxTotalBytes)} no total)`);
  return parts.join(' · ');
}

function loadFormats() {
  // Compartilha a mesma consulta entre a inicialização e as seleções de arquivo.
  if (!formatsPromise) {
    formatsPromise = fetch('/formats').then(async (response) => {
      if (!response.ok) throw new Error('Não foi possível carregar os formatos. Selecione o arquivo para tentar novamente.');
      const data = await response.json();
      fileLimit.textContent = describeLimits(data);
      return data;
    }).catch((error) => {
      formatsPromise = null;
      throw error;
    });
  }
  return formatsPromise;
}

function selectedOptionLabel() {
  return targetSelect.selectedOptions[0]?.dataset.short ?? '';
}

function updateButton() {
  if (busy) return;
  const value = targetSelect.value;
  buttonLabel.textContent = !value ? 'Converter arquivo'
    : value === ZIP_OPTION ? 'Compactar em ZIP' : `Converter para ${selectedOptionLabel()}`;
}

function addOption(value, label, short = label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  option.dataset.short = short;
  targetSelect.append(option);
}

function resetSelection() {
  selectedFiles = [];
  convertButton.disabled = true;
  targetField.hidden = true;
  targetSelect.replaceChildren();
  errorBox.hidden = true;
  status.textContent = '';
  fileName.textContent = 'Nenhum arquivo selecionado';
  updateButton();
}

async function selectFiles(files) {
  if (busy || !files.length) return;
  const version = ++selectionVersion;
  resetSelection();

  try {
    const { formatos, zip } = await loadFormats();
    // Uma resposta atrasada não deve sobrescrever uma seleção mais recente.
    if (version !== selectionVersion) return;

    const total = files.reduce((sum, file) => sum + file.size, 0);
    const zipAllowed = files.length <= zip.maxFiles && total <= zip.maxTotalBytes;

    if (files.length > 1) {
      if (!zipAllowed) {
        return showError(`Para compactar, selecione até ${zip.maxFiles} arquivos somando até ${formatMB(zip.maxTotalBytes)}.`);
      }
      addOption(ZIP_OPTION, `ZIP (juntar os ${files.length} arquivos)`, 'ZIP');
      fileName.textContent = `${files.length} arquivos selecionados · ${formatSize(total)}`;
    } else {
      const file = files[0];
      const extension = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase();
      const entry = extension && Object.hasOwn(formatos, extension) ? formatos[extension] : null;
      const fitsConversion = entry && file.size <= entry.maxBytes;

      if (fitsConversion) {
        for (const output of entry.outputs) addOption(output.id, output.label, output.label.split(' (')[0]);
      }
      if (zipAllowed) addOption(ZIP_OPTION, 'ZIP (compactar o arquivo)', 'ZIP');

      if (!targetSelect.options.length) {
        return showError(entry
          ? `O arquivo excede o tamanho máximo de ${formatMB(entry.maxBytes)} para ${FAMILY_NAMES[entry.family] ?? 'este tipo'}.`
          : `O arquivo excede o tamanho máximo de ${formatMB(zip.maxTotalBytes)}.`);
      }
      if (!entry) status.textContent = 'Este formato não tem conversão disponível, mas você pode compactá-lo em ZIP.';
      else if (!fitsConversion) {
        status.textContent = `Grande demais para converter (limite de ${formatMB(entry.maxBytes)}), mas dá para compactar em ZIP.`;
      }
      fileName.textContent = `${file.name} · ${formatSize(file.size)}`;
    }

    selectedFiles = files;
    targetField.hidden = false;
    convertButton.disabled = false;
    updateButton();
  } catch (error) {
    if (version === selectionVersion) showError(error.message);
  }
}

loadFormats().catch(() => showError('Não foi possível carregar os formatos. Selecione o arquivo para tentar novamente.'));
targetSelect.addEventListener('change', updateButton);
selectButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  selectFiles([...fileInput.files]);
  fileInput.value = '';
});
for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!busy) dropZone.classList.add('dragging');
  });
}
dropZone.addEventListener('dragleave', (event) => {
  if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('dragging');
});
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
  selectFiles([...event.dataTransfer.files]);
});

function setBusy(value, label) {
  busy = value;
  selectButton.disabled = value;
  fileInput.disabled = value;
  targetSelect.disabled = value;
  convertButton.disabled = value || !selectedFiles.length || !targetSelect.value;
  spinner.hidden = !value;
  form.setAttribute('aria-busy', String(value));
  if (value) buttonLabel.textContent = label;
  else updateButton();
}

function setProgress(fraction) {
  progress.hidden = fraction === null;
  progressBar.style.width = `${Math.round((fraction ?? 0) * 100)}%`;
}

function getDownloadName(header, fallback) {
  const value = header || '';
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try { return decodeURIComponent(utf8[1]); } catch { /* Usa o nome de reserva. */ }
  }
  const quoted = value.match(/filename="((?:\\.|[^"\\])*)"/i);
  return quoted ? quoted[1].replace(/\\(.)/g, '$1') : fallback;
}

function startStatusPolling(working) {
  const controller = new AbortController();
  let stopped = false;
  let inFlight = false;
  const timer = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const response = await fetch('/status', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (!stopped && busy && progress.hidden) {
        status.textContent = data.aguardando > 0 ? `${working} (${data.aguardando} na fila)` : `${working} Aguarde a conclusão.`;
      }
    } catch { /* Uma falha na consulta de status não interrompe a conversão. */ }
    finally { inFlight = false; }
  }, 2_000);

  return () => {
    stopped = true;
    clearInterval(timer);
    // Impede respostas atrasadas de sobrescreverem a mensagem final.
    controller.abort();
  };
}

// XMLHttpRequest permite mostrar o progresso do envio, importante para vídeos grandes.
function send(url, body, working) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'blob';
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      setProgress(event.loaded / event.total);
      status.textContent = `Enviando... ${Math.round((event.loaded / event.total) * 100)}%`;
    });
    xhr.upload.addEventListener('load', () => {
      setProgress(null);
      status.textContent = `${working} Aguarde a conclusão.`;
    });
    xhr.addEventListener('load', async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        return resolve({ blob: xhr.response, disposition: xhr.getResponseHeader('Content-Disposition') });
      }
      const data = await xhr.response?.text().then(JSON.parse).catch(() => ({}));
      reject(new Error(data?.error || 'Não foi possível concluir. Tente novamente.'));
    });
    xhr.addEventListener('error', () => reject(new Error('Não foi possível acessar o servidor. Verifique se ele está em execução.')));
    xhr.send(body);
  });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Dá tempo ao navegador para iniciar o download antes de liberar o objeto.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedFiles.length || !targetSelect.value || busy) return;
  const target = targetSelect.value;
  const isZip = target === ZIP_OPTION;
  const short = selectedOptionLabel();
  const working = isZip ? 'Compactando...' : 'Convertendo...';
  errorBox.hidden = true;
  status.textContent = 'Enviando...';
  setBusy(true, isZip ? 'Compactando...' : 'Convertendo...');
  const stopStatusPolling = startStatusPolling(working);

  try {
    const body = new FormData();
    if (isZip) selectedFiles.forEach((file) => body.append('files', file));
    else {
      body.append('file', selectedFiles[0]);
      body.append('to', target);
    }
    const { blob, disposition } = await send(isZip ? '/zip' : '/convert', body, working);
    const fallback = isZip ? 'arquivos.zip' : selectedFiles[0].name.replace(/\.[^.]+$/, '') + '.' + target;
    download(blob, getDownloadName(disposition, fallback));
    status.textContent = `${short} pronto! O download foi iniciado.`;
  } catch (error) {
    status.textContent = '';
    showError(error.message);
  } finally {
    stopStatusPolling();
    setProgress(null);
    setBusy(false);
  }
});
