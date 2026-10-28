import crypto from 'node:crypto';
import {query} from '../db.js';
import {config} from '../config.js';

const newToken = () => crypto.randomBytes(24).toString('base64url');

/**
 * Cria a inscrição. Se já existir uma ativa (pending/sending) para o mesmo site + SKU + e-mail,
 * não duplica e retorna {created: false}.
 */
export const createSubscription = async data => {
  const {rows} = await query(
    `INSERT INTO stock_notifications
       (site_id, product_id, sku_id, email, profile_id, organization_id, locale,
        product_name, product_url, product_image, unsubscribe_token, expires_at)
     VALUES ($1, $2, $3, lower($4), $5, $6, $7, $8, $9, $10, $11, now() + make_interval(days => $12))
     ON CONFLICT (site_id, sku_id, lower(email)) WHERE status IN ('pending', 'sending')
     DO NOTHING
     RETURNING id`,
    [
      data.siteId,
      data.productId,
      data.skuId,
      data.email,
      data.profileId || null,
      data.organizationId || null,
      data.locale || 'pt-BR',
      data.productName || null,
      data.productUrl || null,
      data.productImage || null,
      newToken(),
      config.job.ttlDays
    ]
  );

  return {created: rows.length > 0, id: rows[0]?.id || null};
};

export const unsubscribeByToken = async token => {
  const {rows} = await query(
    `UPDATE stock_notifications
        SET status = 'unsubscribed', updated_at = now()
      WHERE unsubscribe_token = $1 AND status IN ('pending', 'sending', 'error')
      RETURNING id`,
    [token]
  );

  return rows.length > 0;
};

export const expireOld = async () => {
  const {rowCount} = await query(
    `UPDATE stock_notifications
        SET status = 'expired', updated_at = now()
      WHERE status = 'pending' AND expires_at <= now()`
  );

  return rowCount;
};

export const releaseStuckSending = async () => {
  const {rowCount} = await query(
    `UPDATE stock_notifications
        SET status = 'pending', updated_at = now()
      WHERE status = 'sending' AND updated_at < now() - make_interval(mins => $1)`,
    [config.job.stuckSendingMinutes]
  );

  return rowCount;
};

/**
 * Apaga apenas os avisos já enviados (produto voltou ao estoque e o e-mail saiu)
 * há mais de RETENTION_DAYS dias. Pendentes, expirados, cancelados e com erro não são apagados.
 */
export const purgeSent = async () => {
  if (!config.job.retentionDays || config.job.retentionDays <= 0) return 0;

  const {rowCount} = await query(
    `DELETE FROM stock_notifications
      WHERE status = 'sent' AND sent_at < now() - make_interval(days => $1)`,
    [config.job.retentionDays]
  );

  return rowCount;
};

/** Lista site + SKU com inscrições pendentes. */
export const listPendingSkus = async () => {
  const {rows} = await query(
    `SELECT site_id, sku_id, count(*)::int AS subscribers
       FROM stock_notifications
      WHERE status = 'pending' AND expires_at > now()
      GROUP BY site_id, sku_id
      ORDER BY site_id, sku_id`
  );

  return rows;
};

/**
 * "Reserva" as inscrições pendentes de um SKU, mudando para "sending".
 * Só quem conseguiu a reserva envia, o que evita e-mail duplicado.
 */
export const claimPendingForSku = async (siteId, skuId) => {
  const {rows} = await query(
    `UPDATE stock_notifications
        SET status = 'sending', updated_at = now()
      WHERE site_id = $1 AND sku_id = $2 AND status = 'pending' AND expires_at > now()
      RETURNING *`,
    [siteId, skuId]
  );

  return rows;
};

export const markSent = async id => {
  await query(
    `UPDATE stock_notifications
        SET status = 'sent', sent_at = now(), updated_at = now(), last_error = NULL
      WHERE id = $1`,
    [id]
  );
};

export const markFailed = async (id, error) => {
  await query(
    `UPDATE stock_notifications
        SET attempts = attempts + 1,
            last_error = left($2, 1000),
            status = CASE WHEN attempts + 1 >= $3 THEN 'error' ELSE 'pending' END,
            updated_at = now()
      WHERE id = $1`,
    [id, String(error?.message || error), config.job.maxSendAttempts]
  );
};

export const listNotifications = async ({status, skuId, email, limit = 100}) => {
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (skuId) {
    params.push(skuId);
    conditions.push(`sku_id = $${params.length}`);
  }

  if (email) {
    params.push(email.toLowerCase());
    conditions.push(`lower(email) = $${params.length}`);
  }

  params.push(Math.min(Number(limit) || 100, 500));

  const {rows} = await query(
    `SELECT id, site_id, product_id, sku_id, email, profile_id, organization_id, product_name, status,
            attempts, last_error, created_at, expires_at, sent_at
       FROM stock_notifications
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );

  return rows;
};

export const getStats = async () => {
  const {rows} = await query(
    `SELECT status, count(*)::int AS total FROM stock_notifications GROUP BY status ORDER BY status`
  );

  return Object.fromEntries(rows.map(row => [row.status, row.total]));
};
