import {config} from '../config.js';
import {withAdvisoryLock} from '../db.js';
import {getStockLevels} from '../lib/occ.js';
import {sendBackInStockEmail} from '../lib/mailer.js';
import {
  claimPendingForSku,
  expireOld,
  listPendingSkus,
  markFailed,
  markSent,
  purgeSent,
  releaseStuckSending
} from '../lib/notifications.js';

// Chave fixa do advisory lock (qualquer inteiro único para este job)
const LOCK_KEY = 74_291_001;

const chunk = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));

  return chunks;
};

/**
 * 1. Apaga avisos enviados há mais de RETENTION_DAYS dias, expira inscrições vencidas e libera as presas em "sending"
 * 2. Consulta, em lotes, o estoque dos SKUs com inscrição pendente
 * 3. Para cada SKU com estoque, reserva as inscrições e envia os e-mails
 */
export const checkStock = logger =>
  withAdvisoryLock(LOCK_KEY, async () => {
    const startedAt = Date.now();
    const summary = {purged: 0, expired: 0, released: 0, skusChecked: 0, skusInStock: 0, sent: 0, failed: 0, errors: []};

    summary.purged = await purgeSent();
    summary.expired = await expireOld();
    summary.released = await releaseStuckSending();

    const pending = await listPendingSkus();

    if (pending.length === 0) {
      logger.info({...summary, durationMs: Date.now() - startedAt}, 'check-stock: nenhuma inscrição pendente');

      return summary;
    }

    // Agrupa por site (cada consulta de estoque vai com o x-ccsite correto)
    const skusBySite = new Map();
    for (const {site_id: siteId, sku_id: skuId} of pending) {
      if (!skusBySite.has(siteId)) skusBySite.set(siteId, []);
      skusBySite.get(siteId).push(skuId);
    }

    for (const [siteId, skuIds] of skusBySite) {
      for (const batch of chunk(skuIds, config.job.batchSize)) {
        let levels;

        try {
          levels = await getStockLevels({skuIds: batch, siteId});
        } catch (error) {
          logger.error({err: error, siteId, batchSize: batch.length}, 'check-stock: falha ao consultar estoque');
          summary.errors.push({siteId, message: error.message});
          continue;
        }

        summary.skusChecked += batch.length;

        for (const skuId of batch) {
          const level = levels.get(skuId) ?? 0;
          if (level < config.job.minStockLevel) continue;

          summary.skusInStock += 1;
          const notifications = await claimPendingForSku(siteId, skuId);

          for (const notification of notifications) {
            try {
              await sendBackInStockEmail(notification);
              await markSent(notification.id);
              summary.sent += 1;
              logger.info({id: notification.id, siteId, skuId, stockLevel: level}, 'check-stock: e-mail enviado');
            } catch (error) {
              await markFailed(notification.id, error);
              summary.failed += 1;
              logger.error({err: error, id: notification.id, siteId, skuId}, 'check-stock: falha ao enviar e-mail');
            }
          }
        }
      }
    }

    logger.info({...summary, durationMs: Date.now() - startedAt}, 'check-stock: concluído');

    return summary;
  });
