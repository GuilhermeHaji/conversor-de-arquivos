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
let selectedFile = null;
let busy = false;
let formatsPromise;
let selectionVersion = 0;

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function loadFormats() {
  // Compartilha a mesma consulta entre a inicialização e as seleções de arquivo.
  if (!formatsPromise) {
    formatsPromise = fetch('/formats').then(async (response) => {
      if (!response.ok) throw new Error('Não foi possível carregar os formatos. Selecione o arquivo para tentar novamente.');
      const formats = await response.json();
      fileInput.accept = Object.values(formats).flatMap(({ extension, mime }) => [`.${extension}`, mime]).join(',');
      fileLimit.textContent = `${Object.keys(formats).map((ext) => ext.toUpperCase()).join(', ')} · Até 20 MB`;
      return formats;
    }).catch((error) => {
      formatsPromise = null;
      throw error;
    });
  }
  return formatsPromise;
}

function updateButton() {
  buttonLabel.textContent = busy ? 'Convertendo...'
    : targetSelect.value ? `Converter para ${targetSelect.value.toUpperCase()}` : 'Converter arquivo';
}

async function selectFile(files) {
  if (busy || !files.length) return;
  const version = ++selectionVersion;
  selectedFile = null;
  convertButton.disabled = true;
  targetField.hidden = true;
  targetSelect.replaceChildren();
  updateButton();
  errorBox.hidden = true;
  status.textContent = '';
  fileName.textContent = 'Nenhum arquivo selecionado';

  if (files.length !== 1) return showError('Selecione somente um arquivo por vez.');
  const file = files[0];
  if (file.size > 20 * 1024 * 1024) return showError('O arquivo excede o tamanho máximo de 20 MB.');

  try {
    const formats = await loadFormats();
    // Uma resposta atrasada não deve sobrescrever uma seleção mais recente.
    if (version !== selectionVersion) return;
    const extension = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase();
    if (!Object.hasOwn(formats, extension)) return showError('Formato de entrada não suportado. Escolha um dos formatos indicados.');
    for (const target of formats[extension].outputs) {
      const option = document.createElement('option');
      option.value = target;
      option.textContent = target.toUpperCase();
      targetSelect.append(option);
    }
    selectedFile = file;
    fileName.textContent = file.name;
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
  selectFile([...fileInput.files]);
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
  selectFile([...event.dataTransfer.files]);
});

function setBusy(value) {
  busy = value;
  selectButton.disabled = value;
  fileInput.disabled = value;
  targetSelect.disabled = value;
  convertButton.disabled = value || !selectedFile || !targetSelect.value;
  spinner.hidden = !value;
  updateButton();
  form.setAttribute('aria-busy', String(value));
}

function getDownloadName(response, fallback) {
  const header = response.headers.get('Content-Disposition') || '';
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) {
    try { return decodeURIComponent(utf8[1]); } catch { /* Usa o nome de reserva. */ }
  }
  const quoted = header.match(/filename="((?:\\.|[^"\\])*)"/i);
  return quoted ? quoted[1].replace(/\\(.)/g, '$1') : fallback;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedFile || !targetSelect.value || busy) return;
  const targetFormat = targetSelect.value;
  errorBox.hidden = true;
  status.textContent = 'Convertendo... Aguarde a conclusão.';
  setBusy(true);

  try {
    const body = new FormData();
    body.append('file', selectedFile);
    body.append('to', targetFormat);
    const response = await fetch('/convert', { method: 'POST', body });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Não foi possível converter o arquivo. Tente novamente.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = getDownloadName(response, selectedFile.name.replace(/\.[^.]+$/, `.${targetFormat}`));
    document.body.append(link);
    link.click();
    link.remove();
    // Dá tempo ao navegador para iniciar o download antes de liberar o objeto.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    status.textContent = `${targetFormat.toUpperCase()} pronto! O download foi iniciado.`;
  } catch (error) {
    status.textContent = '';
    showError(error instanceof TypeError
      ? 'Não foi possível acessar o servidor. Verifique se ele está em execução.'
      : error.message);
  } finally {
    setBusy(false);
  }
});
