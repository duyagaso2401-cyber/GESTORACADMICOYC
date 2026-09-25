// ============================================================
// GESTOR ACADÉMICO YC — API SERVER
// Express + Node.js | Puerto 8080
// ============================================================

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as Sentry from '@sentry/node';
import { db, kvStore, notifications, documents, pushSubscriptions } from './db/index.js';
import repositorioRouter from './routes/repositorio.js';
import lmsRouter from './routes/lms.js';
import { eq, desc, and, isNull, or } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import webpush from 'web-push';
import { uploadMemoria, subirBufferACloudinary, eliminarDeCloudinarySiAplica } from './lib/upload.js';
import { cloudinaryConfigurado } from './lib/cloudinary.js';

// ============================================================
// MONITOREO DE ERRORES (Sentry) — OPCIONAL.
// ------------------------------------------------------------------
// NOTA TÉCNICA: en un proyecto ESM como este, para que Sentry alcance
// a "instrumentar" automáticamente Express (y así medir el
// desempeño/tiempo de cada petición, no solo capturar errores) hace
// falta cargarlo con la bandera "--import" de Node ANTES que todo lo
// demás. Se intentó esa configuración, pero causó un conflicto con
// otro paquete (drizzle-orm) en este proyecto — así que se optó por
// esta forma más simple y segura: sacrifica esa medición de
// desempeño automática, pero la CAPTURA DE ERRORES (lo que
// realmente importa acá) funciona igual, gracias a
// Sentry.setupExpressErrorHandler() más abajo. Puede seguir viendo
// un aviso de advertencia ("express is not instrumented") en la
// terminal al iniciar — es inofensivo, solo informativo, y no
// afecta el monitoreo de errores en sí.
//
// Si SENTRY_DSN no está configurada en las variables de entorno, el
// SDK simplemente no hace nada (comportamiento oficial y
// documentado de Sentry) — así que es seguro dejarlo siempre
// llamado, sin condicionales alrededor: nadie nota la diferencia
// hasta que se agregue la clave.
//
// Para activarlo: cree una cuenta gratuita en https://sentry.io,
// cree un proyecto tipo "Node.js/Express", copie el DSN que le den
// (una URL larga que empieza con "https://...@...ingest.sentry.io/..."),
// y agréguela como SENTRY_DSN en su archivo .env y en Render.
// ============================================================
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  tracesSampleRate: 0.1, // 10% de las peticiones, para no consumir la cuota gratuita muy rápido
});

// ============================================================
// FIRMA DE DOCUMENTOS (boletines) — HMAC-SHA256 con una clave que
// solo existe en el servidor (DOC_SIGN_SECRET). El navegador nunca
// conoce esta clave, así que no puede generar códigos válidos por
// su cuenta: solo puede pedirle al servidor que firme un documento,
// y luego pedirle que verifique si un código corresponde exactamente
// a los datos actuales. Esto es lo que hace que el código no se
// pueda falsificar simplemente leyendo el código fuente de la app
// (algo que sí era posible con la versión anterior, calculada 100%
// en el navegador).
// ============================================================
const DOC_SIGN_SECRET = process.env.DOC_SIGN_SECRET || '';
function _jsonEstable(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(_jsonEstable).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _jsonEstable((obj as Record<string, unknown>)[k])).join(',') + '}';
}
function _firmarBlob(datos: unknown): string {
  return crypto.createHmac('sha256', DOC_SIGN_SECRET).update(_jsonEstable(datos)).digest('hex').slice(0, 16).toUpperCase();
}

// ============================================================
// NOTIFICACIONES PUSH (Web Push) — requiere VAPID_PUBLIC_KEY y
// VAPID_PRIVATE_KEY en el .env. Si no están configuradas, el envío
// de push simplemente se omite (no rompe el resto de la app).
// Generar un par nuevo con: npx web-push generate-vapid-keys
// ============================================================
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:soporte@gestoracademicoyc.com';
const PUSH_HABILITADO = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (PUSH_HABILITADO) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('⚠️ VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no configuradas: las notificaciones push están desactivadas.');
}

// Envía una notificación push a los dispositivos suscritos que correspondan
// a la institución (y, si aplica, al grado) del evento que la origina.
// Nunca lanza: un fallo aquí no debe afectar la respuesta HTTP normal.
async function enviarPushParaNotificacion(sk: string, kind: string, message: string, meta: any) {
  if (!PUSH_HABILITADO || !sk) return;
  try {
    let subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.sk, sk));
    if (!subs.length) return;
    if (meta && meta.estId) {
      const estId = String(meta.estId);
      subs = subs.filter(s => s.estId === estId);
    } else if (meta && meta.grado) {
      const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
      const data: any = rows[0]?.value || {};
      const estIdsDelGrado = new Set((data.ests || []).filter((e: any) => e.g === meta.grado).map((e: any) => String(e.id)));
      subs = subs.filter(s => s.estId && estIdsDelGrado.has(s.estId));
    }
    if (!subs.length) return;
    const payload = JSON.stringify({
      title: 'Gestor Académico YC',
      body: String(message || '').slice(0, 180),
      kind,
    });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription as any, payload);
      } catch (err: any) {
        // Suscripción vencida o inválida (el navegador la revocó): se limpia.
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        }
      }
    }));
  } catch (e) {
    console.error('enviarPushParaNotificacion', e);
  }
}

// ============================================================
// A01 · CONFIGURACIÓN EXPRESS, CORS Y MIDDLEWARE
// ============================================================

const app = express();
const PORT = parseInt(process.env.PORT || '8080');
const IS_PROD = process.env.NODE_ENV === 'production';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname, '../gestor-academico/dist');

// Configuración robusta de CORS para soportar Live Server, Replit y Render
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-gemini-api-key', 'x-gemini-key', 'x-api-key'],
  optionsSuccessStatus: 200
}));

// Compresión gzip de las respuestas — reduce el peso de cada respuesta JSON
// (el "db" completo de una institución, con cientos de estudiantes y sus
// notas, es texto muy repetitivo y comprime muy bien: normalmente 70-90%
// más liviano). Es la forma más segura y de menor riesgo de reducir el
// consumo de transferencia de red de Neon/Render: no cambia ningún dato ni
// lógica, solo cómo viaja por la red. threshold evita perder tiempo
// comprimiendo respuestas ya pequeñas (menos de 1 KB no vale la pena).
app.use(compression({ threshold: 1024 }));

app.use(express.json({ limit: '50mb' }));

// ============================================================
// LÍMITE DE PETICIONES (rate limiting) — protección contra fuerza
// bruta e intentos automatizados de descubrir credenciales.
// ------------------------------------------------------------------
// Contexto importante: en este sistema el login busca las
// credenciales trayendo los datos de la institución (con las
// contraseñas ya cifradas con PBKDF2, 100.000 iteraciones) y
// comparando en el navegador — así que un límite de peticiones aquí
// no sustituye tener contraseñas fuertes, pero sí frena de forma
// real los intentos automatizados: cada "intento de login" hace una
// petición nueva a esta ruta, así que limitar cuántas veces por
// minuto se puede consultar hace mucho más lento y detectable
// cualquier ataque con un script.
//
// Se usa un límite generoso a propósito (no bloquea el uso normal:
// entrar a varias instituciones seguidas, o la sincronización
// periódica de quien ya inició sesión), pero sí detiene un ataque
// automatizado que necesita cientos de intentos por minuto.
const limitadorLogin = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  limit: 30, // 30 consultas por minuto por IP — cómodo para uso normal, restrictivo para un ataque
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos en poco tiempo. Espere un momento y vuelva a intentar.' },
});
// Límite más amplio para el resto de la API (protección general contra abuso/DoS,
// sin restringir el uso normal del sistema).
const limitadorGeneral = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones en poco tiempo. Espere un momento.' },
});
app.use('/api/inetis/db', limitadorLogin);
app.use('/api/', limitadorGeneral);

// ============================================================
// A02 · HELPERS — IA (GEMINI), SSE Y UTILIDADES
// ============================================================

// ── Gemini ────────────────────────────────────────────────────────────────────

function getGeminiApiKey(req?: express.Request): string {
  if (req) {
    const bodyKey = (req.body && (req.body.apiKey || req.body.geminiApiKey || req.body.geminiKey)) as string;
    if (bodyKey && typeof bodyKey === 'string' && bodyKey.trim()) return bodyKey.trim();
    const headerKey = (req.headers['x-gemini-api-key'] || req.headers['x-gemini-key'] || req.headers['x-api-key']) as string;
    if (headerKey && typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();
    const authHeader = req.headers['authorization'] as string;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token.startsWith('AIza')) return token;
    }
  }
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

// Modelos activos y vigentes únicamente
const PRIMARY_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^models\//, '').trim();

const CANDIDATE_MODELS = [
    PRIMARY_MODEL,
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-3.6-flash',
    'gemini-3.7-flash',
].filter((model, index, self) => Boolean(model) && self.indexOf(model) === index);

function getGenAI(apiKeyParam?: string) {
  const apiKey = (apiKeyParam || getGeminiApiKey()).trim();
  if (!apiKey) return null;
  try {
    return new GoogleGenAI({ apiKey });
  } catch (err) {
    console.error('Error al inicializar GoogleGenAI:', err);
    return null;
  }
}

/**
 * Construye el system prompt de Adán con el contexto de la institución activa.
 */
function buildSystemPrompt(context: Record<string, unknown>): string {
  const inst            = context.institucion    as string   || 'Gestor Académico YC';
  const modulo          = context.modulo         as string   || 'general';
  const usuario         = context.usuario        as string   || 'Invitado';
  const rol             = context.rol            as string   || 'visitante';
  const anio            = context.anio           as string   || new Date().getFullYear().toString();
  const esGestor        = !!(context.gestorMode);
  const nombreInst      = context.nombreInst     as string   || inst;
  const numEstudiantes  = context.numEstudiantes as number   || 0;
  const numDocentes     = context.numDocentes    as number   || 0;
  const grados          = (context.grados        as string[]) || [];
  const perActual       = context.periodoActual  as string   || '1';
  const numPeriodos     = context.numPeriodos    as number   || 4;
  const escalaS         = context.escalaS        as number   || 4.7;
  const escalaA         = context.escalaA        as number   || 4.0;
  const escalaB         = context.escalaB        as number   || 3.0;
  const asignaturas     = (context.asignaturas   as string[]) || [];
  const misAsignaturas  = (context.misAsignaturas as string[]) || [];

  const rolLabel = rol === 'admin'       ? 'Administrador / Rector(a)'
                 : rol === 'docente'     ? 'Docente'
                 : rol === 'estudiante'  ? 'Estudiante'
                 : rol === 'padre'       ? 'Padre/Acudiente'
                 : rol === 'admin-gestor'? 'Administrador General'
                 : rol;

  const ctxSistema = esGestor
    ? `Estás en modo Gestor Multi-Plataforma. El usuario administra múltiples instituciones educativas desde el panel central.`
    : `Institución: ${nombreInst} | Año: ${anio} | Grados: ${grados.join(', ') || 'N/A'} | Estudiantes: ${numEstudiantes} | Docentes: ${numDocentes} | Periodos: ${numPeriodos} | Periodo actual: ${perActual} | Escala: S≥${escalaS} A≥${escalaA} B≥${escalaB} | Asignaturas: ${asignaturas.join(', ') || 'N/A'}${misAsignaturas.length ? ` | Mis asignaturas: ${misAsignaturas.join(', ')}` : ''}`;

  return `Eres Adán, un asistente de inteligencia artificial avanzado — igual que Gemini, ChatGPT o Claude. Puedes responder CUALQUIER pregunta sobre CUALQUIER tema sin excepción. Además, funcionas como un Copilot Pedagógico y actúas como un Sico orientador pedagógico y psicólogo educativo para apoyar a la comunidad académica.

USUARIO ACTIVO:
- Nombre: ${usuario}
- Rol en el sistema: ${rolLabel}
- Módulo activo: ${modulo}
- Contexto del sistema: ${ctxSistema}

CONOCIMIENTO ESPECIALIZADO (Gestor Académico YC):
Además de ser un asistente general, tienes conocimiento profundo del sistema Gestor Académico YC para instituciones educativas colombianas y debes actuar como Sico orientador pedagógico en los módulos de historial, asistencia, descriptores y observador:

MÓDULOS DISPONIBLES:
• Planilla de Calificaciones — notas por SER/SABER/HACER, pendientes con borde amarillo, se aplican con "GUARDAR CAMBIOS"
• Descriptores — desempenos por nivel (Superior/Alto/Básico/Bajo) por asignatura, grado, periodo
• Horarios — bloques de clase por grado, lunes a viernes
• Asistencia — P/A/J por fecha, grado y asignatura, planillas PDF
• Observador — anotaciones de convivencia, logros y compromisos con fecha automática
• Pre-matrícula — inscripciones en línea con aprobación del admin
• Boletines/Informes — PDFs por estudiante, consolidados, rankings
• Documentos/Actas — actas, paz y salvo, certificados, constancias
• Años Lectivos — gestión de años aislados, histórico, importación entre años
• Evaluación Docente, Democracia Escolar, Comunicados, Quizzes, y más

NORMATIVA COLOMBIANA:
• Decreto 1290 de 2009: evaluación y promoción, escala propia con mínimo 4 niveles
• Ley 115 de 1994 (Ley General de Educación)
• Decreto 1075 de 2015 (Decreto Único Reglamentario del Sector Educación)

CAPACIDADES ESPECIALES:
1. Generar evaluaciones completas: quices, exámenes, talleres, actividades adaptadas al grado
2. Análisis psicopedagógico profundo de observadores estudiantiles (comportamiento, dificultades, logros)
3. Planificación curricular: secuencias didácticas, planes de aula, descriptores de desempeño
4. Orientación paso a paso sobre cualquier función del sistema
5. Redacción de documentos: actas, comunicados, informes, circulares, cartas institucionales
6. Resolución de problemas matemáticos, científicos, históricos, literarios, etc.
7. Crear planes de nivelación académica y estrategias pedagógicas para estudiantes con inasistencias o bajo rendimiento.

INSTRUCCIONES:
1. Responde en español colombiano, claro y personalizado según el rol del usuario (${rolLabel})
2. Para CUALQUIER pregunta de cualquier tema, responde de forma completa y útil
3. Para material académico (quices, evaluaciones), usa formato bien estructurado con markdown
4. Para código o cálculos, usa bloques de código apropiados
5. Para preguntas del sistema, explica paso a paso específico para el módulo activo (${modulo})
6. Nunca digas que "no puedes responder" un tema — puedes responder TODO
7. Si el usuario pide generar material de estudio, créalo completo y de alta calidad
8. Adapta la extensión de la respuesta a la complejidad de la pregunta
9. Usa los datos del sistema cuando el usuario pregunte sobre su institución específica`;
}

// ── SSE (Server-Sent Events) ──────────────────────────────────────────────────

const sseClients = new Map<string, Set<express.Response>>();

function broadcastChange(sk: string, extra?: Record<string, unknown>) {
  const clients = sseClients.get(sk);
  if (!clients || clients.size === 0) return;
  const msg = `data: ${JSON.stringify({ type: 'change', sk, ts: Date.now(), ...extra })}\n\n`;
  clients.forEach(res => {
    try { res.write(msg); } catch {}
  });
}

// ── Servir portal frontend ────────────────────────────────────────────────────

const portalPath = path.join(STATIC_DIR, 'portal.html');
const indexPath  = path.join(STATIC_DIR, 'index.html');

function servePortal(_req: express.Request, res: express.Response) {
  if (fs.existsSync(portalPath)) return res.sendFile(portalPath);
  if (fs.existsSync(indexPath))  return res.sendFile(indexPath);
  return res.status(200).send('<!DOCTYPE html><html><head><meta http-equiv="refresh" content="3;url=/"></head><body>Cargando...</body></html>');
}

// ============================================================
// A03 · RUTAS — SALUD Y SINCRONIZACIÓN EN TIEMPO REAL (SSE)
// ============================================================

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get('/api/inetis/events', (req, res) => {
  const sk = String(req.query.sk || '');
  if (!sk) { res.status(400).json({ error: 'sk requerido' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  if (!sseClients.has(sk)) sseClients.set(sk, new Set());
  sseClients.get(sk)!.add(res);

  res.write(`data: ${JSON.stringify({ type: 'connected', sk, ts: Date.now() })}\n\n`);

  const keepAlive = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch { clearInterval(keepAlive); }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    const set = sseClients.get(sk);
    if (set) {
      set.delete(res);
      if (set.size === 0) sseClients.delete(sk);
    }
  });
});

// ============================================================
// A04 · RUTAS — BASE DE DATOS POR INSTITUCIÓN (KV STORE)
// ============================================================

const GESTOR_SK = '__gestor_academico_yc__';

app.get('/api/inetis/db', async (req, res) => {
  try {
    const sk = String(req.query.sk || '');
    if (!sk) return res.status(400).json({ error: 'sk requerido' });
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
    if (!rows.length) return res.json({ data: null, version: null });
    const version = rows[0].updatedAt ? rows[0].updatedAt.toISOString() : null;
    // Petición condicional: si el navegador ya tiene esta misma versión (se
    // la manda de vuelta en "If-None-Match"), no hace falta reenviar el
    // JSON completo de la institución — con cientos de estudiantes y sus
    // notas, ese JSON puede pesar varios cientos de KB, y la gran mayoría
    // de las veces que se sincroniza en segundo plano, NADA cambió desde
    // la última vez. Responder solo "304 Not Modified" (sin cuerpo) en ese
    // caso es, en la práctica, el ahorro de red más grande posible: es la
    // diferencia entre transferir todo el JSON o no transferir nada.
    if (version && req.headers['if-none-match'] === `"${version}"`) {
      return res.status(304).end();
    }
    if (version) res.setHeader('ETag', `"${version}"`);
    return res.json({ data: rows[0].value, version });
  } catch (e) {
    console.error('GET /api/inetis/db', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// Elimina definitivamente los datos de una institución (usado por el súper
// admin al borrar una plataforma). Antes solo se limpiaba el localStorage
// del navegador que hacía la operación; los datos reales quedaban huérfanos
// en la base de datos y podían reaparecer si alguien creaba otra plataforma
// con el mismo identificador ("sk"). Ahora se borra también en el servidor.
app.delete('/api/inetis/db', async (req, res) => {
  try {
    const sk = String(req.query.sk || (req.body && req.body.sk) || '');
    if (!sk) return res.status(400).json({ error: 'sk requerido' });
    await db.delete(kvStore).where(eq(kvStore.key, sk));
    await db.delete(notifications).where(eq(notifications.sk, sk));
    return res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/inetis/db', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// Guardado con detección de ediciones concurrentes (optimistic
// concurrency control): el cliente envía la versión ("baseVersion")
// que tenía al momento de empezar a editar. Si nadie más guardó
// desde entonces, se acepta normalmente. Si alguien más ya guardó
// (por ejemplo otro docente editando la misma planilla), se
// responde 409 con los datos actuales del servidor para que el
// cliente combine los cambios en vez de sobrescribirlos a ciegas.
// Si el cliente no envía "baseVersion" (versiones antiguas del
// frontend, o el HTML de uso sin conexión), se guarda como antes,
// sin verificación, para no romper compatibilidad.
// ============================================================
app.post('/api/inetis/db', async (req, res) => {
  try {
    const { sk, data, baseVersion } = req.body as { sk: string; data: unknown; baseVersion?: string | null };
    if (!sk) return res.status(400).json({ error: 'sk requerido' });

    if (baseVersion !== undefined) {
      const existing = await db.select().from(kvStore).where(eq(kvStore.key, sk));
      const currentVersion = existing.length && existing[0].updatedAt ? existing[0].updatedAt.toISOString() : null;
      if (existing.length && currentVersion !== baseVersion) {
        // Alguien más guardó primero: se informa al cliente para que combine y reintente.
        return res.status(409).json({
          error: 'conflict',
          data: existing[0].value,
          version: currentVersion,
        });
      }
    }

    const nowTs = new Date();
    await db
      .insert(kvStore)
      .values({ key: sk, value: data as any, updatedAt: nowTs })
      .onConflictDoUpdate({
        target: kvStore.key,
        set: { value: data as any, updatedAt: nowTs },
      });
    broadcastChange(sk);
    return res.json({ ok: true, version: nowTs.toISOString() });
  } catch (e) {
    console.error('POST /api/inetis/db', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/inetis/gestordb', async (_req, res) => {
  try {
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    if (!rows.length) return res.json({ data: null });
    return res.json({ data: rows[0].value });
  } catch (e) {
    console.error('GET /api/inetis/gestordb', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/gestordb', async (req, res) => {
  try {
    const { data } = req.body as { data: unknown };
    await db
      .insert(kvStore)
      .values({ key: GESTOR_SK, value: data as any, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: kvStore.key,
        set: { value: data as any, updatedAt: new Date() },
      });
    broadcastChange(GESTOR_SK);
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/gestordb', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/inetis/docs', async (req, res) => {
  try {
    const estId = String(req.query.estId || '');
    if (estId) {
      const rows = await db.select().from(documents).where(eq(documents.estId, estId));
      return res.json(rows.map(r => r.data));
    }
    const rows = await db.select().from(documents).limit(500);
    return res.json(rows.map(r => r.data));
  } catch (e) {
    console.error('GET /api/inetis/docs', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/docs', async (req, res) => {
  try {
    const { clave, ...data } = req.body as { clave: string; [k: string]: unknown };
    if (!clave) return res.status(400).json({ error: 'clave requerida' });
    const estId = String((data as any).estId || (data as any).est_id || '');
    await db
      .insert(documents)
      .values({ clave, estId, data: { clave, ...data } as any })
      .onConflictDoUpdate({
        target: documents.clave,
        set: { data: { clave, ...data } as any, estId },
      });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/docs', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/inetis/docs/:clave', async (req, res) => {
  try {
    const clave = decodeURIComponent(req.params.clave);
    const rows = await db.select().from(documents).where(eq(documents.clave, clave));
    if (!rows.length) return res.status(404).json(null);
    return res.json(rows[0].data);
  } catch (e) {
    console.error('GET /api/inetis/docs/:clave', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.delete('/api/inetis/docs/:clave', async (req, res) => {
  try {
    const clave = decodeURIComponent(req.params.clave);
    await db.delete(documents).where(eq(documents.clave, clave));
    return res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/inetis/docs/:clave', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// A05 · RUTAS — NOTIFICACIONES DEL SISTEMA
// ============================================================

app.get('/api/inetis/notifications', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);
    const sk = req.query.sk !== undefined ? String(req.query.sk || '') : null;
    const kind = req.query.kind !== undefined ? String(req.query.kind || '') : null;
    // sk presente → solo esa institución (portales de padre/estudiante/docente/admin).
    // sk ausente → sin filtrar, para el panel del súper admin (ve todas las instituciones a propósito).
    // kind opcional → por ejemplo 'salud-guardado' para el Panel de Salud del Sistema,
    // sin tener que traer y filtrar en el navegador todas las notificaciones existentes.
    const condiciones = [
      sk !== null ? eq(notifications.sk, sk) : undefined,
      kind !== null ? eq(notifications.kind, kind) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const rows = await db
      .select()
      .from(notifications)
      .where(condiciones.length ? and(...condiciones) : undefined)
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    return res.json({ notifications: rows });
  } catch (e) {
    console.error('GET /api/inetis/notifications', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/notify', async (req, res) => {
  try {
    const { kind, actor, message, meta, sk } = req.body as {
      kind: string; actor: string; message: string; meta?: unknown; sk?: string;
    };
    await db.insert(notifications).values({
      sk: sk || null,
      kind: kind || 'info',
      actor: actor || '',
      message: message || '',
      meta: (meta || null) as any,
      seen: false,
    });
    if (sk) enviarPushParaNotificacion(sk, kind || 'info', message || '', meta).catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/notify', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// SUSCRIPCIONES A NOTIFICACIONES PUSH
// ============================================================
app.get('/api/inetis/push/vapid-public-key', (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY, habilitado: PUSH_HABILITADO });
});

app.post('/api/inetis/push/subscribe', async (req, res) => {
  try {
    const { sk, userU, rol, estId, subscription } = req.body as {
      sk: string; userU: string; rol?: string; estId?: string | number; subscription?: { endpoint: string };
    };
    if (!sk || !userU || !subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }
    await db.insert(pushSubscriptions).values({
      sk, userU, rol: rol || '', estId: estId != null ? String(estId) : null,
      endpoint: subscription.endpoint, subscription: subscription as any,
    }).onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { sk, userU, rol: rol || '', estId: estId != null ? String(estId) : null, subscription: subscription as any },
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/push/subscribe', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/push/unsubscribe', async (req, res) => {
  try {
    const endpoint = String((req.body && req.body.endpoint) || '');
    if (endpoint) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/push/unsubscribe', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/inetis/notify/seen', async (req, res) => {
  try {
    const sk = String((req.body && req.body.sk) || '');
    // Si se indica institución, solo se marcan como leídas SUS notificaciones.
    // Sin sk (panel del súper admin), se conserva el comportamiento global.
    await db.update(notifications).set({ seen: true }).where(sk ? eq(notifications.sk, sk) : undefined);
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/notify/seen', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// FIRMA Y VERIFICACIÓN DE BOLETINES (código de autenticidad + QR)
// El navegador nunca conoce DOC_SIGN_SECRET: solo puede pedir que se
// firme un documento (al generarlo) o que se verifique un código
// contra los datos actuales (al comprobarlo). Sin la clave secreta
// del servidor es imposible generar un código válido para datos
// alterados, así que un boletín no se puede "editar" y seguir
// pasando la verificación.
// ============================================================
app.post('/api/inetis/boletin/firmar', (req, res) => {
  if (!DOC_SIGN_SECRET) return res.status(503).json({ error: 'La firma de documentos no está configurada en el servidor (falta DOC_SIGN_SECRET).' });
  try {
    const { documentos } = req.body as { documentos?: { ref: string; datos: unknown }[] };
    if (!Array.isArray(documentos) || !documentos.length) return res.status(400).json({ error: 'documentos requerido' });
    const codigos = documentos.map(d => ({ ref: d.ref, codigo: _firmarBlob(d.datos) }));
    return res.json({ codigos });
  } catch (e) {
    console.error('POST /api/inetis/boletin/firmar', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

interface ArchivoSubidoMulter {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

app.post('/api/inetis/boletin/verificar', (req, res) => {
  if (!DOC_SIGN_SECRET) return res.status(503).json({ error: 'La firma de documentos no está configurada en el servidor (falta DOC_SIGN_SECRET).' });
  try {
    const { datos, codigo } = req.body as { datos?: unknown; codigo?: string };
    if (datos === undefined || !codigo) return res.status(400).json({ error: 'datos y codigo son requeridos' });
    const esperado = _firmarBlob(datos);
    return res.json({ valido: esperado === String(codigo).toUpperCase() });
  } catch (e) {
    console.error('POST /api/inetis/boletin/verificar', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// A05B · RUTAS — CARGA DE ARCHIVOS (Cloudinary)
// ============================================================
// Todos los archivos (fotos de perfil, logos, escudos, firmas,
// evidencias, documentos) se suben aquí en vez de guardarse como texto
// Base64 dentro de la base de datos. El navegador manda el archivo con
// multipart/form-data (campo "archivo"); esta ruta lo recibe con
// Multer (en memoria, nunca toca el disco), lo sube a Cloudinary con
// upload_stream, y devuelve SOLO la URL pública (secure_url) — eso es
// lo único que el navegador debe guardar en el registro
// correspondiente (ej. db.logo = url).
//
// "carpeta" (opcional, en el formulario) organiza los archivos dentro
// de Cloudinary por tipo, ej. "fotos-perfil", "logos-institucion",
// "documentos". Si no se envía, cae en una carpeta general.
// Ruta de diagnóstico: abra esto directamente en el navegador (GET, sin
// necesidad de subir nada) para confirmar sin ambigüedad si Cloudinary
// está configurado en ESTE proceso que está corriendo ahora mismo — más
// confiable que revisar el historial de la terminal, que puede mostrar
// texto de una ejecución anterior.
app.get('/api/inetis/upload/status', (req, res) => {
  res.json({
    cloudinaryConfigurado,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ? process.env.CLOUDINARY_CLOUD_NAME : null,
    mensaje: cloudinaryConfigurado
      ? '✅ Cloudinary está configurado y listo para recibir archivos.'
      : '⚠️ Cloudinary NO está configurado — faltan CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY o CLOUDINARY_API_SECRET en las variables de entorno de ESTE proceso.',
  });
});

// Configuración PÚBLICA que el navegador necesita conocer — nunca
// incluye secretos. El DSN de Sentry no es información sensible: está
// diseñado para vivir en código público (así funciona en cualquier
// app con monitoreo de errores del lado del cliente), solo permite
// ENVIAR reportes de error a este proyecto, no leer nada.
app.get('/api/config/public', (req, res) => {
  res.json({
    sentryDsnFrontend: process.env.SENTRY_DSN_FRONTEND || process.env.SENTRY_DSN || null,
  });
});

// Ruta de diagnóstico: abra esto directamente en el navegador para
// provocar un error DE PRUEBA a propósito. Sirve para confirmar que
// Sentry está recibiendo reportes de verdad — visitar una URL que no
// existe NO sirve para esto (eso solo da un 404 normal, no un error
// real). Se puede borrar esta ruta más adelante si se quiere, no
// afecta nada del sistema si se deja.
app.get('/api/test-error-sentry', (req, res) => {
  throw new Error('Error de prueba — confirma que Sentry está recibiendo reportes correctamente. Si ve este error en su panel de Sentry, todo está funcionando.');
});

// ============================================================
// PORTAL DE CONSULTA RÁPIDA (ultraliviano) — para padres en zonas
// rurales que no suelen entrar a portales web completos desde un
// computador, pero sí revisan un enlace desde el celular. El enlace
// lleva un token firmado (mismo mecanismo que ya protege los
// boletines — DOC_SIGN_SECRET) que autoriza ver SOLO el resumen de
// UN estudiante puntual, sin necesidad de usuario/contraseña ni de
// descargar los datos completos de la institución. El enlace vence
// a los 30 días, por seguridad.
// ============================================================
const CONSULTA_RAPIDA_DIAS_VALIDEZ = 30;

function _generarTokenConsultaRapida(sk: string, estId: string | number): string {
  const exp = Date.now() + CONSULTA_RAPIDA_DIAS_VALIDEZ * 24 * 60 * 60 * 1000;
  const payload = { sk, estId: String(estId), exp };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const firma = _firmarBlob(payload);
  return payloadB64 + '.' + firma;
}
function _verificarTokenConsultaRapida(token: string): { sk: string; estId: string } | null {
  try {
    const [payloadB64, firma] = token.split('.');
    if (!payloadB64 || !firma) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (_firmarBlob(payload) !== firma) return null; // firma no coincide: token alterado o falso
    if (!payload.exp || Date.now() > payload.exp) return null; // vencido
    return { sk: payload.sk, estId: payload.estId };
  } catch {
    return null;
  }
}

// Genera el enlace — se llama desde el panel del administrador/docente
// (ej. un botón "🔗 Generar enlace para acudiente" junto a cada
// estudiante). No requiere estar configurado nada adicional: reutiliza
// DOC_SIGN_SECRET, que ya existe para los boletines.
app.post('/api/inetis/consulta-rapida/generar', (req, res) => {
  if (!DOC_SIGN_SECRET) return res.status(503).json({ error: 'Esta función requiere DOC_SIGN_SECRET configurada en el servidor (la misma que ya usan los boletines).' });
  const { sk, estId } = req.body || {};
  if (!sk || !estId) return res.status(400).json({ error: 'Falta sk o estId' });
  const token = _generarTokenConsultaRapida(sk, estId);
  return res.json({ token, diasValidez: CONSULTA_RAPIDA_DIAS_VALIDEZ });
});

// Ruta PÚBLICA (sin login) que consulta el token: el propio token, ya
// firmado, ES la autorización — nadie puede fabricar uno válido sin
// conocer DOC_SIGN_SECRET (que solo vive en el servidor). Devuelve
// ÚNICAMENTE un resumen pequeño de ESE estudiante — nunca los datos
// completos de la institución — para que la página que lo consume sea
// genuinamente liviana en datos móviles.
app.get('/api/inetis/consulta-rapida', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    const info = _verificarTokenConsultaRapida(token);
    if (!info) return res.status(401).json({ error: 'Enlace inválido o vencido. Pida uno nuevo en la institución.' });

    const rows = await db.select().from(kvStore).where(eq(kvStore.key, info.sk));
    if (!rows.length) return res.status(404).json({ error: 'Institución no encontrada.' });
    const data = rows[0].value as any;

    const est = (data.ests || []).find((e: any) => String(e.id) === info.estId);
    if (!est) return res.status(404).json({ error: 'Estudiante no encontrado.' });

    const numPeriodos = (data.config && data.config.numPeriodos) || 4;
    const carga = (data.carga || []).filter((c: any) => c.g === est.g);
    // Resumen simplificado por materia y periodo (promedio simple de
    // Ser/Saber/Hacer) — pensado para una vista rápida en celular, no
    // reemplaza el boletín oficial con los pesos configurados.
    const materias = carga.map((c: any) => {
      const porPeriodo: Record<string, number | null> = {};
      for (let p = 1; p <= numPeriodos; p++) {
        const n = (est.nts && est.nts[c.id] && est.nts[c.id][p]) || null;
        if (n) {
          const vals = [n.s, n.sb, n.h].filter((v: any) => typeof v === 'number' && v > 0);
          porPeriodo['p' + p] = vals.length ? Math.round((vals.reduce((a: number, b: number) => a + b, 0) / vals.length) * 10) / 10 : null;
        } else {
          porPeriodo['p' + p] = null;
        }
      }
      return { materia: c.m, ...porPeriodo };
    });

    // Asistencia: % simple del año, basado en los registros de clase de su grado.
    const clases = (data.asistencia || []).filter((a: any) => !a.deletedAt && a.grado === est.g);
    let totalPosible = 0, totalAusentes = 0;
    clases.forEach((c: any) => {
      const ausente = (c.ausentes || []).includes(est.id);
      totalPosible++;
      if (ausente) totalAusentes++;
    });
    const pctAsistencia = totalPosible > 0 ? Math.round((1 - totalAusentes / totalPosible) * 1000) / 10 : null;

    return res.json({
      institucion: data.nombre || '',
      rectora: data.rectora || '',
      anio: data.anio || '',
      estudiante: est.n,
      grado: est.g,
      numPeriodos,
      materias,
      pctAsistencia,
      generadoEn: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /api/inetis/consulta-rapida error:', err);
    return res.status(500).json({ error: 'Error interno consultando la información.' });
  }
});

// Borra uno o varios archivos de Cloudinary a partir de su URL — se llama
// cuando el usuario reemplaza una foto/documento por uno nuevo (para
// borrar el viejo) o lo elimina explícitamente, así la cuenta de
// Cloudinary no se llena de archivos huérfanos que ya nadie usa.
// Acepta { url: "..." } para un solo archivo, o { urls: ["...", "..."] }
// para varios de una vez (ej. al eliminar un registro con varios adjuntos).
// Siempre responde OK: borrar el archivo viejo es limpieza de fondo, no
// debe hacer fallar la acción principal del usuario si algo sale mal acá.
app.post('/api/inetis/upload/delete', async (req, res) => {
  try {
    const urls: string[] = Array.isArray(req.body?.urls)
      ? req.body.urls
      : req.body?.url
      ? [req.body.url]
      : [];
    await Promise.all(urls.map((u) => eliminarDeCloudinarySiAplica(u)));
    return res.json({ ok: true });
  } catch (err) {
    console.warn('⚠️  Error en /api/inetis/upload/delete:', err);
    return res.json({ ok: true }); // ver comentario arriba: nunca se reporta como fallo al frontend
  }
});

app.post('/api/inetis/upload', uploadMemoria.single('archivo'), async (req, res) => {
  if (!cloudinaryConfigurado) {
    return res.status(503).json({ error: 'La carga de archivos no está configurada en el servidor (faltan las variables CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY o CLOUDINARY_API_SECRET).' });
  }
  try {
    const archivo = (req as unknown as { file?: ArchivoSubidoMulter }).file;
    if (!archivo) return res.status(400).json({ error: 'No se recibió ningún archivo (campo "archivo" requerido).' });
    const carpeta = String(req.body?.carpeta || 'general').replace(/[^a-zA-Z0-9_-]/g, '') || 'general';
    const sk = String(req.body?.sk || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const tipoForzado = String(req.body?.resourceType || '');
    const esImagen = archivo.mimetype.startsWith('image/');
    const resourceType = (tipoForzado === 'raw' || tipoForzado === 'image' || tipoForzado === 'auto')
      ? tipoForzado
      : (esImagen ? 'image' : 'auto');
    const resultado = await subirBufferACloudinary(archivo.buffer, {
      folder: 'gestor-yc/' + (sk ? sk + '/' : '') + carpeta,
      resourceType,
    });
    return res.json({ url: resultado.url, bytes: resultado.bytes, format: resultado.format });
  } catch (e) {
    console.error('POST /api/inetis/upload', e);
    return res.status(500).json({ error: 'No se pudo subir el archivo. Intente de nuevo.' });
  }
});

// ============================================================
// A06 · RUTAS — ASISTENTE IA ADÁN (GEMINI)
// ============================================================

app.get('/api/inetis/ai/status', async (req, res) => {
  const apiKey = getGeminiApiKey(req);
  if (!apiKey) {
    return res.json({
      ok: false,
      keyConfigured: false,
      message: 'GEMINI_API_KEY o GOOGLE_API_KEY no encontrada en .env ni en variables de entorno.'
    });
  }

  try {
    const genAI = getGenAI(apiKey);
    if (!genAI) {
      return res.json({ ok: false, keyConfigured: false, message: 'No se pudo inicializar la librería GoogleGenAI' });
    }

    let activeModel = '';
    let lastError = '';

    for (const m of CANDIDATE_MODELS) {
      try {
        const testRes = await genAI.models.generateContent({
          model: m,
          contents: 'Hola',
          config: { maxOutputTokens: 10 }
        });
        if (testRes && (testRes.text || testRes.candidates)) {
          activeModel = m;
          break;
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }

    if (activeModel) {
      return res.json({
        ok: true,
        keyConfigured: true,
        model: activeModel,
        message: `Asistente Adán conectado correctamente con modelo ${activeModel}`
      });
    } else {
      return res.json({
        ok: false,
        keyConfigured: true,
        message: `Clave detectada pero hubo fallo al consultar modelos Gemini: ${lastError}`
      });
    }
  } catch (e: any) {
    return res.status(200).json({ ok: false, keyConfigured: true, error: e?.message || 'Error de diagnóstico' });
  }
});

app.post('/api/inetis/ai/chat', async (req, res) => {
  try {
    const { messages, context, mode, imagePart } = req.body as {
      messages: Array<{ role: string; content: string }>;
      context?: Record<string, unknown>;
      mode?: string;
      imagePart?: { mimeType: string; data: string };
    };

    const apiKey = getGeminiApiKey(req);
    if (!apiKey) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ content: '⚠️ **Asistente Adán**: Clave GEMINI_API_KEY o GOOGLE_API_KEY no detectada en el servidor (.env) ni en la petición.' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const genAI = getGenAI(apiKey);
    if (!genAI) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ content: '⚠️ Error al inicializar el cliente de Google Gemini con la clave proporcionada.' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const systemPrompt = buildSystemPrompt(context || {});

    const history = (messages || []).slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' as const : 'model' as const,
      parts: [{ text: m.content || '' }],
    }));

    const lastMsg  = (messages && messages.length > 0) ? messages[messages.length - 1] : null;
    const userText = lastMsg?.content || '';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const isPlanear = mode === 'planear' || (messages || []).some(m =>
      m.content && m.content.includes('planeación de clase COMPLETA')
    );

    let stream = null;
    let streamModel = '';
    let lastError: any = null;

   /* for (const candidateModel of CANDIDATE_MODELS) {
      try {
        const chat = genAI.chats.create({
          model: candidateModel,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.8,
            maxOutputTokens: isPlanear ? 8192 : 4096,
          },
          history,
        });

        if (imagePart && imagePart.data) {
          stream = await chat.sendMessageStream({
            message: [
              { text: userText || 'Analiza esta imagen y describe lo que ves.' },
              { inlineData: { mimeType: imagePart.mimeType || 'image/jpeg', data: imagePart.data } },
            ],
          });
        } else {
          stream = await chat.sendMessageStream({ message: userText });
        }
        streamModel = candidateModel;
        break;
      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ Intento fallido con modelo IA ${candidateModel}:`, err?.message || err);
      }
    }
*/
for (const candidateModel of CANDIDATE_MODELS) {
      try {
        const chat = genAI.chats.create({
          model: candidateModel,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7,
            maxOutputTokens: isPlanear ? 4096 : 2048, // Permite respuestas largas sin cortar la idea
          },
          history: history.slice(-6), // Mantiene un contexto de conversación equilibrado
        });

        if (imagePart && imagePart.data) {
          stream = await chat.sendMessageStream({
            message: [
              { text: userText || 'Analiza esta imagen.' },
              { inlineData: { mimeType: imagePart.mimeType || 'image/jpeg', data: imagePart.data } },
            ],
          });
        } else {
          stream = await chat.sendMessageStream({ message: userText });
        }
        break;
      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ Intento fallido con modelo ${candidateModel}:`, err?.message || err);
      }
    }
    if (!stream) {
      const errMsg = lastError?.message || 'No se pudo establecer conexión con los modelos Gemini de Google.';
      res.write(`data: ${JSON.stringify({ content: `⚠️ Error de conexión con Gemini: ${errMsg}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    for await (const chunk of stream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ content: chunk.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
    return;
  } catch (e: unknown) {
    console.error('POST /api/inetis/ai/chat error:', e);
    const msg = e instanceof Error ? e.message : 'Error interno de comunicación con la IA';
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
    try {
      res.write(`data: ${JSON.stringify({ content: `⚠️ Error: ${msg}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch {}
    return;
  }
});

app.post('/api/inetis/ai/general', async (req, res) => {
  try {
    const { messages, context, prompt } = req.body as {
      messages?: Array<{ role: string; content: string }>;
      context?: Record<string, unknown>;
      prompt?: string;
    };

    const apiKey = getGeminiApiKey(req);
    if (!apiKey) {
      return res.json({
        ok: false,
        error: 'GEMINI_API_KEY_NO_CONFIGURADA',
        content: '⚠️ La clave GEMINI_API_KEY o GOOGLE_API_KEY no está configurada.'
      });
    }

    const genAI = getGenAI(apiKey);
    if (!genAI) {
      return res.json({
        ok: false,
        error: 'ERROR_INICIALIZANDO_GENAI',
        content: '⚠️ No se pudo inicializar el cliente de Google Gemini con la clave provista.'
      });
    }

    const systemPrompt = buildSystemPrompt(context || {});
    const userText = prompt || (messages && messages[messages.length - 1]?.content) || '';

    if (!userText) return res.status(400).json({ ok: false, error: 'Texto vacío', content: '' });

    let resultText = '';
    let lastError: any = null;

    for (const candidateModel of CANDIDATE_MODELS) {
      try {
        const result = await genAI.models.generateContent({
          model: candidateModel,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7,
            maxOutputTokens: 2048,
          },
          contents: userText,
        });
        if (result && result.text) {
          resultText = result.text;
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ Error en ai/general con modelo ${candidateModel}:`, err?.message || err);
      }
    }

    if (!resultText && lastError) {
      return res.json({
        ok: false,
        error: lastError?.message || 'Error en consulta Gemini',
        content: `⚠️ No se pudo generar la respuesta con Gemini: ${lastError?.message || 'Error desconocido'}`
      });
    }

    return res.json({ ok: true, content: resultText || '' });
  } catch (e: unknown) {
    console.error('POST /api/inetis/ai/general', e);
    const msg = e instanceof Error ? e.message : 'Error interno';
    return res.json({ ok: false, error: msg, content: `⚠️ Error al procesar solicitud de IA: ${msg}` });
  }
});

// ── RUTA DEDICADA PARA INFORMES Y REPORTES PSICOPEDAGÓGICOS POR GRADO Y PERIODO ─────────

app.post('/api/inetis/ai/psicopedagogico', async (req, res) => {
  try {
    const { grado, periodo, datosAsistencia, datosObservador, context } = req.body as {
      grado: string;
      periodo: string;
      datosAsistencia?: any[];
      datosObservador?: any[];
      context?: Record<string, unknown>;
    };

    const apiKey = getGeminiApiKey(req);
    if (!apiKey) {
      return res.status(400).json({ ok: false, message: 'Clave API no configurada' });
    }

    const genAI = getGenAI(apiKey);
    if (!genAI) {
      return res.status(500).json({ ok: false, message: 'Error al inicializar Gemini' });
    }

    const promptText = `
Genera un informe psicopedagógico detallado con las siguientes especificaciones:
- Grado evaluado: ${grado || 'Todos los grados'}
- Periodo académico: ${periodo || 'Todos los periodos'}
- Datos de inasistencias acumuladas: ${JSON.stringify(datosAsistencia || [])}
- Anotaciones del observador/convivencia: ${JSON.stringify(datosObservador || [])}

Proporciona:
1. Resumen ejecutivo de novedades comportamentales y de asistencia.
2. Identificación de estudiantes en riesgo académico o deserción.
3. Recomendaciones y compromisos recomendados para docentes y acudientes.
`;

    let resultText = '';
    for (const candidateModel of CANDIDATE_MODELS) {
      try {
        const result = await genAI.models.generateContent({
          model: candidateModel,
          config: {
            systemInstruction: buildSystemPrompt(context || {}),
            temperature: 0.7,
            maxOutputTokens: 4096,
          },
          contents: promptText,
        });
        if (result && result.text) {
          resultText = result.text;
          break;
        }
      } catch (err) {
        console.warn(`Error con modelo ${candidateModel}:`, err);
      }
    }

    return res.json({ ok: true, report: resultText });
  } catch (e: any) {
    console.error('Error en /api/inetis/ai/psicopedagogico:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'Error interno' });
  }
});

// ============================================================
// A06b · RUTAS — MÓDULO REPOSITORIO
// ============================================================

app.use('/api/repositorio', repositorioRouter);
app.use('/api/lms', lmsRouter);

app.get('/repositorio', (req, res) => {
  function _safeDecodeQP(raw: unknown): string {
    const s = String(raw || '').trim();
    if (!s) return '';
    try { return decodeURIComponent(s); } catch { return s; }
  }
  const instNombre = _safeDecodeQP(req.query._instNombre);
  const instEscudo = _safeDecodeQP(req.query._instEscudo);

  try {
    let html = fs.readFileSync(path.resolve(__dirname, '../modulo-repositorio/index.html'), 'utf8');

    if (instNombre) {
      const title = `REPOSITORIO RECURSOS · ${instNombre}`;
      html = html
        .replace(/<title id="site-title-tag">.*?<\/title>/,
          `<title id="site-title-tag">${title}</title>`)
        .replace(/<div class="hdr-title" id="hdr-inst-name">.*?<\/div>/,
          `<div class="hdr-title" id="hdr-inst-name">${title}</div>`);
    }

    if (instEscudo) {
      html = html.replace(
        /<img id="hdr-logo"[^>]*>/,
        `<img id="hdr-logo" class="hdr-logo" src="${instEscudo}" alt="" style="">`
      );
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.removeHeader('ETag');
    res.send(html);
  } catch (_e) {
    res.sendFile(path.resolve(__dirname, '../modulo-repositorio/index.html'));
  }
});

app.use('/repositorio', express.static(path.resolve(__dirname, '../modulo-repositorio'), { index: false }));
app.use('/modulo-repositorio', express.static(path.resolve(__dirname, '../modulo-repositorio')));

// ============================================================
// A07 · RUTAS — FRONTEND ESTÁTICO (PRODUCCIÓN)
// ============================================================

if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR, { index: false }));
}

app.get('/', servePortal);
app.get('/admin-ycgestor',      servePortal);
app.get('/admin-portal-secure', servePortal);

// Comodín para servir el frontend en cualquier ruta no reconocida (SPA).
// Se usa una expresión regular literal (/.*/), NO el texto '*' — desde que
// Express (incluso en la rama 4.x, por una actualización de seguridad de su
// motor interno de rutas "path-to-regexp") dejó de aceptar '*' como cadena
// de texto para este tipo de ruta comodín. Una RegExp real evita ese
// problema por completo, sin importar la versión instalada.
app.get(/.*/, (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  return servePortal(req, res);
});

// El manejador de errores de Sentry va DESPUÉS de todas las rutas (así
// puede capturar errores lanzados por cualquiera de ellas) — si no hay
// SENTRY_DSN configurada, esto no hace nada, como se explicó arriba.
Sentry.setupExpressErrorHandler(app);

// ============================================================
// A08 · INICIO DEL SERVIDOR
// ============================================================

// ============================================================
// A08 · RESPALDO AUTOMÁTICO SEMANAL — copia de seguridad de cada
// institución en Cloudinary, sin necesidad de que nadie presione el
// botón manual de "Descargar Respaldo".
// ------------------------------------------------------------------
// Diseño pensado para ser resistente a reinicios del servidor
// (frecuentes en planes gratuitos de hosting, que "duermen" el
// servicio tras inactividad): en vez de una tarea programada a una
// hora fija (que se perdería si el servidor está dormido justo en
// ese momento), se revisa periódicamente si YA PASARON 7 días desde
// el último respaldo de cada institución — así, sin importar cuándo
// se reinicie el servidor, tarde o temprano la revisión periódica
// se pone al día.
//
// El registro de "cuándo fue el último respaldo" se guarda en una
// llave SEPARADA de los datos propios de la institución (prefijo
// "_respaldo_meta_") — a propósito, para NO tocar el registro de la
// institución en sí: si el respaldo automático actualizara esa
// misma fila, cambiaría su "updatedAt" y eso rompería la
// optimización de sincronización (ETag/304) que evita reenviar el
// JSON completo cuando nada cambió de verdad para los usuarios.
// ============================================================
const RESPALDO_INTERVALO_REVISION_MS = 12 * 60 * 60 * 1000; // revisar cada 12 horas
const RESPALDO_DIAS_MINIMOS = 7;

async function respaldoObtenerMeta(sk: string): Promise<{ ultimoRespaldo?: string } | null> {
  const filas = await db.select().from(kvStore).where(eq(kvStore.key, '_respaldo_meta_' + sk));
  if (!filas.length) return null;
  return (filas[0].value as any) || null;
}

async function respaldoGuardarMeta(sk: string, meta: { ultimoRespaldo: string; cloudinaryUrl?: string }) {
  const clave = '_respaldo_meta_' + sk;
  const existe = await db.select().from(kvStore).where(eq(kvStore.key, clave));
  if (existe.length) {
    await db.update(kvStore).set({ value: meta as any, updatedAt: new Date() }).where(eq(kvStore.key, clave));
  } else {
    await db.insert(kvStore).values({ key: clave, value: meta as any });
  }
}

async function ejecutarRespaldosAutomaticosPendientes() {
  try {
    const todasLasFilas = await db.select().from(kvStore);
    // Solo instituciones reales: se excluyen las llaves de metadatos de
    // respaldo y cualquier otra llave con prefijo "_" reservado para uso
    // interno del sistema.
    const filasInstituciones = todasLasFilas.filter((f) => !f.key.startsWith('_'));
    const ahora = Date.now();
    for (const fila of filasInstituciones) {
      try {
        const meta = await respaldoObtenerMeta(fila.key);
        const ultimoMs = meta?.ultimoRespaldo ? new Date(meta.ultimoRespaldo).getTime() : 0;
        const diasTranscurridos = (ahora - ultimoMs) / (1000 * 60 * 60 * 24);
        if (diasTranscurridos < RESPALDO_DIAS_MINIMOS) continue; // todavía no toca

        if (!cloudinaryConfigurado) {
          console.warn(`⚠️  Respaldo automático de "${fila.key}" pendiente, pero Cloudinary no está configurado — se reintentará en la próxima revisión.`);
          continue;
        }

        const contenidoJson = JSON.stringify(fila.value);
        const buffer = Buffer.from(contenidoJson, 'utf-8');
        const fechaHoy = new Date().toISOString().slice(0, 10);
        const resultado = await subirBufferACloudinary(buffer, {
          folder: 'gestor-yc/respaldos-automaticos/' + fila.key,
          publicId: 'respaldo-' + fechaHoy,
          resourceType: 'raw',
        });
        await respaldoGuardarMeta(fila.key, { ultimoRespaldo: new Date().toISOString(), cloudinaryUrl: resultado.url });
        console.log(`✅  Respaldo automático completado para "${fila.key}" → ${resultado.url}`);
      } catch (errUno) {
        // Un fallo en UNA institución no debe detener el respaldo de las demás.
        console.error(`❌  Error en el respaldo automático de "${fila.key}":`, errUno);
      }
    }
  } catch (err) {
    console.error('❌  Error general revisando respaldos automáticos pendientes:', err);
  }
}

function iniciarRespaldosAutomaticosProgramados() {
  // Primera revisión a los 3 minutos de iniciar el servidor (deja que
  // termine de arrancar tranquilo primero), luego cada 12 horas.
  setTimeout(() => { ejecutarRespaldosAutomaticosPendientes(); }, 3 * 60 * 1000);
  setInterval(() => { ejecutarRespaldosAutomaticosPendientes(); }, RESPALDO_INTERVALO_REVISION_MS);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server escuchando en puerto ${PORT}`);
  const key = getGeminiApiKey();
  if (!key) {
    console.warn('⚠️  GEMINI_API_KEY no configurada — IA no disponible');
  } else {
    console.log(`✅  Asistente Adán IA configurado. Modelo preferido: ${PRIMARY_MODEL}`);
  }
  iniciarRespaldosAutomaticosProgramados();
  console.log('🗄️  Respaldo automático semanal programado (revisión cada 12 horas).');
});