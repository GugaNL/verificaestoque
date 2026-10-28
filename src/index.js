import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cron from 'node-cron';
import {config, validateConfig} from './config.js';
import {migrate, pool, query} from './db.js';
import {verifyMailer} from './lib/mailer.js';
import {checkStock} from './jobs/check-stock.js';
import notifyMeRoutes from './routes/notify-me.js';
import adminRoutes from './routes/admin.js';

validateConfig();

const app = Fastify({
  logger: {level: config.logLevel},
  trustProxy: true, // atrás do proxy do Coolify (Traefik/Caddy): usa o IP real no rate limit
  bodyLimit: 16 * 1024
});

await app.register(cors, {
  origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-ccorganization', 'x-ccsite']
});

await app.register(rateLimit, {global: false});

app.get('/health', async (request, reply) => {
  try {
    await query('SELECT 1');

    return {status: 'ok'};
  } catch (error) {
    request.log.error({err: error}, 'health: banco indisponível');

    return reply.code(503).send({status: 'error'});
  }
});

await app.register(notifyMeRoutes);
await app.register(adminRoutes);

await migrate(app.log);

verifyMailer()
  .then(() => app.log.info('SMTP ok'))
  .catch(error => app.log.error({err: error}, 'SMTP: falha na verificação (os envios vão falhar até corrigir)'));

const runCheck = async () => {
  try {
    const result = await checkStock(app.log);
    if (result.skipped) app.log.warn('check-stock: execução anterior ainda em andamento, pulando');
  } catch (error) {
    app.log.error({err: error}, 'check-stock: erro inesperado');
  }
};

const task = cron.schedule(config.job.cron, runCheck);
app.log.info({cron: config.job.cron}, 'job de estoque agendado');

await app.listen({port: config.port, host: '0.0.0.0'});

if (config.job.runOnStart) runCheck();

const shutdown = async signal => {
  app.log.info({signal}, 'encerrando');
  task.stop();
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
