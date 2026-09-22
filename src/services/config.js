// Configuração lida das variáveis de ambiente. Os padrões valem para uso local;
// em produção, o docker-compose.yml define limites menores e liga o limite por IP.

function number(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Valor inválido para ${name}: "${raw}". Use um número maior ou igual a zero.`);
  }
  return value;
}

const MB = 1024 * 1024;

export const config = {
  // Tamanho máximo por tipo de arquivo (MB).
  maxDocumentBytes: number('MAX_DOC_MB', 20) * MB,
  maxVideoBytes: number('MAX_VIDEO_MB', 500) * MB,
  // Compactação em ZIP.
  zipMaxFiles: number('ZIP_MAX_FILES', 20),
  zipMaxTotalBytes: number('ZIP_MAX_MB', 200) * MB,
  // Tarefas executando ao mesmo tempo no servidor.
  maxConcurrent: number('MAX_CONCURRENT', 2),
  // Limite por IP: quantas conversões numa janela de tempo (0 = desligado).
  rateLimitMax: number('RATE_LIMIT_MAX', 0),
  rateLimitWindowMs: number('RATE_LIMIT_WINDOW_MIN', 10) * 60_000,
  // Limite por IP: quantas conversões em andamento ao mesmo tempo (0 = desligado).
  maxActivePerIp: number('MAX_ACTIVE_PER_IP', 0),
  // Quantos proxies confiáveis existem na frente do servidor (1 atrás do Caddy; 0 = nenhum).
  trustProxy: number('TRUST_PROXY', 0),
};
