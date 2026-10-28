import {config} from '../config.js';

export class OccError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'OccError';
    this.status = status;
    this.body = body;
  }
}

const absoluteUrl = value => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  return `${config.store.baseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
};

const storeFetch = async (pathWithQuery, {token, siteId, organizationId} = {}) => {
  const headers = {
    Accept: 'application/json',
    'x-ccasset-language': config.store.assetLanguage
  };

  if (siteId) headers['x-ccsite'] = siteId;
  if (organizationId) headers['x-ccorganization'] = organizationId;
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.store.requestTimeoutMs);

  try {
    const response = await fetch(`${config.store.baseUrl}${pathWithQuery}`, {headers, signal: controller.signal});
    const text = await response.text();
    let body = null;

    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!response.ok) {
      throw new OccError(`OCC ${pathWithQuery} respondeu ${response.status}`, response.status, body);
    }

    return body;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Valida o token do cliente logado na loja e retorna o perfil.
 * Se o token for inválido/expirado, o OCC responde 401 e lançamos OccError.
 */
export const getCurrentProfile = async ({token, siteId, organizationId}) => {
  const profile = await storeFetch('/ccstore/v1/profiles/current?fields=id,email,firstName', {
    token,
    siteId,
    organizationId
  });

  if (!profile || !profile.id || profile.id === 'anonymous') {
    throw new OccError('Perfil não autenticado', 401, profile);
  }

  return {id: profile.id, email: profile.email || null, firstName: profile.firstName || null};
};

/**
 * Busca nome, URL e imagem do produto para montar o e-mail.
 * Usa o token do cliente (mesmo contexto de catálogo/preço da loja).
 * Se falhar, retorna null: a inscrição segue sem esses dados.
 */
export const getProductDetails = async ({productId, skuId, token, siteId, organizationId}) => {
  const params = new URLSearchParams({
    fields: 'id,displayName,route,primaryMediumImageURL,primaryFullImageURL,primarySmallImageURL'
  });

  if (config.store.catalogId) params.set('catalogId', config.store.catalogId);

  const product = await storeFetch(`/ccstore/v1/products/${encodeURIComponent(productId)}?${params}`, {
    token,
    siteId,
    organizationId
  });

  if (!product) return null;

  let url = absoluteUrl(product.route);
  if (url && skuId) url += `${url.includes('?') ? '&' : '?'}skuId=${encodeURIComponent(skuId)}`;

  return {
    name: product.displayName || null,
    url,
    image: absoluteUrl(product.primaryMediumImageURL || product.primaryFullImageURL || product.primarySmallImageURL)
  };
};

/**
 * Consulta o estoque de vários SKUs (Store API: GET /ccstore/v1/inventories?ids=...).
 * Retorna um Map skuId -> quantidade em estoque.
 */
export const getStockLevels = async ({skuIds, siteId}) => {
  const params = new URLSearchParams({ids: skuIds.join(',')});
  const body = await storeFetch(`/ccstore/v1/inventories?${params}`, {siteId});
  const items = Array.isArray(body?.items) ? body.items : [];
  const levels = new Map();

  for (const item of items) {
    const skuId = item.skuId || item.id || item.repositoryId;
    if (!skuId) continue;

    const level = Number(item.stockLevel ?? item.orderableQuantity ?? 0);
    levels.set(skuId, Number.isFinite(level) ? level : 0);
  }

  return levels;
};
