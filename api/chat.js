/**
 * FinancieCerto — Serverless Function para Vercel
 * Arquivo: api/chat.js
 * Provedor: Google Gemini (GRATUITO)
 *
 * Chave gratuita: https://aistudio.google.com/apikey
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── System Prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
Você é o Assistente de Financiamento do FinancieCerto, plataforma educativa especializada em financiamento imobiliário no Brasil.

IDENTIDADE E TOM:
- Fale como um corretor imobiliário experiente e didático explicando para compradores de primeira viagem.
- Linguagem simples, acolhedora, direta. Evite jargão sem explicação.
- Respostas curtas: máximo 3 parágrafos. Se a resposta precisar ser longa, use tópicos curtos.
- Se a pergunta for vaga, faça UMA pergunta de clarificação antes de responder.
- Sempre em português do Brasil.

DOMÍNIO DE CONHECIMENTO:
- MCMV (Minha Casa Minha Vida): Faixas 1 a 4, subsídios, taxas, tetos, LTV
- SBPE/SFH: Financiamento bancário convencional
- Crédito Associativo: Imóveis na planta financiados pela CAIXA
- Fase de obra: Juros evolutivos (RAE), encargos mensais, evolução do saldo
- INCC: Correção dos boletos pagos à incorporadora durante a obra
- FGTS: Regras de uso, prazo carência, uso do cônjuge
- Seguros MIP e DFI: Cobertura, cobrança, impacto no encargo
- Documentação: Por tipo de comprador (CLT, autônomo, MEI)
- Custos: ITBI, cartório, registro, avaliação
- SAC vs Tabela Price: Diferenças práticas, quando usar cada um
- TR: Impacto no saldo devedor
- Análise de crédito: Score, Cadmut, Caehis, restrições, pré-análise

DADOS DE REFERÊNCIA (2026):
- Faixa 1 MCMV: renda até R$ 3.200 · taxa 4–5% a.a. + TR · subsídio até R$ 55.000 · LTV até 95%
- Faixa 2 MCMV: renda até R$ 5.000 · taxa 4,75–7% a.a. + TR · subsídio até R$ 29.000 · LTV até 90%
- Faixa 3 MCMV: renda até R$ 9.600 · taxa 7,66–8,16% a.a. + TR · sem subsídio · LTV até 80%
- Faixa 4 MCMV: renda até R$ 13.000 · taxa até 10,5% a.a. + TR · sem subsídio · LTV até 80%
- SBPE 2026: 12–14,5% a.a. + TR
- Limite SFH: imóvel até R$ 2.250.000
- TR 2026: ~0,17% ao mês (variável)
- ITBI: 2–3% (varia por município) · Cartório + Registro: 0,5–1,5%

REGRAS ABSOLUTAS:
1. NUNCA invente taxas ou regras de bancos específicos além das referências acima.
2. Quando incerto, diga: "Para sua situação específica, confirme com a CAIXA ou correspondente bancário."
3. Nunca finjas ser humano. Diga que é um assistente automatizado quando perguntado.
4. Se a pergunta for fora do tema, recuse gentilmente.
5. Quando cabível, sugira usar o Simulador do site para os números específicos do usuário.
`.trim();

// ── Sanitização ───────────────────────────────────────────────────────────────
function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, 500).replace(/<[^>]*>/g, '');
}

function buildGeminiHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-18)
    .filter(m => m && ['user','assistant'].includes(m.role) && typeof m.content === 'string')
    .map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content.slice(0, 500) }]
    }));
}

// ── Rate limiting simples ─────────────────────────────────────────────────────
const ipCounts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = ipCounts.get(ip) || { count: 0, reset: now + 60_000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60_000; }
  entry.count++;
  ipCounts.set(ip, entry);
  return entry.count <= 20;
}

// ── Handler principal ─────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Método não permitido.' });

  const ip = req.headers['x-forwarded-for'] || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Muitas mensagens. Aguarde um momento.' });
  }

  try {
    const { message, history } = req.body || {};
    const cleanMsg   = sanitizeInput(message);
    const geminiHist = buildGeminiHistory(history);

    if (!cleanMsg) return res.status(400).json({ error: 'Mensagem inválida.' });

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    const chat = model.startChat({
      history: geminiHist,
      generationConfig: { maxOutputTokens: 600, temperature: 0.7 },
    });

    const result = await chat.sendMessage(cleanMsg);
    const replyText = result.response.text();

    return res.status(200).json({ reply: replyText });

  } catch (err) {
    console.error('[api/chat] Erro:', err?.message);

    if (err?.message?.includes('API_KEY')) {
      return res.status(500).json({ error: 'Chave de API inválida.' });
    }
    if (err?.message?.includes('quota') || err?.status === 429) {
      return res.status(429).json({ error: 'Limite diário do Gemini atingido. Tente amanhã.' });
    }

    return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
};
