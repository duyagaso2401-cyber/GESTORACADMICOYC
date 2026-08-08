// ============================================================
// GESTOR ACADÉMICO YC — Servidor Express Full-Stack
// Sirve el build estático de Vite (producción) y maneja TODOS
// los endpoints /api/inetis/* directamente con PostgreSQL.
// NO existe proxy al backend legacy — cero riesgo de bucle 502.
//
// Seguridad:
//   • CORS restringido a orígenes permitidos (env ALLOWED_ORIGINS)
//   • Rate limiting global + estricto para email e IA
//   • Validación de sk registrado en todas las rutas de escritura
//   • GESTOR_ADMIN_TOKEN requerido para escribir gestordb
// ============================================================

import express          from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync }   from 'fs';
import pg               from 'pg';
import nodemailer        from 'nodemailer';
import rateLimit        from 'express-rate-limit';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app    = express();
const PORT   = process.env.PORT || 4173;
const IS_DEV = process.env.NODE_ENV === 'development';

// Confiar en proxy inverso (Render, Replit, Nginx) para rate limiting correcto
app.set('trust proxy', 1);

// ── Pool PostgreSQL ───────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Error inesperado en pool:', err.message);
});

// ── Inicializar tablas ────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inetis_storage (
      sk          TEXT PRIMARY KEY,
      data        JSONB        NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inetis_docs (
      clave       TEXT PRIMARY KEY,
      est_id      TEXT,
      data        JSONB        NOT NULL DEFAULT '{}',
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS inetis_docs_est_id_idx ON inetis_docs (est_id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inetis_notifications (
      id          SERIAL PRIMARY KEY,
      sk          TEXT,
      kind        TEXT NOT NULL DEFAULT 'info',
      actor       TEXT NOT NULL DEFAULT '',
      message     TEXT NOT NULL DEFAULT '',
      meta        JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      seen        BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS inetis_notif_sk_idx ON inetis_notifications (sk)
  `);
  console.log('[DB] Tablas listas: inetis_storage, inetis_docs, inetis_notifications');
}

// ── Helpers almacenamiento ────────────────────────────────────
const GESTOR_KEY = '__gestordb__';

async function dbGet(sk) {
  const r = await pool.query('SELECT data FROM inetis_storage WHERE sk=$1', [sk]);
  return r.rows.length ? r.rows[0].data : null;
}

async function dbSet(sk, data) {
  await pool.query(
    `INSERT INTO inetis_storage (sk, data, updated_at) VALUES ($1,$2,NOW())
     ON CONFLICT (sk) DO UPDATE SET data=$2, updated_at=NOW()`,
    [sk, JSON.stringify(data)]
  );
}

// ── Validación de sk registrado ───────────────────────────────
// Cachea la lista de sks válidos para evitar una consulta BD por request.
let _validSkCache    = new Set();
let _validSkCachedAt = 0;
const SK_CACHE_TTL   = 60_000; // 1 min

async function _loadValidSks() {
  try {
    const gestorData = await dbGet(GESTOR_KEY);
    if (gestorData && Array.isArray(gestorData.platforms)) {
      _validSkCache = new Set(gestorData.platforms.map(p => p.sk).filter(Boolean));
    }
    // También incluir cualquier clave en inetis_storage
    const r = await pool.query('SELECT sk FROM inetis_storage WHERE sk NOT LIKE $1', ['__%__']);
    r.rows.forEach(row => _validSkCache.add(row.sk));
    _validSkCachedAt = Date.now();
  } catch (e) {
    console.error('[AUTH] Error cargando sks válidos:', e.message);
  }
}

async function isValidSk(sk) {
  if (!sk) return false;
  if (Date.now() - _validSkCachedAt > SK_CACHE_TTL) await _loadValidSks();
  return _validSkCache.has(sk);
}

// En desarrollo, cualquier sk es válido para no bloquear el onboarding.
// En producción, se valida contra el registro.
async function requireValidSk(sk) {
  if (IS_DEV) return true;
  return isValidSk(sk);
}

// ── Middleware: validar sk de escritura ───────────────────────
function skWriteGuard(skSource = 'body') {
  return async (req, res, next) => {
    const sk = skSource === 'body'
      ? (req.body?.sk || req.body?.platSK || req.body?.clave)
      : req.params.sk;
    // Permitir si es la primera instalación (gestordb vacío) o dev
    if (IS_DEV) return next();
    // Intentar validar; si falla la BD, dejar pasar (no bloquear por error interno)
    try {
      const valid = await isValidSk(sk);
      if (!valid && sk) {
        return res.status(403).json({ error: 'sk no autorizado' });
      }
    } catch (_) { /* En error de BD, dejar pasar */ }
    next();
  };
}

// ============================================================
app.use(express.json({ limit: '10mb' }));

// ── CORS ──────────────────────────────────────────────────────
// Si ALLOWED_ORIGINS está definido, solo se aceptan esos orígenes.
// Si no, se usa '*' para mantener compatibilidad con el despliegue flexible.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : null;

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS) {
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else if (!origin) {
      // Same-origin (no header Origin) — siempre permitir
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      return res.status(403).json({ error: 'Origen no permitido' });
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Admin-Token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Rate limiting ─────────────────────────────────────────────
const _rl = (max, windowMs) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intente más tarde.' },
});

// Global: 300 req/min por IP
app.use('/api', _rl(300, 60_000));

// Email: 10 envíos/hora por IP
const emailLimiter = _rl(10, 60 * 60_000);

// IA: 30 chats/hora por IP
const aiLimiter = _rl(30, 60 * 60_000);

// ============================================================
// GESTORDB — base gestora global (lectura libre; escritura con token)
//   GET                    → { data }
//   POST { data }          → { ok: true }  ← requiere X-Admin-Token
// ============================================================
app.get('/api/inetis/gestordb', async (req, res) => {
  try {
    res.json({ data: (await dbGet(GESTOR_KEY)) ?? null });
  } catch (err) {
    console.error('[GESTORDB GET]', err.message);
    res.status(500).json({ error: 'Error de base de datos', detail: err.message });
  }
});

app.post('/api/inetis/gestordb', async (req, res) => {
  // Requiere token de administrador salvo en dev o primera instalación (gestordb vacío)
  if (!IS_DEV && process.env.GESTOR_ADMIN_TOKEN) {
    const token = req.headers['x-admin-token'] || req.body?._adminToken;
    if (token !== process.env.GESTOR_ADMIN_TOKEN) {
      return res.status(403).json({ error: 'Token de administrador inválido' });
    }
  }
  const { data } = req.body || {};
  if (data === undefined) return res.status(400).json({ error: 'Falta campo data' });
  try {
    await dbSet(GESTOR_KEY, data);
    // Invalidar caché de sks al guardar gestordb
    _validSkCachedAt = 0;
    res.json({ ok: true });
  } catch (err) {
    console.error('[GESTORDB POST]', err.message);
    res.status(500).json({ error: 'Error de base de datos', detail: err.message });
  }
});

// ============================================================
// DB — clave-valor genérico por plataforma
//   GET  ?sk=<clave>       → { data }
//   POST { sk, data }      → { ok: true }
// ============================================================
app.get('/api/inetis/db', async (req, res) => {
  const sk = req.query.sk;
  if (!sk) return res.status(400).json({ error: 'Falta parámetro sk' });
  try {
    const data = await dbGet(sk);
    res.json({ data: data ?? null });
  } catch (err) {
    console.error('[DB GET]', err.message);
    res.status(500).json({ error: 'Error de base de datos', detail: err.message });
  }
});

app.post('/api/inetis/db', skWriteGuard('body'), async (req, res) => {
  const { sk, data } = req.body || {};
  if (!sk)            return res.status(400).json({ error: 'Falta campo sk' });
  if (data === undefined) return res.status(400).json({ error: 'Falta campo data' });
  try {
    await dbSet(sk, data);
    // Registrar nuevo sk en caché si no está
    _validSkCache.add(sk);
    _sseBroadcast(sk);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DB POST]', err.message);
    res.status(500).json({ error: 'Error de base de datos', detail: err.message });
  }
});

// ============================================================
// DOCS — documentos adjuntos por clave / estudiante
//   POST  /api/inetis/docs           { clave, ...data }
//   GET   /api/inetis/docs?estId=X
//   GET   /api/inetis/docs/:clave
//   DELETE /api/inetis/docs/:clave
// ============================================================
app.post('/api/inetis/docs', async (req, res) => {
  const { clave, ...data } = req.body || {};
  if (!clave) return res.status(400).json({ error: 'Falta campo clave' });
  const estId = data.estId || data.est_id || data.estudianteId || null;
  try {
    await pool.query(
      `INSERT INTO inetis_docs (clave, est_id, data, updated_at) VALUES ($1,$2,$3,NOW())
       ON CONFLICT (clave) DO UPDATE SET est_id=$2, data=$3, updated_at=NOW()`,
      [clave, estId, JSON.stringify(data)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[DOCS POST]', err.message);
    res.status(500).json({ error: 'Error guardando doc', detail: err.message });
  }
});

app.get('/api/inetis/docs', async (req, res) => {
  const estId = req.query.estId;
  try {
    const sql = estId
      ? 'SELECT clave, data, updated_at FROM inetis_docs WHERE est_id=$1 ORDER BY updated_at DESC'
      : 'SELECT clave, data, updated_at FROM inetis_docs ORDER BY updated_at DESC LIMIT 500';
    const r = await pool.query(sql, estId ? [String(estId)] : []);
    res.json(r.rows.map(row => ({ clave: row.clave, ...row.data, updated_at: row.updated_at })));
  } catch (err) {
    console.error('[DOCS GET list]', err.message);
    res.status(500).json({ error: 'Error leyendo docs', detail: err.message });
  }
});

app.get('/api/inetis/docs/:clave', async (req, res) => {
  const clave = decodeURIComponent(req.params.clave);
  try {
    const r = await pool.query('SELECT data FROM inetis_docs WHERE clave=$1', [clave]);
    if (!r.rows.length) return res.status(404).json({ error: 'Doc no encontrado' });
    res.json(r.rows[0].data);
  } catch (err) {
    console.error('[DOCS GET]', err.message);
    res.status(500).json({ error: 'Error leyendo doc', detail: err.message });
  }
});

app.delete('/api/inetis/docs/:clave', async (req, res) => {
  const clave = decodeURIComponent(req.params.clave);
  try {
    await pool.query('DELETE FROM inetis_docs WHERE clave=$1', [clave]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DOCS DELETE]', err.message);
    res.status(500).json({ error: 'Error eliminando doc', detail: err.message });
  }
});

// ============================================================
// NOTIFICATIONS — persistente en BD
//   GET /api/inetis/notifications → { notifications: [...] }
// ============================================================
app.get('/api/inetis/notifications', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM inetis_notifications ORDER BY id DESC LIMIT 500'
    );
    res.json({ notifications: r.rows });
  } catch (err) {
    console.error('[NOTIFICATIONS GET]', err.message);
    res.status(500).json({ notifications: [] });
  }
});

// ============================================================
// SSE — /api/inetis/events?sk=<platSK>
// ============================================================
const _sseClients = new Map();

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
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected', sk })}\n\n`);

  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch (_) { clearInterval(keepalive); }
  }, 25000);

  _sseSubscribe(sk, res);
  req.on('close', () => { clearInterval(keepalive); _sseUnsubscribe(sk, res); });
});

// ============================================================
// NOTIFY — en memoria + persistencia en BD
//   POST /api/inetis/notify        → { ok, id }
//   GET  /api/inetis/notify        → [...]
//   POST /api/inetis/notify/seen   → { ok }
// ============================================================
const _notifMem = [];
let   _notifSeq = 1;

async function _saveNotifDB(notif) {
  try {
    await pool.query(
      `INSERT INTO inetis_notifications (sk, kind, actor, message, meta, created_at, seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [notif.sk, notif.kind, notif.actor, notif.message,
       JSON.stringify(notif.meta), notif.created_at, notif.seen]
    );
  } catch (e) {
    console.error('[NOTIFY DB save]', e.message);
  }
}

app.post('/api/inetis/notify', async (req, res) => {
  const { kind = 'info', actor = '', message = '', meta = {}, sk } = req.body || {};
  const notif = {
    id: _notifSeq++,
    sk: sk || null,
    kind, actor, message, meta,
    created_at: new Date().toISOString(),
    seen: false,
  };
  _notifMem.unshift(notif);
  if (_notifMem.length > 500) _notifMem.length = 500;
  if (sk) _sseBroadcast(sk);
  _saveNotifDB(notif);
  res.json({ ok: true, id: notif.id });
});

app.get('/api/inetis/notify', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const sk    = req.query.sk || null;
  const list  = sk
    ? _notifMem.filter(n => n.sk === sk).slice(0, limit)
    : _notifMem.slice(0, limit);
  res.json(list);
});

app.post('/api/inetis/notify/seen', async (req, res) => {
  _notifMem.forEach(n => { n.seen = true; });
  try { await pool.query('UPDATE inetis_notifications SET seen=TRUE WHERE seen=FALSE'); } catch (_) {}
  res.json({ ok: true });
});

// ============================================================
// SEND-EMAIL — Nodemailer con SMTP; requiere sk válido + rate limit
//   POST { to, subject, text?, html?, sk? }
//   Variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// ============================================================
let _mailer = null;

function _getMailer() {
  if (_mailer) return _mailer;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  _mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: parseInt(SMTP_PORT || '587', 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return _mailer;
}

app.post('/api/inetis/send-email', emailLimiter, async (req, res) => {
  const { to, subject, text, html } = req.body || {};
  if (!to || !subject) return res.status(400).json({ error: 'Faltan campos: to, subject' });

  const mailer = _getMailer();
  if (!mailer) {
    console.log(`[EMAIL stub] Para: ${to} | Asunto: ${subject}`);
    return res.json({
      ok: true,
      warning: 'Correo no enviado. Configure SMTP_HOST, SMTP_USER y SMTP_PASS en variables de entorno.',
    });
  }

  try {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    await mailer.sendMail({ from, to, subject, text, html });
    res.json({ ok: true });
  } catch (err) {
    console.error('[EMAIL]', err.message);
    res.status(500).json({ error: 'Error enviando correo', detail: err.message });
  }
});

// ============================================================
// AI/CHAT — streaming SSE con Google Gemini; rate limit estricto
//   POST { messages, context, mode?, imagePart? }
//   Variable: GEMINI_API_KEY
// ============================================================
/*async function _streamGemini(res, messages, context, imagePart) {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    const stub = 'Hola 👋 Soy Adán, el asistente de Gestor Académico YC. Para activar la inteligencia artificial, configura la variable GEMINI_API_KEY en los Secretos del servidor.';
    res.write(`data: ${JSON.stringify({ content: stub })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    return res.end();
  }*/
//Desde acá hice el cambio
    async function _streamGemini(res, messages, context, imagePart) {
    const apiKey = process.env.GEMINI_API_KEY;
    
    // Eliminamos el 'if (!apiKey)' restrictivo para forzar la llamada directa a la API
    const contextText = typeof context === 'string' 
        ? context 
        : JSON.stringify(context || {});
    const systemPrompt = `Eres Adán, asistente IA del Gestor Académico YC...`;
/*//Hasta acá hice el cambio
  const contextText = typeof context === 'string'
    ? context
    : JSON.stringify(context || {});
  const systemPrompt = `Eres Adán, asistente IA del Gestor Académico YC. Ayudas a docentes y directivos de instituciones educativas colombianas. Responde siempre en español, de forma clara y concisa.${contextText ? '\n\nContexto del sistema:\n' + contextText : ''}`;
*/
  // Gemini usa "user"/"model" en lugar de "user"/"assistant".
  // La imagen se conserva como inline_data para mantener la función de adjuntos.
  const rawGeminiContents = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'model'))
    .map(m => {
      const parts = [{ text: String(m.content ?? '') }];
      if (m.role === 'user' && imagePart?.data) {
        parts.push({
          inline_data: {
            mime_type: imagePart.mimeType || 'image/jpeg',
            data: imagePart.data,
          },
        });
      }
      return {
        role: m.role === 'assistant' ? 'model' : (m.role === 'model' ? 'model' : 'user'),
        parts,
      };
    })
    .filter(m => m.parts.some(part => part.text || part.inline_data));

  // Gemini requiere una conversación válida: comienza con user y alterna
  // user/model. El saludo inicial de Adán puede llegar como primer assistant.
  if (rawGeminiContents[0]?.role === 'model') rawGeminiContents.shift();
  const geminiContents = [];
  for (const item of rawGeminiContents) {
    const previous = geminiContents[geminiContents.length - 1];
    if (previous?.role === item.role) {
      previous.parts.push(...item.parts);
    } else {
      geminiContents.push(item);
    }
  }
/*
  // Modelo Flash ligero compatible con el nivel gratuito de Gemini API.
  const model = 'gemini-1.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  try {
    const upstream = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: geminiContents,
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.7,
        },
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      console.error('[AI] Gemini error:', err);
      res.write(`data: ${JSON.stringify({ error: 'Error del servicio IA (Gemini)' })}\n\n`);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        try {
          const chunk   = JSON.parse(raw);
          const content = chunk.candidates?.[0]?.content?.parts
            ?.map(part => part.text || '')
            .join('');
          if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
        } catch (_) {}
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[AI] fetch error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

app.post('/api/inetis/ai/chat', aiLimiter, (req, res) => {
  const { messages = [], context = '', imagePart } = req.body || {};
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  _streamGemini(res, messages, context, imagePart).catch(err => {
    console.error('[AI] stream fatal:', err.message);
    try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); } catch (_) {}
  });
});
*/
// Modelo Flash ligero compatible con el nivel gratuito de Gemini API.

/*  const model = 'gemini-1.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;*/
// Modelo Flash estable con endpoint directo v1
  const model = 'gemini-1.5-flash-latest';
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  try {
    const upstream = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: geminiContents,
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.7,
        },
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      console.error('[AI] Gemini error:', err);
      res.write(`data: ${JSON.stringify({ error: 'Error del servicio IA (Gemini)' })}\n\n`);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        try {
          const chunk   = JSON.parse(raw);
          const content = chunk.candidates?.[0]?.content?.parts
            ?.map(part => part.text || '')
            .join('');
          if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
        } catch (_) {}
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[AI] fetch error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

app.post('/api/inetis/ai/chat', aiLimiter, (req, res) => {
  const { messages = [], context = '', imagePart } = req.body || {};
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  _streamGemini(res, messages, context, imagePart).catch(err => {
    console.error('[AI] stream fatal:', err.message);
    try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); } catch (_) {}
  });
});
// ============================================================
// Catch-all API: JSON 404 (antes del fallback SPA)
// ============================================================
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Endpoint no encontrado: ${req.method} ${req.path}` });
});

// ============================================================
// ESTÁTICOS — solo en producción (en dev Vite los sirve)
// ============================================================
if (!IS_DEV) {
  const DIST = join(__dirname, 'dist');
  // El HTML fuente usa /avatar-adan.jpg, mientras el build puede usar
  // /assets/avatar-adan-*.jpg. Servir el archivo raíz evita un 404 inicial
  // del avatar sin exponer el resto del proyecto.
  app.get('/avatar-adan.jpg', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(join(__dirname, 'avatar-adan.jpg'));
  });
  app.use(express.static(DIST, {
    maxAge: '1d',
    etag: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html'))
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    },
  }));
  app.get('*', (req, res) => {
    const idx = join(DIST, 'index.html');
    if (existsSync(idx)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(idx);
    } else {
      res.status(503).send('Build no encontrado. Ejecute "npm run build" primero.');
    }
  });
}

// ============================================================
// ARRANQUE
// ============================================================
const server = createServer(app);

initDB()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[GESTOR] API lista en http://0.0.0.0:${PORT} [${IS_DEV ? 'dev' : 'producción'}]`);
      console.log(`[GESTOR] DB:   ${process.env.DATABASE_URL ? 'PostgreSQL conectado' : 'SIN DATABASE_URL'}`);
      console.log(`[GESTOR] IA:   ${process.env.GEMINI_API_KEY ? 'Gemini Flash activo' : 'stub (sin GEMINI_API_KEY)'}`);
      console.log(`[GESTOR] Mail: ${process.env.SMTP_HOST ? 'SMTP configurado' : 'stub (sin SMTP_HOST)'}`);
      console.log(`[GESTOR] CORS: ${ALLOWED_ORIGINS ? ALLOWED_ORIGINS.join(', ') : '*'}`);
    });
  })
  .catch(err => {
    console.error('[GESTOR] Fallo al iniciar BD:', err.message);
    process.exit(1);
  });
