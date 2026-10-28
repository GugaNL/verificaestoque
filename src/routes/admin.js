import crypto from 'node:crypto';
import {config} from '../config.js';
import {getStats, listNotifications} from '../lib/notifications.js';
import {checkStock} from '../jobs/check-stock.js';

const safeEqual = (a, b) => {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));

  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB);
};

/**
 * Rotas de administração/testes. Só são registradas se ADMIN_API_KEY estiver definida.
 * Autenticação: header x-admin-key.
 */
export default async function adminRoutes(app) {
  if (!config.adminApiKey) {
    app.log.info('ADMIN_API_KEY não definida: rotas /v1/admin desativadas');

    return;
  }

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/admin')) return;

    if (!safeEqual(request.headers['x-admin-key'] || '', config.adminApiKey)) {
      reply.code(401).send({error: 'unauthorized'});
    }
  });

  // GET /v1/admin/stats -> total por status
  app.get('/v1/admin/stats', async () => getStats());

  // GET /v1/admin/notifications?status=pending&skuId=...&email=...&limit=100
  app.get('/v1/admin/notifications', async request => listNotifications(request.query));

  // POST /v1/admin/check-stock -> roda a verificação agora (útil para testar)
  app.post('/v1/admin/check-stock', async (request, reply) => {
    const result = await checkStock(request.log);

    if (result.skipped) {
      return reply.code(409).send({error: 'already_running', message: 'Uma verificação já está em andamento.'});
    }

    return result;
  });
}
