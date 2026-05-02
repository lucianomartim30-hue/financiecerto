'use strict';

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const chatHandler = require('./api/chat');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Rate limit ────────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  message: { error: 'Muitas mensagens. Aguarde um momento.' }
});

// ── Rota do chatbot ───────────────────────────────────────────────────────────
app.post('/api/chat', limiter, chatHandler);

// ── Fallback: serve o index.html para qualquer rota ──────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FinancieCerto rodando em http://localhost:${PORT}`);
});
