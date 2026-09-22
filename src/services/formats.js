// Fonte única dos formatos: famílias, entradas aceitas, destinos e pares permitidos.
import { config } from './config.js';

export const families = {
  office: { label: 'Documentos', engine: 'libreoffice', maxBytes: config.maxDocumentBytes, timeoutMs: 60_000 },
  video: { label: 'Vídeos', engine: 'ffmpeg', maxBytes: config.maxVideoBytes, timeoutMs: 15 * 60_000 },
};

// Limites da compactação em ZIP (qualquer tipo de arquivo).
export const zipLimits = { maxFiles: config.zipMaxFiles, maxTotalBytes: config.zipMaxTotalBytes };

// Maior upload aceito em uma única requisição de conversão.
export const MAX_UPLOAD_BYTES = Math.max(...Object.values(families).map((family) => family.maxBytes));

const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'];
const FIRST_STREAMS = ['-map', '0:v:0', '-map', '0:a:0?'];

// Cada destino define a extensão do arquivo gerado e como o motor deve produzi-lo.
export const targets = {
  // Documentos (LibreOffice): "filter" é o valor de --convert-to.
  pdf: { label: 'PDF', extension: 'pdf', filter: 'pdf' },
  odt: { label: 'ODT', extension: 'odt', filter: 'odt' },
  docx: { label: 'DOCX', extension: 'docx', filter: 'docx:MS Word 2007 XML' },
  txt: { label: 'TXT (texto puro)', extension: 'txt', filter: 'txt:Text (encoded):UTF8' },
  html: { label: 'HTML (página web)', extension: 'html', filter: 'html:XHTML Writer File:UTF8' },
  // CSV em UTF-8, separado por vírgulas; exporta a primeira aba.
  csv: { label: 'CSV', extension: 'csv', filter: 'csv:Text - txt - csv (StarCalc):44,34,76,1,' },
  xlsx: { label: 'XLSX', extension: 'xlsx', filter: 'xlsx:Calc MS Excel 2007 XML' },
  ods: { label: 'ODS', extension: 'ods', filter: 'ods' },
  pptx: { label: 'PPTX', extension: 'pptx', filter: 'pptx:Impress MS PowerPoint 2007 XML' },
  odp: { label: 'ODP', extension: 'odp', filter: 'odp' },

  // Vídeos (FFmpeg): "ffmpeg" são os argumentos de saída.
  mp4: { label: 'MP4', extension: 'mp4', ffmpeg: [...FIRST_STREAMS, ...H264, '-movflags', '+faststart'] },
  'mp4-compacto': {
    label: 'MP4 compactado (menor)', extension: 'mp4', suffix: '-compactado',
    ffmpeg: [...FIRST_STREAMS, '-vf', "scale='trunc(min(1280,iw)/2)*2':-2",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart'],
  },
  webm: {
    label: 'WEBM', extension: 'webm',
    ffmpeg: [...FIRST_STREAMS, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1',
      '-crf', '34', '-b:v', '0', '-c:a', 'libopus', '-b:a', '96k'],
  },
  mov: { label: 'MOV', extension: 'mov', ffmpeg: [...FIRST_STREAMS, ...H264] },
  gif: {
    label: 'GIF animado (primeiros 15 s)', extension: 'gif',
    ffmpeg: ['-t', '15', '-map', '0:v:0',
      '-vf', 'fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5',
      '-loop', '0'],
  },
};

const MP4_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v'];
const MATROSKA_TYPES = ['video/webm', 'video/matroska'];

// Entradas: família, tipos aceitos na detecção do conteúdo e destinos permitidos.
// "demuxer" força o leitor do FFmpeg, impedindo que o conteúdo escolha outro (ex.: playlists).
export const inputs = {
  docx: { family: 'office', mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], outputs: ['pdf', 'odt', 'txt', 'html'] },
  odt: { family: 'office', mimes: ['application/vnd.oasis.opendocument.text'], outputs: ['pdf', 'docx', 'txt'] },
  xlsx: { family: 'office', mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], outputs: ['pdf', 'csv', 'ods'] },
  ods: { family: 'office', mimes: ['application/vnd.oasis.opendocument.spreadsheet'], outputs: ['xlsx', 'pdf', 'csv'] },
  // CSV é texto: não tem assinatura binária, então é validado como UTF-8 sem bytes nulos.
  csv: { family: 'office', text: true, infilter: 'CSV:44,34,76,1', outputs: ['xlsx', 'ods', 'pdf'] },
  pptx: { family: 'office', mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], outputs: ['pdf', 'odp'] },
  odp: { family: 'office', mimes: ['application/vnd.oasis.opendocument.presentation'], outputs: ['pptx', 'pdf'] },

  mp4: { family: 'video', mimes: MP4_TYPES, demuxer: 'mov', outputs: ['mp4-compacto', 'webm', 'gif', 'mov'] },
  mov: { family: 'video', mimes: MP4_TYPES, demuxer: 'mov', outputs: ['mp4', 'mp4-compacto', 'webm', 'gif'] },
  webm: { family: 'video', mimes: MATROSKA_TYPES, demuxer: 'matroska', outputs: ['mp4', 'mp4-compacto', 'gif'] },
  mkv: { family: 'video', mimes: MATROSKA_TYPES, demuxer: 'matroska', outputs: ['mp4', 'mp4-compacto', 'webm', 'gif'] },
  avi: { family: 'video', mimes: ['video/vnd.avi', 'video/x-msvideo'], demuxer: 'avi', outputs: ['mp4', 'mp4-compacto', 'webm', 'gif'] },
};

// Famílias cujo motor está disponível nesta máquina (o servidor desativa as ausentes ao iniciar).
const disabledFamilies = new Set();

export function setFamilyEnabled(family, enabled) {
  if (enabled) disabledFamilies.delete(family);
  else disabledFamilies.add(family);
}

export function isFamilyEnabled(family) {
  return Object.hasOwn(families, family) && !disabledFamilies.has(family);
}

export function getInputFormat(extension) {
  if (typeof extension !== 'string' || !Object.hasOwn(inputs, extension)) return undefined;
  const input = inputs[extension];
  return isFamilyEnabled(input.family) ? { extension, ...input, familyInfo: families[input.family] } : undefined;
}

// Retorna o destino somente se o par for permitido; qualquer outro valor é recusado.
export function getTarget(extension, targetId) {
  const input = getInputFormat(extension);
  if (typeof targetId !== 'string' || !input?.outputs.includes(targetId)) return undefined;
  return { id: targetId, ...targets[targetId] };
}

// Versão pública do mapa, usada pelo frontend (sem detalhes internos dos motores).
export function publicFormats() {
  const formatos = {};
  for (const [extension, input] of Object.entries(inputs)) {
    if (!isFamilyEnabled(input.family)) continue;
    formatos[extension] = {
      extension,
      family: input.family,
      maxBytes: families[input.family].maxBytes,
      outputs: input.outputs.map((id) => ({ id, label: targets[id].label, extension: targets[id].extension })),
    };
  }
  return { formatos, zip: zipLimits };
}
