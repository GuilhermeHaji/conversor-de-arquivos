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
let selectedFile = null;
let busy = false;

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function selectFile(files) {
  if (busy || !files.length) return;
  selectedFile = null;
  convertButton.disabled = true;
  errorBox.hidden = true;
  status.textContent = '';
  fileName.textContent = 'Nenhum arquivo selecionado';

  if (files.length !== 1) return showError('Selecione somente um arquivo por vez.');
  const file = files[0];
  if (!/\.docx$/i.test(file.name)) return showError('Selecione um arquivo com extensão .docx.');
  if (file.size > 20 * 1024 * 1024) return showError('O arquivo excede o tamanho máximo de 20 MB.');

  selectedFile = file;
  fileName.textContent = file.name;
  convertButton.disabled = false;
}

selectButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  selectFile(fileInput.files);
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
  selectFile(event.dataTransfer.files);
});

function setBusy(value) {
  busy = value;
  selectButton.disabled = value;
  fileInput.disabled = value;
  convertButton.disabled = value || !selectedFile;
  spinner.hidden = !value;
  buttonLabel.textContent = value ? 'Convertendo...' : 'Converter para PDF';
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
  if (!selectedFile || busy) return;
  errorBox.hidden = true;
  status.textContent = 'Convertendo... Aguarde a conclusão.';
  setBusy(true);

  try {
    const body = new FormData();
    body.append('file', selectedFile);
    const response = await fetch('/convert', { method: 'POST', body });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Não foi possível converter o arquivo. Tente novamente.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = getDownloadName(response, selectedFile.name.replace(/\.docx$/i, '.pdf'));
    document.body.append(link);
    link.click();
    link.remove();
    // Dá tempo ao navegador para iniciar o download antes de liberar o objeto.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    status.textContent = 'PDF pronto! O download foi iniciado.';
  } catch (error) {
    status.textContent = '';
    showError(error instanceof TypeError
      ? 'Não foi possível acessar o servidor. Verifique se ele está em execução.'
      : error.message);
  } finally {
    setBusy(false);
  }
});
