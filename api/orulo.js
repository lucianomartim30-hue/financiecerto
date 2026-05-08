/**
 * FinancieCerto — Proxy para API da Órulo v2
 * Arquivo: api/orulo.js
 *
 * Variáveis necessárias no Vercel:
 *   ORULO_CLIENT_ID
 *   ORULO_CLIENT_SECRET
 *
 * Endpoints expostos:
 *   GET /api/orulo?min_price=X&max_price=Y&page=1&city=São+Paulo&state=SP
 */

'use strict';

const ORULO_BASE = 'https://www.orulo.com.br';

// ── Cache de token em memória ─────────────────────────────────────────────────
let _tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  const now = Date.now();
  if (_tokenCache.token && now < _tokenCache.expiresAt) {
    return _tokenCache.token;
  }

  const clientId     = process.env.ORULO_CLIENT_ID;
  const clientSecret = process.env.ORULO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('ORULO_CLIENT_ID ou ORULO_CLIENT_SECRET não configurados no servidor.');
  }

  // Documentação Órulo v2: POST /oauth/token com body form-encoded
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    'client_credentials'
  });

  const resp = await fetch(`${ORULO_BASE}/oauth/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString()
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Órulo token error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const token = data.access_token;
  if (!token) throw new Error('Token não retornado pela Órulo.');

  // Cache por 20 horas (token Órulo válido por ~1 ano; renovamos bem antes)
  _tokenCache = { token, expiresAt: now + 20 * 60 * 60 * 1000 };
  return token;
}

// ── Buscar catálogo de empreendimentos ────────────────────────────────────────
async function fetchBuildings(token, { page = 1, minPrice, maxPrice, city, state }) {
  const qs = new URLSearchParams();
  qs.set('page',     String(page));
  qs.set('per_page', '50');

  // Filtros server-side suportados pela API v2
  if (minPrice) qs.set('min_price', String(minPrice));
  if (maxPrice) qs.set('max_price', String(maxPrice));
  if (state)    qs.set('state',     state);
  if (city)     qs.set('city',      city);

  const resp = await fetch(`${ORULO_BASE}/api/v2/buildings?${qs}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Órulo buildings error ${resp.status}: ${text.slice(0, 200)}`);
  }

  return resp.json();
}

// ── Normaliza um empreendimento para o formato do FinancieCerto ───────────────
// Baseado na estrutura real da API Órulo v2:
// { id, name, developer: { name }, address: { area, city, state },
//   min_price, min_bedrooms, max_bedrooms,
//   default_image: { "200x140": "...", "520x280": "..." },
//   orulo_url, sharing_url, status }
function normalizeBuilding(b) {
  const developer =
    (b.developer && b.developer.name) ||
    b.developer_name || '';

  const address = b.address || {};
  const neighborhood = address.area  || address.neighborhood || '';
  const city         = address.city  || '';
  const state        = address.state || '';

  // Foto: prefere 520x280, fallback 200x140
  const img = b.default_image || {};
  const photo = img['520x280'] || img['200x140'] || null;

  return {
    id:           String(b.id),
    name:         b.name || 'Empreendimento',
    developer,
    min_price:    b.min_price   ?? null,
    max_price:    b.max_price   ?? null,
    bedrooms_min: b.min_bedrooms ?? null,
    bedrooms_max: b.max_bedrooms ?? null,
    neighborhood,
    city,
    state,
    photo,
    sharing_url:  b.sharing_url  || null,
    orulo_url:    b.sharing_url || b.orulo_url || `${ORULO_BASE}/buildings/${b.id}`,
    status:       b.status      || '',
    updated_at:   b.updated_at  || null
  };
}

// ── Handler principal ─────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const {
      min_price,
      max_price,
      page  = '1',
      city,
      state
    } = req.query || {};

    const pageNum = Math.max(1, parseInt(page) || 1);

    const token = await getToken();
    const raw   = await fetchBuildings(token, {
      page:     pageNum,
      minPrice: min_price,
      maxPrice: max_price,
      city,
      state
    });

    // Estrutura de resposta Órulo v2: { buildings: [...], total, page, total_pages, results_limit_exceeded }
    const rawList = raw.buildings ?? raw.data ?? raw.results ?? [];
    const buildings = rawList.map(normalizeBuilding);

    return res.status(200).json({
      buildings,
      total:  raw.total       ?? buildings.length,
      page:   pageNum,
      pages:  raw.total_pages ?? raw.pages ?? 1,
      source: 'orulo'
    });

  } catch (err) {
    console.error('[api/orulo]', err.message);

    if (err.message.includes('não configurados')) {
      return res.status(500).json({ error: 'Integração Órulo não configurada no servidor.' });
    }
    if (err.message.includes('401') || err.message.includes('403')) {
      _tokenCache = { token: null, expiresAt: 0 }; // invalida cache
      return res.status(401).json({ error: 'Credenciais Órulo inválidas ou expiradas.' });
    }

    return res.status(500).json({ error: 'Erro ao buscar imóveis. Tente novamente.' });
  }
};
