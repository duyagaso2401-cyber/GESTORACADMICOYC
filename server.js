// ============================================================
// GESTOR ACADÉMICO YC — Servidor Express Full-Stack
// Sirve el build estático de Vite y añade los endpoints de API
// que el frontend necesita pero que el backend legacy no tiene:
//   • GET  /api/inetis/events        → SSE tiempo real
//   • POST /api/inetis/notify        → registrar notificación
//   • GET  /api/inetis/notify        → listar notificaciones
//   • POST /api/inetis/notify/seen   → marcar leídas
// Todos los demás /api/inetis/* se proxean al backend Neon.
// ============================================================

import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createReadStream, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 4173;

// URL del backend legacy con los endpoints /gestordb y /db
const LEGACY_BACKEND = 'https://gestoracadmicoyc.onrender.com';

app.use(express.json({ limit: '2mb' }));

// ── CORS permisivo (misma política que el backend legacy) ────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ============================================================
// SSE — /api/inetis/events?sk=<platSK>
// Mantiene una conexión abierta por cliente. Cuando se recibe
// un POST a /api/inetis/notify, difunde un evento "change" a
// todos los clientes suscritos al mismo sk.
// ============================================================
const _sseClients = new Map(); // sk → Set<res>

function _sseSubscribe(sk, res) {
  if (!_sseClients.has(sk)) _sseClients.set(sk, new Set());
  _sseClients.get(sk).add(res);
}
function _sseUnsubscribe(sk, res) {
  const set = _sseClients.get(sk);
  if (set) { set.delete(res); if (!set.size) _sseClients.delete(sk); }
}
function _sseBroadcast(sk) {
  const set = _sseClients.get(sk);
  if (!set || !set.size) return;
  const msg = `data: ${JSON.stringify({ type: 'change' })}\n\n`;
  for (const client of set) {
    try { client.write(msg); } catch (_) {}
  }
}

app.get('/api/inetis/events', (req, res) => {
  const sk = req.query.sk || 'default';
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx en Render
  res.flushHeaders();

  // Mensaje de bienvenida
  res.write(`data: ${JSON.stringify({ type: 'connected', sk })}\n\n`);

  // Keepalive cada 25 s para que Render no cierre la conexión idle
  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch (_) { clearInterval(keepalive); }
  }, 25000);

  _sseSubscribe(sk, res);

  req.on('close', () => {
    clearInterval(keepalive);
    _sseUnsubscribe(sk, res);
  });
});

// ============================================================
// NOTIFY — almacenamiento ligero en memoria con límite de 200
// (sin necesidad de tabla extra en Neon; se reinicia al hacer
//  deploy, lo cual es aceptable para notificaciones efímeras).
// ============================================================
const _notifications = []; // [ { id, sk, kind, actor, message, meta, created_at, seen } ]
let   _notifSeq = 1;

app.post('/api/inetis/notify', (req, res) => {
  const { kind = 'info', actor = '', message = '', meta = {}, sk } = req.body || {};
  const notif = {
    id: _notifSeq++,
    sk: sk || null,
    kind,
    actor,
    message,
    meta,
    created_at: new Date().toISOString(),
    seen: false,
  };
  _notifications.unshift(notif);
  if (_notifications.length > 200) _notifications.length = 200;

  // Difundir cambio a clientes SSE del mismo sk
  if (sk) _sseBroadcast(sk);

  res.json({ ok: true, id: notif.id });
});

app.get('/api/inetis/notify', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const sk    = req.query.sk || null;
  const list  = sk
    ? _notifications.filter(n => n.sk === sk).slice(0, limit)
    : _notifications.slice(0, limit);
  res.json(list);
});

app.post('/api/inetis/notify/seen', (req, res) => {
  _notifications.forEach(n => { n.seen = true; });
  res.json({ ok: true });
});

// ============================================================
// PROXY — resto de /api/inetis/* → backend legacy (Neon)
// ============================================================
app.use('/api/inetis', async (req, res) => {
  const targetURL = `${LEGACY_BACKEND}${req.originalUrl}`;
  try {
    const init = {
      method:  req.method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = JSON.stringify(req.body);
    }
    const upstream = await fetch(targetURL, init);
    const text = await upstream.text();
    res
      .status(upstream.status)
      .setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
      .send(text);
  } catch (err) {
    console.error('[PROXY] Error al contactar backend:', err.message);
    res.status(502).json({ error: 'Backend no disponible', detail: err.message });
  }
});

// ============================================================
// ESTÁTICOS — sirve el build de Vite (dist/)
// ============================================================
const DIST = join(__dirname, 'dist');

app.use(express.static(DIST, {
  maxAge: '1d',
  etag: true,
  setHeaders(res, filePath) {
    // No cachear HTML para que el browser siempre reciba la última versión
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// SPA fallback — cualquier ruta no-API devuelve index.html
app.get('*', (req, res) => {
  const idx = join(DIST, 'index.html');
  if (existsSync(idx)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(idx);
  } else {
    res.status(503).send('Build no encontrado. Ejecute "npm run build" primero.');
  }
});

// ============================================================
// ARRANQUE
// ============================================================
const server = createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[GESTOR] Servidor listo en http://0.0.0.0:${PORT}`);
  console.log(`[GESTOR] Proxy backend: ${LEGACY_BACKEND}`);
});
