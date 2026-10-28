import {config} from '../config.js';
import {getCurrentProfile, getProductDetails, OccError} from '../lib/occ.js';
import {createSubscription, unsubscribeByToken} from '../lib/notifications.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const subscribeSchema = {
  body: {
    type: 'object',
    required: ['email', 'productId', 'skuId', 'siteId'],
    additionalProperties: true,
    properties: {
      email: {type: 'string', maxLength: 254},
      productId: {type: 'string', minLength: 1, maxLength: 100},
      skuId: {type: 'string', minLength: 1, maxLength: 100},
      siteId: {type: 'string', minLength: 1, maxLength: 100},
      locale: {type: 'string', maxLength: 20}
    }
  }
};

const getBearerToken = request => {
  const header = request.headers.authorization || '';
  const [type, token] = header.split(' ');

  return type && type.toLowerCase() === 'bearer' && token ? token : null;
};

const page = (title, message) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f5f8;font-family:Arial,sans-serif;color:#1f2937;padding:16px;box-sizing:border-box}
  .card{max-width:420px;width:100%;background:#fff;border-radius:14px;padding:32px 24px;text-align:center;box-shadow:0 6px 20px rgba(17,82,146,.08)}
  h1{font-size:20px;margin:0 0 8px;color:#115292} p{margin:0 0 24px;color:#4b5563;line-height:1.5}
  a{display:inline-block;background:#115292;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p><a href="${config.store.baseUrl}">Voltar para a loja</a></div></body></html>`;

export default async function notifyMeRoutes(app) {
  /**
   * POST /v1/notify-me
   * Header: Authorization: Bearer <token do cliente logado na loja>
   * Body: { email, productId, skuId, siteId, locale? }
   */
  app.post(
    '/v1/notify-me',
    {
      schema: subscribeSchema,
      config: {rateLimit: {max: 20, timeWindow: '1 minute'}}
    },
    async (request, reply) => {
      const {email, productId, skuId, siteId, locale} = request.body;
      const organizationId = request.headers['x-ccorganization'] || null;
      const token = getBearerToken(request);

      if (!config.store.allowedSiteIds.includes(siteId)) {
        return reply.code(400).send({error: 'invalid_site', message: 'Site não permitido.'});
      }

      if (!EMAIL_REGEX.test(email)) {
        return reply.code(400).send({error: 'invalid_email', message: 'E-mail inválido.'});
      }

      if (!token) {
        return reply.code(401).send({error: 'unauthorized', message: 'É preciso estar logado na loja.'});
      }

      // 1) Valida o cliente na loja com o token dele
      let profile;
      try {
        profile = await getCurrentProfile({token, siteId, organizationId});
      } catch (error) {
        if (error instanceof OccError && (error.status === 401 || error.status === 403)) {
          return reply.code(401).send({error: 'unauthorized', message: 'Sessão inválida ou expirada.'});
        }

        request.log.error({err: error}, 'notify-me: falha ao validar o perfil na loja');

        return reply.code(502).send({error: 'store_unavailable', message: 'Não foi possível validar sua sessão.'});
      }

      // 2) Busca os dados do produto (nome, URL, imagem) para o e-mail. Falha aqui não impede a inscrição.
      let product = null;
      try {
        product = await getProductDetails({productId, skuId, token, siteId, organizationId});
      } catch (error) {
        request.log.warn({err: error, productId}, 'notify-me: não foi possível buscar os dados do produto');
      }

      // 3) Grava a inscrição (sem duplicar)
      const result = await createSubscription({
        siteId,
        productId,
        skuId,
        email,
        locale,
        profileId: profile.id,
        organizationId,
        productName: product?.name,
        productUrl: product?.url,
        productImage: product?.image
      });

      request.log.info({id: result.id, created: result.created, siteId, skuId, profileId: profile.id}, 'notify-me: inscrição');

      return reply.code(result.created ? 201 : 200).send({
        status: result.created ? 'subscribed' : 'already_subscribed'
      });
    }
  );

  /**
   * GET /v1/notify-me/unsubscribe?token=...
   * Link do rodapé do e-mail.
   */
  app.get('/v1/notify-me/unsubscribe', async (request, reply) => {
    const token = String(request.query.token || '');
    const removed = token ? await unsubscribeByToken(token) : false;

    reply.type('text/html; charset=utf-8');

    return removed
      ? page('Aviso cancelado', 'Você não vai mais receber o aviso de volta ao estoque deste produto.')
      : page('Tudo certo', 'Este aviso já foi enviado, expirou ou já tinha sido cancelado.');
  });
}
