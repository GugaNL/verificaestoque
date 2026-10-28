// Carrega o .env (se existir) usando o recurso nativo do Node (>= 20.12). Em produção as variáveis vêm do Coolify.
try {
  process.loadEnvFile();
} catch {
  // sem .env: segue com as variáveis do ambiente
}

const list = value =>
  String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);

  return Number.isNaN(parsed) ? fallback : parsed;
};

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;

  return ['1', 'true', 'yes', 'sim'].includes(String(value).toLowerCase());
};

const trimSlash = value => String(value || '').replace(/\/+$/, '');

export const config = {
  port: int(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL || 'info',
  publicBaseUrl: trimSlash(process.env.PUBLIC_BASE_URL || `http://localhost:${int(process.env.PORT, 3000)}`),

  databaseUrl: process.env.DATABASE_URL,

  store: {
    baseUrl: trimSlash(process.env.STORE_BASE_URL),
    allowedSiteIds: list(process.env.ALLOWED_SITE_IDS),
    catalogId: process.env.CATALOG_ID || '',
    assetLanguage: process.env.ASSET_LANGUAGE || 'pt_BR',
    requestTimeoutMs: int(process.env.STORE_TIMEOUT_MS, 15000)
  },

  corsOrigins: list(process.env.CORS_ORIGINS),

  job: {
    cron: process.env.CHECK_CRON || '*/15 * * * *',
    batchSize: int(process.env.INVENTORY_BATCH_SIZE, 50),
    minStockLevel: int(process.env.MIN_STOCK_LEVEL, 1),
    maxSendAttempts: int(process.env.MAX_SEND_ATTEMPTS, 3),
    ttlDays: int(process.env.SUBSCRIPTION_TTL_DAYS, 90),
    // Inscrições presas em "sending" (ex.: processo caiu no meio do envio) voltam para "pending" depois disso
    stuckSendingMinutes: int(process.env.STUCK_SENDING_MINUTES, 30),
    runOnStart: bool(process.env.CHECK_ON_START, true)
  },

  mail: {
    host: process.env.SMTP_HOST,
    port: int(process.env.SMTP_PORT, 465),
    secure: bool(process.env.SMTP_SECURE, true),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    subject: process.env.MAIL_SUBJECT || 'Boa notícia: o produto que você queria voltou ao estoque!',
    brandName: process.env.BRAND_NAME || 'Norte Sul Real'
  },

  adminApiKey: process.env.ADMIN_API_KEY || ''
};

export const validateConfig = () => {
  const missing = [];

  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (!config.store.baseUrl) missing.push('STORE_BASE_URL');
  if (config.store.allowedSiteIds.length === 0) missing.push('ALLOWED_SITE_IDS');
  if (!config.mail.host) missing.push('SMTP_HOST');
  if (!config.mail.from) missing.push('MAIL_FROM');

  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`);
  }
};
