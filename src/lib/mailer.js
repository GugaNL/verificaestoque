import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import nodemailer from 'nodemailer';
import {config} from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = fs.readFileSync(path.resolve(__dirname, '..', 'templates', 'back-in-stock.html'), 'utf8');

const escapeHtml = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Substitui {{chave}} pelos valores. Chaves terminadas em "Html" entram sem escape (HTML montado aqui no código);
 * todas as outras são escapadas.
 */
export const renderTemplate = (template, vars) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => (key.endsWith('Html') ? vars[key] ?? '' : escapeHtml(vars[key])));

let transporter;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? {user: config.mail.user, pass: config.mail.pass} : undefined
    });
  }

  return transporter;
};

export const verifyMailer = () => getTransporter().verify();

export const buildBackInStockEmail = notification => {
  const productName = notification.product_name || 'Produto';
  const productUrl = notification.product_url || config.store.baseUrl;
  const unsubscribeUrl = `${config.publicBaseUrl}/v1/notify-me/unsubscribe?token=${encodeURIComponent(
    notification.unsubscribe_token
  )}`;

  const productImageHtml = notification.product_image
    ? `<td width="140" valign="middle" style="padding: 20px; text-align: center;"><a href="${escapeHtml(
        productUrl
      )}"><img src="${escapeHtml(notification.product_image)}" alt="${escapeHtml(
        productName
      )}" width="120" style="display: block; width: 120px; max-width: 120px; height: auto; border: none;" /></a></td>`
    : '';

  const vars = {
    subject: config.mail.subject,
    brandName: config.mail.brandName,
    productName,
    productUrl,
    productImageHtml,
    unsubscribeUrl,
    year: new Date().getFullYear()
  };

  const html = renderTemplate(TEMPLATE, vars);

  const text = [
    'Olá!',
    '',
    'Você pediu para ser avisado quando este produto estivesse disponível novamente. Ele já está de volta.',
    '',
    productName,
    `Comprar agora: ${productUrl}`,
    '',
    `Você recebeu este e-mail porque se inscreveu para ser avisado na ${config.mail.brandName}. Este é um aviso único.`,
    `Não quero mais receber: ${unsubscribeUrl}`
  ].join('\n');

  return {subject: config.mail.subject, html, text, unsubscribeUrl};
};

export const sendBackInStockEmail = async notification => {
  const {subject, html, text, unsubscribeUrl} = buildBackInStockEmail(notification);

  return getTransporter().sendMail({
    from: config.mail.from,
    to: notification.email,
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`
    }
  });
};
