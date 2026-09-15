// Fonte única dos formatos de entrada e dos pares de conversão permitidos.
export const formats = {
  docx: {
    extension: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    outputs: ['pdf', 'odt'],
  },
  odt: {
    extension: 'odt',
    mime: 'application/vnd.oasis.opendocument.text',
    outputs: ['pdf', 'docx'],
  },
  xlsx: {
    extension: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    outputs: ['pdf', 'csv'],
  },
  pptx: {
    extension: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    outputs: ['pdf'],
  },
};

const targetArguments = {
  pdf: 'pdf',
  odt: 'odt',
  docx: 'docx',
  // CSV em UTF-8, separado por vírgulas; exporta a primeira aba.
  csv: 'csv:Text - txt - csv (StarCalc):44,34,76,1,',
};

export function getInputFormat(extension) {
  return Object.hasOwn(formats, extension) ? formats[extension] : undefined;
}

export function getConversionArgument(extension, targetFormat) {
  const inputFormat = getInputFormat(extension);
  if (typeof targetFormat !== 'string' || !inputFormat?.outputs.includes(targetFormat)) return undefined;
  return targetArguments[targetFormat];
}
