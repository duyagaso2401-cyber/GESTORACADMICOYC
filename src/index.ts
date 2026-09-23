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
import { db, kvStore, notifications, documents, pushSubscriptions, finTransacciones, finSuscripciones, ensureSchemaETC, ensureSchemaEtcAuditoria, ensureSchemaEducacionSuperior, agentAuditLogs, ensureSchemaPerfilExtendido, perfilDocenteExtendido, perfilAuditLog, ensureSchemaCertificados, certificadosEmitidos, repositorioResources, ensureSchemaRedInterinstitucional, estudiantesIndiceRed, solicitudesTraslado, ensureSchemaRelacionalNotas, autoSeedSuperAdmin, estudiantesRel, materiasRel, calificacionesRel, migracionRelacionalNotas } from './db/index.js';
// Lote 1 — Módulo ETC + Módulo Universidades/Educación Superior (feature
// flags, activación bajo demanda, ver comentario junto a los endpoints
// POST /api/superadmin/activar-modulo-* más abajo, y src/lib/feature-flags.ts).
import etcRouter from './routes/etc.js';
import educacionSuperiorRouter from './routes/educacion-superior.js';
import contratacionRouter from './routes/contratacion.js';
import { moduloHabilitado, activarFlagEnGestorDB, establecerFlagSimpleEnGestorDB, FLAG_AI_NEON_QUERIES, FLAG_AI_ECOSYSTEM_AUDITOR, FLAG_RENDER_KEEPALIVE_PING, FLAG_SIMAT_ETC_MODULE, checkAiNeonEnabled, checkAiAuditorEnabled, checkKeepAliveEnabled, checkSimatEtcEnabled } from './lib/feature-flags.js';
import { FLAG_SMS_NOTIFICATIONS, smsNotificacionesHabilitadasGlobalmente } from './lib/sms-provider.js';
import repositorioRouter from './routes/repositorio.js';
import lmsRouter from './routes/lms.js';
import universityRouter, { exigirSesion as exigirSesionUniv, verificarInstitucionActiva as verificarInstitucionActivaUniv } from './routes/university.js';
// Sistema Universitario ENTERPRISE (LMS/SIS) — módulo adicional integrado
// directamente sobre el sistema universitario existente; reutiliza el
// mismo esquema de sesión (exigirSesion/verificarInstitucionActiva) para
// no duplicar lógica de autenticación. Ver src/university-lms/routes/university.routes.js
import universityLmsRouter from './university-lms/routes/university.routes.js';
import { eq, desc, and, isNull, or, sql } from 'drizzle-orm';
import { obtenerEstrategiaIA, generarConEstrategiaIA } from './lib/ai-service.js';
import { GoogleGenAI } from '@google/genai';
import { enviarPushParaNotificacion, VAPID_PUBLIC_KEY, PUSH_HABILITADO } from './lib/push-provider.js';
import { uploadMemoria, subirBufferACloudinary, eliminarDeCloudinarySiAplica } from './lib/upload.js';
import { verificarEstadoInstitucion, invalidarCacheGestorDB } from './lib/gestor-cache.js';
import { leerDbCacheado, guardarDbCache, invalidarDbCache, leerBlobInstitucion } from './lib/db-cache.js';
import { emitirTokenRestablecimiento, verificarYConsumirTokenRestablecimiento, hashPasswordServidor, verificarPasswordServidor, limpiarTokensRestablecimientoExpirados } from './lib/reset-tokens.js';
import { verificarFirmaWompi, verificarFirmaMercadoPago, verificarFirmaStripe, normalizarEstadoPago, parsearReferenciaPago, type ReferenciaPago } from './lib/pagos-webhooks.js';
import { cloudinaryConfigurado } from './lib/cloudinary.js';
import { enviarCorreoGeneral, correoGeneralConfigurado, smtpGeneralConfigurado } from './lib/email-general.js';
import { emailApiConfigurado, emailApiProveedor, enviarPorApiHttp } from './lib/email-http-provider.js';
import { sseClients, broadcastChange } from './lib/sync-bus.js';
import { registrarActividadPlataforma, iniciarKeepAliveInteligente, estadoActividadReciente } from './lib/keep-alive.js';
import { PRIMARY_MODEL, ALL_CANDIDATE_MODELS, llamarGeminiConResiliencia, generarContenidoConResiliencia, mensajeAmigablePorError } from './lib/gemini-config.js';
import * as infraTelemetry from './services/infraTelemetry.js';
import agentRouter from './routes/agent.js';
import * as ecosystemAgent from './services/ecosystemAgent.js';
// RONDA 40 — Blindaje JWT/servidor (ver src/lib/jwt-auth.ts para el porqué
// de un JWT HS256 artesanal en vez de la librería `jsonwebtoken`, que no
// está disponible en este entorno).
import { firmarJWT, verificarJWT, extraerBearer, rolBloqueadoParaNotas } from './lib/jwt-auth.js';
// Ronda 20: "bitácora de conflictos" propuesta en el checklist de la Ronda
// 19 — archivo nuevo y separado de routes/agent.js (ver el comentario en
// src/routes/sync-log.js sobre por qué no se tocó ese archivo).
import syncLogRouter from './routes/sync-log.js';

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
// ACCESO DE RESCATE DEL SÚPER ADMIN + BLOQUEO SERVIDOR K-12 (Ronda 4)
// ------------------------------------------------------------------
// Antes, el modo "Pantalla en Blanco" del portal K-12 (a diferencia del
// universitario) solo se revisaba en el navegador — nada impedía que
// alguien con conocimientos técnicos llamara directamente a
// GET/POST /api/inetis/db sin pasar por la pantalla de login. Ahora se
// revisa también AQUÍ, en el servidor (ver el gate agregado más abajo en
// esas dos rutas), usando la misma fuente de verdad (gestorDB.platforms)
// que ya usa el sistema universitario — vía la caché compartida en
// src/lib/gestor-cache.ts.
//
// Para que el Súper Admin nunca se autobloquee, existe un "token de
// rescate": un token firmado (HMAC, reutilizando DOC_SIGN_SECRET, igual
// que ya se hace para firmar boletines) que el cliente adjunta como
// cabecera "X-Rescate-Token" en cada petición a /api/inetis/db mientras
// esté en modo rescate. El servidor lo entrega solo si prueba CUALQUIERA
// de dos cosas:
//   (a) conoce la contraseña MAESTRA de rescate (RESCATE_SUPER_ADMIN_HASH,
//       variable de entorno — el atajo de teclado "super" en el frontend),
//   (b) conoce las credenciales REALES del Súper Admin, las mismas que ya
//       usa para entrar a su propio panel (gestorDB.superAdmin) — así,
//       iniciar sesión normalmente como Súper Admin y usar "🚀 Entrar" en
//       una institución bloqueada funciona sin pedir nada aparte.
// ============================================================

// Hash SHA-256 de la contraseña maestra de rescate. Por defecto coincide
// con la contraseña configurada en el frontend (ver comentario junto a
// _sha256Hex en 03-app-core.js) para que todo funcione sin configuración
// adicional — pero SE RECOMIENDA fijar esta variable de entorno en Render
// con el hash de una contraseña propia, distinta a la de fábrica y,
// preferiblemente, distinta también de la contraseña real del Súper Admin
// (defensa en profundidad: si una de las dos se filtra, la otra sigue
// protegida). Calcule el hash con:
//   node -e "console.log(require('crypto').createHash('sha256').update('SU_CONTRASEÑA').digest('hex'))"
const RESCATE_SUPER_ADMIN_HASH = (process.env.RESCATE_SUPER_ADMIN_HASH || '7010613a7e0b177b8fb237c038fbac1d8f0f3673479b2514dee2e5c66afd4d31').toLowerCase();

function _compararHashesSeguro(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(String(a || ''), 'hex');
    const bufB = Buffer.from(String(b || ''), 'hex');
    if (bufA.length !== bufB.length || !bufA.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// Replica en el servidor (Node) el mismo esquema PBKDF2 que ya usa el
// navegador (Web Crypto) para las contraseñas del Súper Admin/rector/
// docente — ver _hashPassword/_verificarPassword en 03-app-core.js.
// Formato guardado: "pbkdf2$<saltHex>$<hashHex>" (100.000 iteraciones,
// SHA-256, salida de 256 bits). Si la contraseña guardada no tiene ese
// formato, es una contraseña heredada sin cifrar — se compara tal cual,
// igual que ya hace el cliente.
function _verificarPasswordSuperAdminServidor(passwordIngresada: string, valorGuardado: string): boolean {
  try {
    if (!valorGuardado) return false;
    const esHash = typeof valorGuardado === 'string' && valorGuardado.indexOf('pbkdf2$') === 0 && valorGuardado.split('$').length === 3;
    if (!esHash) return passwordIngresada === valorGuardado;
    const partes = valorGuardado.split('$');
    const salt = Buffer.from(partes[1], 'hex');
    const derivado = crypto.pbkdf2Sync(passwordIngresada, salt, 100000, 32, 'sha256').toString('hex');
    return _compararHashesSeguro(derivado, partes[2]);
  } catch {
    return false;
  }
}

const RESCATE_TOKEN_VALIDEZ_MS = 12 * 60 * 60 * 1000; // 12 horas — igual que la sesión del sistema universitario
function _firmarRescate(payload: unknown): string {
  return crypto.createHmac('sha256', DOC_SIGN_SECRET || 'inseguro-configure-DOC_SIGN_SECRET').update(_jsonEstable(payload)).digest('hex');
}
function generarTokenRescate(): string {
  const payload = { exp: Date.now() + RESCATE_TOKEN_VALIDEZ_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return payloadB64 + '.' + _firmarRescate(payload);
}
function verificarTokenRescate(token: string): boolean {
  try {
    const [payloadB64, firma] = String(token || '').split('.');
    if (!payloadB64 || !firma) return false;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (_firmarRescate(payload) !== firma) return false;
    if (!payload.exp || Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}
function _tieneRescateValido(req: any): boolean {
  const token = req.headers['x-rescate-token'];
  return typeof token === 'string' && !!token && verificarTokenRescate(token);
}

// ============================================================
// NOTIFICACIONES PUSH (Web Push) — requiere VAPID_PUBLIC_KEY y
// VAPID_PRIVATE_KEY en el .env. Si no están configuradas, el envío
// de push simplemente se omite (no rompe el resto de la app).
// Generar un par nuevo con: npx web-push generate-vapid-keys
//
// Ronda 33: esta configuración VAPID y enviarPushParaNotificacion() se
// EXTRAJERON a src/lib/push-provider.ts (mismo patrón ya usado con
// sseClients/broadcastChange en src/lib/sync-bus.ts) para que
// src/routes/etc.ts también pueda enviar push a un docente específico
// (enviarPushADocente()) sin crear una dependencia circular con este
// archivo. El comportamiento observable no cambió: misma librería
// 'web-push', mismas variables de entorno, mismo "nunca lanza".
// ============================================================

// ============================================================
// A01 · CONFIGURACIÓN EXPRESS, CORS Y MIDDLEWARE
// ============================================================

const app = express();
// "trust proxy" = 1 confía en el PRIMER salto delante del servidor (el
// balanceador/reverse-proxy de Render, Railway, Heroku, etc.), que es
// exactamente el escenario de este despliegue. Sin esto, Express usa su
// valor por defecto (false) y express-rate-limit (usado más abajo para
// limitar /api/inetis/email, /api/inetis/rescate, etc.) lanza en cada
// request un error "ERR_ERL_UNEXPECTED_X_FORWARDED_FOR"
// porque ve la cabecera X-Forwarded-For que SÍ pone el proxy de Render
// pero Express le dice que no debería existir — no rompe el envío de
// correos en sí, pero ensucia los logs y puede hacer que el rate-limit
// identifique a todos los usuarios como una sola IP (la del proxy) en
// lugar de la IP real de cada visitante. Con "1" (en vez de "true"),
// Express confía solo en el primer proxy de la cadena, que es lo correcto
// y seguro aquí (no se debe usar "true" en producción porque eso confiaría
// en cualquier cabecera X-Forwarded-For que mande el propio cliente).
app.set('trust proxy', 1);

// ============================================================
// "6 pilares de rendimiento" — Pilar 1: Keep-Alive 100% en RAM.
// ------------------------------------------------------------
// Registrado aquí, ANTES de CORS, compresión, parseo de body, rate-limit
// o cualquier otra cosa, a propósito: así ningún middleware (ni siquiera
// uno tan liviano como express-rate-limit) se ejecuta antes de responder.
// No toca el ORM, el driver de Postgres, Neon, ni ninguna verificación de
// autenticación — es una constante fija devuelta directamente desde
// memoria. Pensado para un servicio externo de Keep-Alive (UptimeRobot y
// similares) que hace ping cada pocos minutos solo para evitar que Render
// duerma la instancia por el plan gratuito, sin gastar ni una sola
// consulta ni un solo milisegundo de cómputo de Neon en cada ping.
// (Ya existía "/api/health" — más abajo, en la sección de rutas — con el
// mismo espíritu; "/api/healthcheck" se añade con el nombre exacto
// solicitado y en la posición más temprana posible, sin sustituir el
// endpoint anterior para no romper nada que ya lo esté usando.)
// ============================================================
app.get('/api/healthcheck', (_req, res) => {
  res.status(200).json({ ok: true, status: 'up', ts: new Date().toISOString() });
});

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

// "verify" captura el Buffer del cuerpo crudo, sin re-serializar, en
// req.rawBody — lo necesita ÚNICAMENTE la verificación de firma de Stripe
// (POST /api/payments/webhook/stripe), que exige comparar contra los bytes
// EXACTOS recibidos (si se reconstruye el JSON a partir del objeto ya
// parseado, la firma nunca coincide). Para el resto de rutas esto no tiene
// ningún efecto — es una referencia adicional al mismo buffer que
// express.json() ya leyó, no una lectura ni un costo extra.
app.use(express.json({ limit: '50mb', verify: (req: any, _res, buf: Buffer) => { req.rawBody = buf; } }));

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
// ── PILAR 2 (rendimiento/costos): limitadores dedicados y más estrictos ────
// para rutas sensibles específicas, ADEMÁS del limitadorGeneral de arriba
// (ambos corren — este es un límite extra, más ajustado, solo para estas
// rutas puntuales). Objetivo: frenar bots que intenten "email bombing" con
// /send-email, o barridos automatizados sobre la consulta pública de
// boletines, sin afectar el uso normal de la plataforma.
//
// Nota sobre "/api/auth/login": ese endpoint literal no existe en este
// proyecto — el login real (K-12 y el que emite el token que usa después
// el sistema universitario en /api/university/auth/token) ocurre en
// POST /api/inetis/db, que YA está cubierto por limitadorLogin desde 2024
// (ver arriba). No se duplica aquí para no aplicar dos límites distintos
// al mismo endpoint.
const limitadorEmail = rateLimit({
  windowMs: 60 * 1000,
  limit: 5, // 5 correos por minuto por IP — suficiente para un usuario legítimo reintentando, insuficiente para bombardear una bandeja de entrada o agotar la cuota del proveedor de correo
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas solicitudes de envío de correo en poco tiempo. Espere un minuto e intente de nuevo.' },
});
const limitadorBoletinPublico = rateLimit({
  windowMs: 60 * 1000,
  limit: 20, // 20 consultas por minuto por IP — cómodo para un padre/estudiante consultando varias veces, restrictivo para un bot que intente adivinar códigos o barrer consultas
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas consultas en poco tiempo. Espere un momento e intente de nuevo.' },
});
// Limitador estricto para el endpoint de rescate del Súper Admin: es, por
// diseño, el único lugar de todo el sistema K-12 donde se prueba una
// contraseña contra el servidor en un endpoint público — sin este límite,
// alguien podría intentar adivinarla por fuerza bruta.
const limitadorRescate = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos en poco tiempo. Espere un momento e intente de nuevo.' },
});
app.use('/api/inetis/db', limitadorLogin);
app.use('/api/inetis/send-email', limitadorEmail);
app.use('/api/inetis/boletin/verificar', limitadorBoletinPublico);
app.use('/api/inetis/consulta-rapida', limitadorBoletinPublico); // cubre también /api/inetis/consulta-rapida/generar (mismo prefijo)
app.use('/api/inetis/rescate', limitadorRescate);
// Mismo limitador estricto que /api/inetis/rescate: el nuevo endpoint de
// abajo (POST /api/inetis/email-status/enviar-prueba) también exige una
// contraseña para usarse, así que merece la misma protección contra
// fuerza bruta.
app.use('/api/inetis/email-status', limitadorRescate);
// "4 pilares de autonomía" — Pilar 1: mismo espíritu que limitadorEmail (este
// flujo también termina enviando un correo) — evita que alguien intente
// pedir restablecimientos en cadena para agotar la cuota del proveedor de
// correo, o probar usuarios al voleo contra /confirmar.
app.use('/api/inetis/auth/restablecer', limitadorEmail);
// "4 pilares de autonomía" — Pilar 1: mismo espíritu que limitadorRescate —
// un código de invitación de 6 dígitos tiene un espacio de búsqueda
// pequeño (hasta 900,000 combinaciones); sin límite de intentos por
// minuto, alguien podría intentar adivinarlo por fuerza bruta.
app.use('/api/inetis/auth/invitacion', limitadorRescate);
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

// RONDA 47 (histórico) — el reporte del usuario en su momento fue que el
// sistema intentaba primero contra 'gemini-2.5-flash' y 'gemini-1.5-flash'
// (ambos con 404) antes de llegar a un modelo que sí respondía. Esa ronda
// retiró 'gemini-1.5-flash' y dejó 'gemini-2.5-flash' como primario.
//
// RONDA 48 — UNA RONDA DESPUÉS, el mismo usuario reportó que ahora es
// 'gemini-2.5-flash' el que falla intermitentemente, y sugirió volver a
// 'gemini-1.5-flash'. Este vaivén de nombres confirma que perseguir "el
// nombre correcto" ronda tras ronda no es sostenible — ni este entorno ni
// quien atienda la próxima ronda puede verificar en vivo contra la API de
// Google cuál modelo responde 200 en el momento exacto en que se lee este
// comentario. La solución de fondo (ver `src/lib/gemini-config.ts`, con la
// justificación completa y las fuentes de documentación consultadas) es
// centralizar la lista de candidatos ahí, con un wrapper de resiliencia
// (retry + backoff exponencial para 429/503, fallback automático de
// modelo para 404) reutilizado por TODOS los puntos de instanciación de
// Gemini del sistema — 'gemini-1.5-flash' sigue sin reintroducirse (familia
// confirmada retirada, ver comentario de cabecera de gemini-config.ts).
// `PRIMARY_MODEL`/`ALL_CANDIDATE_MODELS` ahora se importan desde ahí — este
// archivo ya no declara su propia lista de modelos.

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

// ════════════════════════════════════════════════════════════════════════════
// RONDA 34/35 — Switch "Agente IA - Consultas Base de Datos Neon"
// (ENABLE_AI_NEON_QUERIES). Investigación de la Ronda 34 (documentada en el
// checklist): el Asistente Adán (endpoints de abajo) NO hace ninguna
// consulta SQL propia ni Function Calling en vivo contra Neon dentro de la
// conversación — el "contexto" (numEstudiantes, grados, asignaturas, etc.)
// llega YA CALCULADO desde el frontend. El único componente con Function
// Calling real contra Neon es el Auditor del Ecosistema — ver Switch B
// (ENABLE_AI_ECOSYSTEM_AUDITOR) en src/services/ecosystemAgent.js, que ya
// queda correctamente gateado por este MISMO flag dentro de runFullAudit()
// (rama `if (genAI && neonViaIaHabilitado)`) sin ningún cambio en esta ronda.
//
// AJUSTE DE LA RONDA 35 (pedido explícito del usuario, corrige el criterio
// de la Ronda 34): el primer criterio ("¿el contexto trae datos numéricos
// de la institución?") bloqueaba de más — una planeación de clase o una
// actividad interactiva TAMBIÉN llegan con grados/asignaturas en su
// contexto, así que con el switch apagado se estaba bloqueando por error
// una utilidad pedagógica de aula que el usuario pidió EXPLÍCITAMENTE
// mantener activa. El nuevo criterio, estructural y verificable, es
// `context.gestorMode === true`: la ÚNICA vía por la que estos 3
// endpoints conversan sobre algo que no es "un docente/rector pidiendo
// ayuda para SU institución" es el chat del panel Superadmin en modo
// "Gestor Multi-Plataforma" (`gestorIAenviar()` en 03-app-core.js, la
// única llamada de todo el frontend que envía `gestorMode:true`) — el
// único lugar donde alguien podría plausiblemente pedirle a Adán un
// "análisis transversal" o algo parecido a una auditoría global del
// ecosistema en lenguaje natural. Toda otra conversación (planeaciones,
// actividades/dinámicas, dudas de un docente, extracción de descriptores
// de un archivo, etc.) NUNCA pasa `gestorMode:true` y por lo tanto nunca
// se ve afectada por este switch, sin importar cuántos datos institucionales
// traiga su contexto. El informe psicopedagógico individual
// (`/ai/psicopedagogico`) se excluyó por completo de este switch (ver más
// abajo): por diseño es siempre un reporte de aula/orientación, nunca una
// operación de infraestructura global.
const MENSAJE_PAUSA_CONSULTA_DB_IA = 'El servicio de consulta asistida a la base de datos se encuentra temporalmente pausado por mantenimiento.';

function _esConsultaDeAuditoriaGlobal(context: Record<string, unknown> | undefined | null): boolean {
  const ctx = context || {};
  return ctx.gestorMode === true;
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

  // ── Ronda 12, Sección 4: prompt restringido para Estudiante/Acudiente ──
  // El widget de Adán ahora es visible para estos dos roles (antes solo
  // Docente/Directivo/Gestor lo veían — ver iaInjectWidget()/renderApp()
  // en 03-app-core.js). Como NO existe autenticación en
  // POST /api/inetis/ai/chat (context.rol viaja del cliente sin firmar),
  // esta restricción de prompt es una mitigación de UX/alcance, no un
  // control de acceso real — hoy no hay riesgo estructural adicional
  // porque esta ruta no lee la base de datos de la institución por su
  // cuenta (solo usa lo que ya viene en "context"), pero aun así se le
  // instruye explícitamente a Adán que nunca actúe como si tuviera
  // permisos administrativos ni exponga datos de otros estudiantes.
  if (rol === 'estudiante' || rol === 'padre') {
    const paraQuien = rol === 'estudiante' ? 'el propio estudiante' : 'el padre/madre o acudiente de un estudiante';
    return `Eres Adán, el Asistente de Soporte y Tutoría de Gestor Académico YC para ${nombreInst}.

USUARIO ACTIVO:
- Nombre: ${usuario}
- Rol en el sistema: ${rolLabel} (estás hablando con ${paraQuien})
- Módulo activo: ${modulo}
- Contexto del sistema: ${ctxSistema}

TU PROPÓSITO CON ESTE USUARIO:
1. Explicar cómo usar la plataforma (dónde ver notas, horarios, asistencia, boletines, cómo descargar documentos, cómo contactar al colegio, etc.)
2. Apoyo de tutoría académica: resolver dudas de materias, explicar temas, ayudar a estudiar, generar ejercicios de práctica y planes de estudio personalizados
3. Orientación y contención emocional básica en temas escolares (manejo del estrés académico, hábitos de estudio, motivación) — SIN reemplazar nunca a un psicólogo, orientador escolar o profesional de salud mental; si detectas señales de una crisis o de que la persona necesita ayuda profesional, recomienda hablar con el orientador del colegio, un adulto de confianza o un profesional de salud mental
4. Responder preguntas generales de cultura, tareas y temas educativos como lo haría cualquier asistente de IA útil

RESTRICCIÓN DE SEGURIDAD — CUMPLE ESTO SIEMPRE, SIN EXCEPCIÓN:
- NUNCA actúes como si pudieras consultar, modificar, calificar o exportar planillas de calificaciones, asistencia, observador u otra información administrativa/docente, aunque el usuario lo pida o insista. Explica que esa función es exclusiva del personal docente/administrativo.
- NUNCA muestres, inventes ni "recuerdes" datos, notas, asistencia u observaciones de OTRO estudiante distinto al propio (o al hijo/a del acudiente que está escribiendo). Si te piden datos de otro estudiante, recházalo con amabilidad y explica que esa información es privada.
- NUNCA generes ni simules credenciales, códigos de invitación, enlaces de restablecimiento de contraseña de otras personas, ni te hagas pasar por el sistema para "aprobar" matrículas, pagos o trámites — esas acciones solo las realiza el sistema o el personal autorizado.
- Si detectas que la pregunta requiere acceso a datos administrativos que no tienes, dilo claramente y sugiere contactar al colegio (rectoría/secretaría) en vez de inventar una respuesta.
- Puedes y debes seguir ayudando con TODO lo demás (tutoría, dudas académicas, uso de la plataforma, apoyo emocional básico, cultura general) sin restricciones adicionales.

INSTRUCCIONES DE ESTILO:
1. Responde en español colombiano, cálido, cercano y claro — recuerda que puede estar hablando con un menor de edad o con su acudiente
2. Para material de estudio (resúmenes, ejercicios, guías), usa formato bien estructurado con markdown
3. Sé conciso cuando la pregunta es simple, y detallado cuando se trata de explicar un tema académico
4. Nunca uses lenguaje que asuma que el usuario tiene permisos administrativos`;
  }

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
// "sseClients"/"broadcastChange" ahora viven en src/lib/sync-bus.ts (mismo
// mecanismo de siempre, solo reubicado) para que el nuevo AGENTE AUTÓNOMO Y
// AUDITOR SUPREMO DEL ECOSISTEMA (src/services/ecosystemAgent.js) también
// pueda forzar un aviso de sincronización con su herramienta
// `triggerSystemSync`, sin crear una dependencia circular con este archivo.

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

// ── KEEP-ALIVE INTELIGENTE (Render) ─────────────────────────────────────────
// Este endpoint ya existía (health-check simple); se amplía para que el
// propio mecanismo de auto-ping adaptativo (src/lib/keep-alive.ts) y
// cualquier monitor externo (UptimeRobot, cron-job.org, etc.) puedan ver,
// además de "ok:true", si hubo actividad reciente en la plataforma — sin
// romper compatibilidad con quien solo revisa "ok"/código 200. Se mantiene
// deliberadamente liviano (sin consultar Neon) para que sirva también como
// el propio "ping" que mantiene despierto el contenedor de Render.
app.get('/api/health', (_req, res) => {
  const estado = estadoActividadReciente();
  res.json({ ok: true, ts: new Date().toISOString(), ...estado });
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

// ============================================================
// POST /api/inetis/rescate/verificar — emite el "token de rescate" del
// Súper Admin (ver el bloque de comentarios grande más arriba, junto a
// RESCATE_SUPER_ADMIN_HASH). Acepta CUALQUIERA de dos pruebas:
//   { hashRescate } — hash SHA-256 de la contraseña maestra de rescate
//                      (atajo de teclado "super" en cualquier pantalla)
//   { u, p }         — las credenciales reales del Súper Admin (mismo
//                      "usuario"/"contraseña" de gestorDB.superAdmin),
//                      para el flujo transparente al iniciar sesión
// ============================================================
app.post('/api/inetis/rescate/verificar', async (req, res) => {
  try {
    const { hashRescate, u, p } = req.body as { hashRescate?: string; u?: string; p?: string };
    let autorizado = false;
    if (hashRescate && typeof hashRescate === 'string') {
      autorizado = _compararHashesSeguro(hashRescate.toLowerCase(), RESCATE_SUPER_ADMIN_HASH);
    }
    if (!autorizado && u && p) {
      const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
      const gestorDB: any = rows[0]?.value || null;
      const superAdmin = gestorDB?.superAdmin;
      if (superAdmin && String(u) === String(superAdmin.u) && _verificarPasswordSuperAdminServidor(String(p), String(superAdmin.p || ''))) {
        autorizado = true;
      }
    }
    if (!autorizado) return res.status(401).json({ ok: false, error: 'Credenciales incorrectas.' });
    return res.json({ ok: true, token: generarTokenRescate() });
  } catch (e) {
    console.error('POST /api/inetis/rescate/verificar', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RONDA 40 — POST /api/auth/login: primer endpoint de servidor que valida
// credenciales K-12 y EMITE un JWT firmado con la identidad/institución/rol
// que el propio servidor determinó — no lo que el cliente afirme.
// ------------------------------------------------------------------------------
// CONTEXTO (ver también CHECKLIST_DESPLIEGUE.md, sección Ronda 40): antes de
// esta ronda no existía NINGÚN endpoint de login de servidor para el núcleo
// K-12 — `doLoginInstitucional()` (frontend) buscaba la credencial
// directamente en el blob JSON de cada institución activa, descargado
// completo al navegador. Esta ronda NO reemplaza ese mecanismo (habría sido
// un cambio de arquitectura mucho más grande, riesgoso para un sistema en
// producción) — lo COMPLEMENTA: el frontend sigue determinando a qué
// institución entrar exactamente igual que antes, y AHORA, además, llama a
// este endpoint (pasándole `sk`, `u`, `p`) para obtener un JWT que a partir
// de ahí acompaña a las peticiones de escritura sensibles (ver
// verificarJWT()/rolBloqueadoParaNotas() más abajo, aplicados en
// POST /api/inetis/notas/guardar-fila).
//
// Esta ruta vuelve a validar la contraseña DEL LADO DEL SERVIDOR contra el
// mismo blob de la institución (mismo esquema PBKDF2 que ya usa el
// navegador — ver verificarPasswordServidor(), reutilizada tal cual de
// src/lib/reset-tokens.ts, sin duplicar esa lógica) — el rol que queda
// firmado dentro del JWT es el que el SERVIDOR encontró en `platDB.users`/
// `platDB.ests`, nunca un valor que el cliente simplemente declare.
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  try {
    const { sk, u, p } = req.body as { sk?: string; u?: string; p?: string };
    if (!sk || !u || !p) return res.status(400).json({ error: 'Faltan datos (sk, u, p).' });
    const estado = await verificarEstadoInstitucion(sk);
    if (!estado.ok) return res.status(403).json({ error: estado.motivo });
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
    if (!rows.length) return res.status(404).json({ error: 'Institución no encontrada.' });
    const platDB: any = rows[0].value || {};
    const uStr = String(u), pStr = String(p);

    // Mismo orden de prioridad server-side que ya usa doLoginInstitucional()
    // en el cliente (Ronda 39) — se documenta aquí en vez de solo en el
    // frontend porque esta es ahora la fuente de verdad que queda firmada.
    // 1) Personal institucional (cualquier rol de staff), usuario exacto.
    const staffUser = (platDB.users || []).find((x: any) => x.u === uStr && x.r !== 'elecciones');
    if (staffUser && verificarPasswordServidor(pStr, staffUser.p)) {
      const token = firmarJWT({ sub: uStr, sk, rol: staffUser.r, rolEspecifico: staffUser.rolEspecifico || undefined, nombre: staffUser.n || '' });
      return res.json({ ok: true, token, rol: staffUser.r, rolEspecifico: staffUser.rolEspecifico || null });
    }
    // 2) Módulo de Elecciones.
    if (uStr === 'elecciones') {
      const eu = (platDB.users || []).find((x: any) => x.r === 'elecciones');
      if (eu && verificarPasswordServidor(pStr, eu.p)) {
        const token = firmarJWT({ sub: 'elecciones', sk, rol: 'elecciones', nombre: 'MÓDULO ELECCIONES' });
        return res.json({ ok: true, token, rol: 'elecciones', rolEspecifico: null });
      }
      if (!eu && pStr === 'inetis2026') {
        const token = firmarJWT({ sub: 'elecciones', sk, rol: 'elecciones', nombre: 'MÓDULO ELECCIONES' });
        return res.json({ ok: true, token, rol: 'elecciones', rolEspecifico: null });
      }
    }
    // 3) Estudiante (usuario = clave = su propio documento).
    const est = (platDB.ests || []).find((e: any) => String(e.numDoc || '').trim() === uStr && String(e.numDoc || '').trim() === pStr);
    if (est) {
      const token = firmarJWT({ sub: uStr, sk, rol: 'estudiante', nombre: est.n || '', estId: est.id });
      return res.json({ ok: true, token, rol: 'estudiante', rolEspecifico: null });
    }
    // 4) Acudiente (usuario = documento del acudiente, clave = documento del estudiante).
    const estAcud = (platDB.ests || []).find((e: any) => String(e.numDocAcud || '').trim() === uStr && String(e.numDoc || e.numDocAcud || '').trim() === pStr);
    if (estAcud) {
      const token = firmarJWT({ sub: uStr, sk, rol: 'padre', nombre: estAcud.acudiente || 'ACUDIENTE', estId: estAcud.id });
      return res.json({ ok: true, token, rol: 'padre', rolEspecifico: null });
    }
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  } catch (e) {
    console.error('POST /api/auth/login', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/inetis/db', async (req, res) => {
  try {
    const sk = String(req.query.sk || '');
    if (!sk) return res.status(400).json({ error: 'sk requerido' });
    // Candado de "Pantalla en Blanco"/institución bloqueada — ver el
    // bloque de comentarios grande más arriba. Antes esto solo se
    // revisaba en el navegador; ahora también aquí, salvo que la petición
    // traiga un token de rescate válido (Súper Admin).
    if (!_tieneRescateValido(req)) {
      const estado = await verificarEstadoInstitucion(sk);
      if (!estado.ok) {
        return res.status(403).json({ error: estado.motivo, institucionPausada: !!estado.institucionPausada, pantallaBlancaActiva: !!estado.pantallaBlancaActiva });
      }
    }
    // PILAR 2 (rendimiento): caché en memoria de 5s — ver src/lib/db-cache.ts.
    // Evita golpear Neon en cada sincronización periódica cuando nada cambió.
    let filaValue: any;
    let filaUpdatedAt: Date | null;
    let filaExiste: boolean;
    const cacheada = leerDbCacheado(sk);
    if (cacheada) {
      filaValue = cacheada.value;
      filaUpdatedAt = cacheada.updatedAt;
      filaExiste = cacheada.existe;
    } else {
      const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
      filaExiste = rows.length > 0;
      filaValue = filaExiste ? rows[0].value : null;
      filaUpdatedAt = filaExiste ? rows[0].updatedAt : null;
      guardarDbCache(sk, filaValue, filaUpdatedAt, filaExiste);
    }
    if (!filaExiste) return res.json({ data: null, version: null });
    const version = filaUpdatedAt ? filaUpdatedAt.toISOString() : null;
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
    return res.json({ data: filaValue, version });
  } catch (e) {
    console.error('GET /api/inetis/db', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ════════════════════════════════════════════════════════════════════════
// RONDA 44 — DIMENSIÓN 1.2 (ADAPTADA, decisión de ingeniería explícita):
// el prompt del usuario pide "eliminar el JSON monolítico" y reemplazarlo
// por endpoints REST granulares respaldados por TABLAS RELACIONALES por
// nota. Eso NO se hizo en esta ronda — sería migrar el almacenamiento de
// las 43 rondas anteriores (planillas, observador, asistencia, actas, TODO
// vive en el blob de kv_store) a un modelo relacional nuevo, sin batería de
// pruebas de integración real contra Postgres en este entorno, con
// altísimo riesgo de romper producción. Se adoptó, en cambio, el enfoque
// CONSERVADOR y ADITIVO que pidió el coordinador: estos 2 endpoints GET
// siguen leyendo del MISMO blob JSON (vía la misma caché de 5s de
// GET /api/inetis/db), pero devuelven solo el FRAGMENTO pedido — reducen
// el payload de RED para quien solo necesita, por ejemplo, la lista de
// estudiantes de un grado, sin tocar el almacenamiento subyacente ni el
// resto de las 43 rondas anteriores. Documentado también en
// CHECKLIST_DESPLIEGUE.md, Ronda 44, Dimensión 1.
// ════════════════════════════════════════════════════════════════════════
async function _leerBlobInstitucionParaFragmento(sk: string): Promise<any | null> {
  const cacheada = leerDbCacheado(sk);
  if (cacheada) return cacheada.existe ? cacheada.value : null;
  const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
  const existe = rows.length > 0;
  const value = existe ? rows[0].value : null;
  guardarDbCache(sk, value, existe ? rows[0].updatedAt : null, existe);
  return value;
}

// ════════════════════════════════════════════════════════════════════════
// RONDA 45 — DIMENSIÓN 1, FASE 1: los 3 endpoints de abajo ahora intentan
// leer PRIMERO de las tablas relacionales — pero SOLO para una institución
// (sk) que ya tiene una fila en `migracion_relacional_notas` (el
// "interruptor" de institución backfileada por completo, ver
// scripts/migrar-notas-a-relacional.ts y el comentario junto a esa tabla
// en src/db/schema.ts). Mientras esa fila no exista, se usa el mismo
// camino de la Ronda 44 (leer el blob completo, recortar el fragmento) —
// el dual-write incremental de guardar-fila por sí solo NUNCA activa el
// camino relacional, justamente para no devolver listas incompletas.
//
// DIMENSIÓN 3 (ETag): las 3 respuestas ahora incluyen un header ETag
// (hash SHA-1 del cuerpo JSON exacto que se envía) y honran
// `If-None-Match` con un 304 sin cuerpo — funciona igual de bien por
// cualquiera de los 2 caminos (relacional o blob), porque el ETag se
// calcula sobre el resultado final, no sobre la fuente.
function _responderConETag(req: express.Request, res: express.Response, payload: any): express.Response {
  const cuerpo = JSON.stringify(payload);
  const etag = '"' + crypto.createHash('sha1').update(cuerpo).digest('hex') + '"';
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }
  res.setHeader('ETag', etag);
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).send(cuerpo);
}

async function _institucionYaMigradaRelacional(sk: string): Promise<boolean> {
  try {
    await _asegurarSchemaRelNotas();
    const filas = await db.select().from(migracionRelacionalNotas).where(eq(migracionRelacionalNotas.sk, sk));
    return filas.length > 0;
  } catch {
    return false;
  }
}

// GET /api/grados?sk=... — lista liviana de grados (sin estudiantes ni notas).
app.get('/api/grados', async (req, res) => {
  try {
    const sk = String(req.query.sk || '');
    if (!sk) return res.status(400).json({ error: 'sk requerido' });
    if (await _institucionYaMigradaRelacional(sk)) {
      const filas = await db.select({ grado: estudiantesRel.grado }).from(estudiantesRel).where(eq(estudiantesRel.sk, sk));
      const gradosUnicos = [...new Set(filas.map((f) => f.grado).filter(Boolean))];
      return _responderConETag(req, res, { grados: gradosUnicos.map((n) => ({ n })), fuente: 'relacional' });
    }
    const blob = await _leerBlobInstitucionParaFragmento(sk);
    if (!blob) return _responderConETag(req, res, { grados: [], fuente: 'blob' });
    return _responderConETag(req, res, { grados: (blob.grados || []).map((g: any) => ({ n: g.n })), fuente: 'blob' });
  } catch (e) {
    console.error('GET /api/grados', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/grados/:id/estudiantes?sk=... — SOLO los estudiantes de un grado,
// con sus campos básicos (nombre, documento, id) — NO su blob completo de
// notas/observador/ficha, que sigue viviendo en GET /api/inetis/db para
// quien de verdad lo necesite completo.
app.get('/api/grados/:id/estudiantes', async (req, res) => {
  try {
    const sk = String(req.query.sk || '');
    const grado = decodeURIComponent(req.params.id || '');
    if (!sk || !grado) return res.status(400).json({ error: 'sk y grado (id) requeridos' });
    if (await _institucionYaMigradaRelacional(sk)) {
      const filas = await db.select().from(estudiantesRel).where(and(eq(estudiantesRel.sk, sk), eq(estudiantesRel.grado, grado)));
      const estudiantes = filas.map((f) => ({ id: f.estIdOrigen, n: f.nombre, numDoc: f.numDoc, estadoMatricula: f.estadoMatricula }));
      return _responderConETag(req, res, { estudiantes, fuente: 'relacional' });
    }
    const blob = await _leerBlobInstitucionParaFragmento(sk);
    if (!blob) return _responderConETag(req, res, { estudiantes: [], fuente: 'blob' });
    const estudiantes = (blob.ests || [])
      .filter((e: any) => e.g === grado)
      .map((e: any) => ({ id: e.id, n: e.n, numDoc: e.numDoc || '', estadoMatricula: e.estadoMatricula || 'activo' }));
    return _responderConETag(req, res, { estudiantes, fuente: 'blob' });
  } catch (e) {
    console.error('GET /api/grados/:id/estudiantes', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/grados/:id/materias/:materiaId/notas?sk=... — SOLO las notas de
// UNA materia/carga (`cId`) para el grado dado, en todos los periodos — el
// fragmento exacto que necesita, por ejemplo, la pantalla de Planilla, sin
// arrastrar el resto de materias/estudiantes/módulos de la institución.
app.get('/api/grados/:id/materias/:materiaId/notas', async (req, res) => {
  try {
    const sk = String(req.query.sk || '');
    const grado = decodeURIComponent(req.params.id || '');
    const materiaId = req.params.materiaId;
    if (!sk || !grado || !materiaId) return res.status(400).json({ error: 'sk, grado (id) y materiaId requeridos' });
    if (await _institucionYaMigradaRelacional(sk)) {
      const filasEst = await db.select().from(estudiantesRel).where(and(eq(estudiantesRel.sk, sk), eq(estudiantesRel.grado, grado)));
      const filasCal = await db.select().from(calificacionesRel).where(and(eq(calificacionesRel.sk, sk), eq(calificacionesRel.cIdOrigen, String(materiaId))));
      const notasPorEst = new Map<string, Record<string, any>>();
      for (const c of filasCal) {
        if (!notasPorEst.has(c.estIdOrigen)) notasPorEst.set(c.estIdOrigen, {});
        notasPorEst.get(c.estIdOrigen)![c.periodo] = c.notas;
      }
      const notas = filasEst.map((f) => ({ estId: f.estIdOrigen, n: f.nombre, notas: notasPorEst.get(f.estIdOrigen) || {} }));
      return _responderConETag(req, res, { notas, fuente: 'relacional' });
    }
    const blob = await _leerBlobInstitucionParaFragmento(sk);
    if (!blob) return _responderConETag(req, res, { notas: [], fuente: 'blob' });
    const notas = (blob.ests || [])
      .filter((e: any) => e.g === grado)
      .map((e: any) => ({ estId: e.id, n: e.n, notas: (e.nts && e.nts[materiaId]) || {} }));
    return _responderConETag(req, res, { notas, fuente: 'blob' });
  } catch (e) {
    console.error('GET /api/grados/:id/materias/:materiaId/notas', e);
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
    invalidarDbCache(sk); // Pilar 2: que el borrado se refleje de inmediato, sin esperar el TTL de la caché
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
// RONDA 40 — defensa en profundidad para la clasificación granular del
// Observador: como este endpoint recibe el BLOB COMPLETO de la institución
// (no una fila aislada como guardar-fila), la única forma de detectar "un
// Tutor PTA intentó crear una anotación DISCIPLINARIA/CONVIVENCIAL" es
// comparar las observaciones NUEVAS contra las que ya existían antes de
// este guardado. Se compara por firma de contenido (estudiante+periodo+
// docente+fecha+texto+tipo) en vez de por índice de arreglo, porque el
// cliente puede reordenar o eliminar observaciones en el mismo guardado sin
// que eso sea, por sí mismo, sospechoso.
function _firmaObs(o: any): string {
  return [o?.per, o?.doc, o?.fecha, o?.txt, o?.tipo_anotacion].map(v => String(v ?? '')).join('\u0001');
}
function _tieneAnotacionDisciplinariaNuevaDeTutorPTA(dataNueva: any, dataVieja: any): boolean {
  try {
    const estsViejos: any[] = (dataVieja && dataVieja.ests) || [];
    const firmasViejasPorEst = new Map<string, Set<string>>();
    for (const e of estsViejos) {
      firmasViejasPorEst.set(String(e.id), new Set((e.observaciones || []).map(_firmaObs)));
    }
    const estsNuevos: any[] = (dataNueva && dataNueva.ests) || [];
    for (const e of estsNuevos) {
      const firmasViejas = firmasViejasPorEst.get(String(e.id)) || new Set<string>();
      for (const o of (e.observaciones || [])) {
        if (firmasViejas.has(_firmaObs(o))) continue; // ya existía: no es una anotación nueva de este guardado
        if (o && (o.tipo_anotacion === 'DISCIPLINARIA' || o.tipo_anotacion === 'CONVIVENCIAL')) return true;
      }
    }
    return false;
  } catch {
    return false; // ante cualquier forma de dato inesperada, no se bloquea el guardado (evitar falsos positivos que tumben el autoguardado de toda la institución)
  }
}

app.post('/api/inetis/db', async (req, res) => {
  try {
    const { sk, data, baseVersion, actorRolEspecifico } = req.body as { sk: string; data: unknown; baseVersion?: string | null; actorRolEspecifico?: string };
    if (!sk) return res.status(400).json({ error: 'sk requerido' });
    // Mismo candado que en el GET de arriba — ver comentarios ahí. Se
    // repite la verificación aquí porque este es un endpoint aparte: leer
    // los datos de una institución bloqueada y GUARDAR datos nuevos son
    // dos acciones distintas, y ambas deben quedar cubiertas.
    if (!_tieneRescateValido(req)) {
      const estado = await verificarEstadoInstitucion(sk);
      if (!estado.ok) {
        return res.status(403).json({ error: estado.motivo, institucionPausada: !!estado.institucionPausada, pantallaBlancaActiva: !!estado.pantallaBlancaActiva });
      }
      // Ronda 13, punto 2: congela la escritura si la suscripción SaaS
      // venció y ya pasó el periodo de gracia — ver verificarSuscripcionSaas()
      // para el porqué de este alcance (bloquea POST, no GET) y por qué NO
      // afecta a instituciones que no usan esta facturación automática.
      const estadoSuscripcion = await verificarSuscripcionSaas(sk);
      if (!estadoSuscripcion.ok) {
        return res.status(402).json({ error: estadoSuscripcion.motivo, suscripcionVencida: true });
      }
    }

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

    // RONDA 40 — Tutor PTA no puede crear anotaciones DISCIPLINARIA/
    // CONVIVENCIAL en el Observador (ver _tieneAnotacionDisciplinariaNuevaDeTutorPTA
    // arriba para el porqué de comparar por firma de contenido). Solo se paga
    // el costo de esta lectura extra cuando el propio cliente se identifica
    // como Tutor PTA — para cualquier otro guardado (la inmensa mayoría del
    // tráfico de este endpoint) el comportamiento y el rendimiento quedan
    // exactamente iguales a antes de esta ronda.
    if (actorRolEspecifico === 'Tutor PTA') {
      const existingParaObs = await db.select().from(kvStore).where(eq(kvStore.key, sk));
      const dataVieja = existingParaObs.length ? existingParaObs[0].value : null;
      if (_tieneAnotacionDisciplinariaNuevaDeTutorPTA(data, dataVieja)) {
        return res.status(403).json({ error: 'El rol Tutor PTA no tiene permiso para registrar anotaciones de tipo DISCIPLINARIA o CONVIVENCIAL en el Observador del Estudiante.' });
      }
    }

    // RONDA 44 — DIMENSIÓN 11.c: se toma una instantánea de `ests` ANTES de
    // sobrescribir, para poder diferenciar después qué estudiantes
    // realmente cambiaron (reindexación incremental) en vez de
    // resincronizar la institución completa contra el índice de red.
    const _estsAntesDelGuardado = leerDbCacheado(sk)?.value?.ests;
    const nowTs = new Date();
    await db
      .insert(kvStore)
      .values({ key: sk, value: data as any, updatedAt: nowTs })
      .onConflictDoUpdate({
        target: kvStore.key,
        set: { value: data as any, updatedAt: nowTs },
      });
    // Pilar 2: en vez de solo invalidar, se refresca la caché ya con el valor
    // recién guardado — así el propio dispositivo que guardó (y cualquier otro
    // que sincronice en los próximos segundos) recibe el dato correcto sin
    // tener que esperar ni volver a golpear Neon.
    guardarDbCache(sk, data, nowTs, true);
    broadcastChange(sk);
    // KEEP-ALIVE INTELIGENTE: cada guardado real (nota, planilla, asistencia,
    // sincronización...) cuenta como "actividad reciente" para que el
    // auto-ping adaptativo mantenga intervalos cortos mientras hay uso, y los
    // espacie solo cuando de verdad no está pasando nada — ver keep-alive.ts.
    registrarActividadPlataforma(sk);
    // RONDA 43/44 — hook de sincronización del índice cruzado entre
    // instituciones (estudiantes_indice_red). Deliberadamente SIN `await`:
    // este es el endpoint de guardado genérico más usado de toda la
    // plataforma (cualquier matrícula, retiro o edición de cualquier tipo
    // pasa por aquí), así que no se le agrega latencia a la respuesta
    // principal por una tabla que es, en esencia, un índice de búsqueda de
    // segunda mano — un fallo o demora aquí nunca debe afectar al guardado
    // real del blob, que ya se completó arriba.
    //
    // RONDA 44 — DIMENSIÓN 11.c (CERRADA): si se pudo capturar una
    // instantánea de "antes" (la institución estaba en caché — el caso
    // normal, dado el TTL de 5s y que el mismo cliente casi siempre acaba
    // de leer antes de guardar), se usa reindexación INCREMENTAL — solo se
    // toca en `estudiantes_indice_red` la fila de cada estudiante cuyo
    // numDoc/nombre/grado/estadoMatricula realmente cambió, o que es nuevo.
    // Si no había nada en caché (arranque en frío, o cambió el proceso del
    // servidor), se cae al resincronizado completo de antes — mismo
    // fallback ya documentado, ahora usado solo como excepción y no como
    // regla.
    if (Array.isArray(_estsAntesDelGuardado)) {
      _sincronizarIndiceRedIncremental(sk, _estsAntesDelGuardado, (data as any)?.ests).catch(() => {});
    } else {
      _resincronizarIndiceRedInstitucion(sk, (data as any)?.ests).catch(() => {});
    }
    return res.json({ ok: true, version: nowTs.toISOString() });
  } catch (e) {
    console.error('POST /api/inetis/db', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RONDA 36 — PARTE 1.2: AUTOGUARDADO AISLADO Y ATÓMICO FILA POR FILA.
// A diferencia de POST /api/inetis/db (arriba), que siempre recibe y
// reescribe el blob JSON COMPLETO de la institución, este endpoint recibe
// ÚNICAMENTE el paquete de UNA fila (un estudiante, en Planilla; una celda
// estudiante+columna, en Notas de Actividades) y lo aplica con una
// lectura-modificación-escritura QUIRÚRGICA sobre esa única ruta anidada del
// JSON — nunca se compara, revalida ni retransmite el resto de la planilla.
//
// Trade-off documentado con transparencia: la persistencia de este proyecto
// sigue siendo un único blob JSON por institución en `kv_store` (arquitectura
// multi-tenant ya existente, no se reescribió a tablas relacionales de una
// fila por nota — eso habría sido un cambio de arquitectura mucho más
// grande y riesgoso). Lo que sí cambia de raíz es (a) lo que el NAVEGADOR
// envía por la red en cada autoguardado (solo la fila afectada, no la
// planilla entera) y (b) que este endpoint hace una lectura fresca
// inmediatamente antes de escribir, sin usar `baseVersion`/fusión de 3 vías
// ni disparar ningún aviso de "otra persona guardó" — cada llamada es
// autocontenida: lee lo último, aplica el cambio de una sola fila, guarda.
// ════════════════════════════════════════════════════════════════════════
// RONDA 44 — DIMENSIÓN 2 (UPSERT ATÓMICO). El pedido literal era
// "POST /api/notas/actualizar con UPSERT SQL ON CONFLICT". Se investigó
// primero (instrucción explícita del coordinador de no asumir): este
// endpoint YA hace, desde la Ronda 36, una lectura-modificación-escritura
// atómica de UNA sola fila (no reescribe el blob completo), y la fusión
// `{...(e.nts[cId][per]||{}), ...notas}` es semánticamente un UPSERT — si
// la celda no existía, se crea; si existía, se fusiona sin pisar columnas
// que este guardado no tocó. Migrar esto a un `INSERT ... ON CONFLICT` de
// SQL real exigiría que cada nota fuera una FILA de una tabla relacional
// (Dimensión 1.2, que se decidió NO migrar esta ronda por riesgo — ver el
// comentario grande sobre las tablas granulares más arriba). Lo que SÍ se
// hizo: (a) extraer la lógica a `_ejecutarGuardarFilaNotas()` para que
// pueda reutilizarse; (b) exponer el mismo motor bajo el nombre de ruta
// exacto que pidió el prompt, `POST /api/notas/actualizar`, como alias —
// AMBAS rutas ejecutan la MISMA función, nunca una copia.
// ════════════════════════════════════════════════════════════════════════
async function _ejecutarGuardarFilaNotas(req: express.Request): Promise<{ status: number; body: any }> {
  const { sk, tipo, estId, cId, per, notas, colId, valor, fecha, hora, obs, actorRolEspecifico } = (req.body || {}) as {
    sk?: string; tipo?: 'planilla' | 'actividad'; estId?: string | number; cId?: number; per?: number;
    notas?: Record<string, number>; colId?: string; valor?: number; fecha?: string; hora?: string; obs?: string;
    // RONDA 39 — campo OPCIONAL de defensa en profundidad: este endpoint no
    // tiene sesión/identidad de servidor (confía por completo en el `sk` de
    // la institución, igual que el resto del núcleo K-12). Si el frontend
    // decide enviar el rolEspecifico del usuario que hace la petición, se
    // usa aquí para bloquear a Docente Orientador y Tutor PTA. Si el campo
    // no se envía, este chequeo simplemente no aplica — la restricción real
    // y primaria sigue siendo del lado del cliente (menú/UI oculta estas
    // pantallas para esos 2 roles).
    actorRolEspecifico?: string;
  };
  if (!sk || !tipo || estId === undefined || estId === null) {
    return { status: 400, body: { ok: false, error: 'Faltan datos (sk, tipo o estId).' } };
  }
  if (actorRolEspecifico === 'Docente Orientador' || actorRolEspecifico === 'Tutor PTA') {
    return { status: 403, body: { ok: false, error: 'Este rol no tiene permiso para registrar o modificar notas/planillas.' } };
  }
  // RONDA 40 — verificación CRIPTOGRÁFICA real (no basada en lo que declare
  // el body). ALCANCE Y LIMITACIÓN: este endpoint sigue sin EXIGIR un JWT como
  // requisito obligatorio (retrocompatible con clientes/pestañas viejas que
  // aún no tienen token) — RONDA 44, Dimensión 11.b sí volvió el JWT
  // OBLIGATORIO, pero únicamente en los 5 endpoints /api/red/*, no aquí.
  const _tokenJWT = extraerBearer(req.headers.authorization);
  if (_tokenJWT) {
    const _payloadJWT = verificarJWT(_tokenJWT);
    if (!_payloadJWT) {
      return { status: 401, body: { ok: false, error: 'Token de sesión inválido o vencido.' } };
    }
    if (rolBloqueadoParaNotas(_payloadJWT)) {
      return { status: 403, body: { ok: false, error: 'Su rol (verificado por token de sesión firmado) no tiene permiso para registrar o modificar notas/planillas.' } };
    }
  }
  if (!_tieneRescateValido(req)) {
    const estado = await verificarEstadoInstitucion(sk);
    if (!estado.ok) return { status: 403, body: { error: estado.motivo } };
    const estadoSuscripcion = await verificarSuscripcionSaas(sk);
    if (!estadoSuscripcion.ok) return { status: 402, body: { error: estadoSuscripcion.motivo, suscripcionVencida: true } };
  }

  // Lectura fresca (sin caché de 5s) — es la garantía de que esta escritura
  // parte siempre del dato más reciente posible, en vez de una copia local
  // potencialmente vieja del resto de la planilla.
  const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
  if (!rows.length) return { status: 404, body: { ok: false, error: 'Institución no encontrada.' } };
  const blob: any = rows[0].value;

  // RONDA 41 — PARTE 1.1: PROPIEDAD DE LA INFORMACIÓN Y AUDITORÍA. El dato
  // en sí (e.nts[cId][per], blob.notasAct[key]) sigue clave-ando EXACTAMENTE
  // igual que antes: por (asignatura/curso, periodo, [columna], estudiante)
  // — nunca por docente. El id del docente que hizo ESTE guardado se anota
  // aparte, en blob.auditoriaNotas, como metadato de solo lectura para
  // trazabilidad ("¿quién registró esto?"). Ningún endpoint de lectura ni
  // de permisos consulta blob.auditoriaNotas para decidir si una nota
  // existe o es visible — existir/verse depende solo de la clave real de
  // arriba, jamás de quién la escribió.
  const _docenteAuditoriaId = (() => {
    if (_tokenJWT) {
      const _p = verificarJWT(_tokenJWT);
      if (_p) return _p.sub;
    }
    return (req.body && (req.body as any).actorUsuario) || null;
  })();
  if (tipo === 'planilla') {
    if (cId === undefined || per === undefined || !notas) {
      return { status: 400, body: { ok: false, error: 'Faltan datos (cId, per o notas) para tipo=planilla.' } };
    }
    const idx = (blob.ests || []).findIndex((x: any) => String(x.id) === String(estId));
    if (idx === -1) return { status: 404, body: { ok: false, error: 'Estudiante no encontrado.' } };
    const e = blob.ests[idx];
    e.nts = e.nts || {};
    e.nts[cId] = e.nts[cId] || {};
    // UPSERT: si la fila del periodo no existía, se crea (INSERT); si ya
    // existía, se fusiona campo por campo sin pisar columnas que esta
    // llamada no envió (UPDATE parcial) — equivalente semántico de
    // `INSERT ... ON CONFLICT (est_id, c_id, per) DO UPDATE SET ...`.
    e.nts[cId][per] = { ...(e.nts[cId][per] || {}), ...notas };
    blob.auditoriaNotas = blob.auditoriaNotas || [];
    blob.auditoriaNotas.push({ tipo: 'planilla', estId, cId, per, registradoPorDocenteId: _docenteAuditoriaId, ts: new Date().toISOString() });
    // RONDA 45 — DIMENSIÓN 1: DUAL-WRITE best-effort hacia la capa
    // relacional (Fase 1 de la migración de almacenamiento). Se dispara
    // DESPUÉS de aplicar el cambio al blob en memoria (blob ya tiene el
    // valor fusionado) pero se corre AQUÍ, antes del guardado del kv_store
    // de abajo, para poder capturar cualquier error sin afectar la
    // respuesta — no bloquea ni puede hacer fallar este guardado: un fallo
    // en la tabla relacional únicamente significa que esa institución no
    // se beneficia todavía de la lectura rápida de /api/grados* (fallback
    // automático al blob, ver esos 3 endpoints más abajo).
    await _dualWriteCalificacionRel(sk, blob, String(estId), Number(cId), Number(per), e.nts[cId][per]);
  } else if (tipo === 'actividad') {
    if (!colId) return { status: 400, body: { ok: false, error: 'Falta colId para tipo=actividad.' } };
    blob.notasAct = blob.notasAct || {};
    const key = `${cId}_${per}_${colId}_${estId}`;
    if (valor === undefined || valor === null) {
      // valor ausente = solicitud explícita de ELIMINAR la celda (ver
      // eliminarNotaAct() en el frontend) — se borra la clave por completo,
      // sin dejar un residuo con valor 0 confundible con "nota en cero".
      delete blob.notasAct[key];
    } else {
      blob.notasAct[key] = { valor, fecha: fecha || '', hora: hora || '', obs: obs || '', registradoPorDocenteId: _docenteAuditoriaId };
    }
  } else {
    return { status: 400, body: { ok: false, error: 'tipo debe ser "planilla" o "actividad".' } };
  }

  const nowTs = new Date();
  await db.update(kvStore).set({ value: blob, updatedAt: nowTs }).where(eq(kvStore.key, sk));
  guardarDbCache(sk, blob, nowTs, true);
  broadcastChange(sk);
  registrarActividadPlataforma(sk);
  return { status: 200, body: { ok: true, version: nowTs.toISOString() } };
}

app.post('/api/inetis/notas/guardar-fila', async (req, res) => {
  try {
    const { status, body } = await _ejecutarGuardarFilaNotas(req);
    return res.status(status).json(body);
  } catch (e) {
    console.error('POST /api/inetis/notas/guardar-fila', e);
    return res.status(500).json({ ok: false, error: 'Error interno al guardar la fila.' });
  }
});

// RONDA 44 — DIMENSIÓN 2: alias con el nombre de ruta exacto pedido por el
// prompt del usuario ("POST /api/notas/actualizar"). Ejecuta EXACTAMENTE
// el mismo motor que /api/inetis/notas/guardar-fila — se mantiene el
// nombre original como ruta primaria (no romper clientes ya desplegados
// que lo llaman) y este como alias hacia adelante.
app.post('/api/notas/actualizar', async (req, res) => {
  try {
    const { status, body } = await _ejecutarGuardarFilaNotas(req);
    return res.status(status).json(body);
  } catch (e) {
    console.error('POST /api/notas/actualizar', e);
    return res.status(500).json({ ok: false, error: 'Error interno al guardar la fila.' });
  }
});

// ════════════════════════════════════════════════════════════════════════
// RONDA 41 — PARTE 3: MÓDULO DE TRASLADO INTER-INSTITUCIONAL (ENTRE
// COLEGIOS DE LA PLATAFORMA).
//
// DECISIÓN DE INGENIERÍA (documentada con transparencia, autorizada
// explícitamente por el coordinador): se implementa el "Paquete de
// Transferencia Digital Seguro" como un JSON firmado con HMAC-SHA256
// (reutilizando _firmarBlob()/DOC_SIGN_SECRET, el MISMO mecanismo que ya
// firma los boletines/certificados desde las Rondas 37-38), en vez de un
// .zip firmado. Un JSON firmado cumple exactamente la misma garantía de
// integridad (cualquier alteración del contenido invalida la firma) con
// muchísima menos superficie nueva de código — no hay compresión,
// descompresión ni manejo de archivos binarios que introducir en esta
// ronda. Si en el futuro se requiere empaquetar también archivos binarios
// grandes (fotos, PDFs adjuntos) dentro del paquete mismo, la migración a
// .zip es un cambio de formato de transporte, no de la lógica de negocio
// de abajo (que ya trabaja sobre un objeto de datos plano).
//
// CLAVE DE CORRELACIÓN: numDoc (número de documento del estudiante), el
// mismo campo que ya usa el resto del sistema (login, importaciones
// masivas, exportación SIMAT) para identificar de forma única a un
// estudiante — ver e.numDoc en gestor-academico/dist/modules/03-app-core.js.
// ════════════════════════════════════════════════════════════════════════

// POST /api/traslado/exportar-estudiante — la institución de ORIGEN genera
// el paquete firmado con el expediente acumulado del estudiante (notas de
// todos los periodos, observador completo sin filtrar por tipo_anotacion,
// ficha de matrícula + adjuntos, atenciones psicopedagógicas y casos de
// convivencia asociados a su estId, y sus registros de asistencia). No
// borra nada del lado de origen — la institución de origen conserva su
// copia; el traslado inter-institucional es una EXPORTACIÓN, no un "mover".
// ════════════════════════════════════════════════════════════════════════
// RONDA 42 — CONTROL DE ACCESO Y AUDITORÍA para los 4 endpoints de
// traslado inter-institucional. Reutiliza el MISMO patrón ya establecido
// (Rondas 39-40) de "actorRolEspecifico"/JWT opcional: si llega un JWT
// (Authorization: Bearer), su rol se verifica criptográficamente y debe
// ser 'admin'; si no llega JWT, se exige `actorRol==='admin'` en el body
// (el mismo nivel de confianza retrocompatible que ya tiene guardar-fila).
// Cualquier otro rol recibe 403. Esto NO es exigencia de JWT obligatoria
// en toda la plataforma (limitación ya documentada desde la Ronda 40) —
// es, como mínimo, el mismo estándar que el resto del núcleo K-12.
// ════════════════════════════════════════════════════════════════════════
function _autorizarActorAdmin(req: express.Request): { ok: true; actorUsuario: string; actorNombre: string } | { ok: false; status: number; error: string } {
  // RONDA 43 — acepta actorRol/actorUsuario/actorNombre tanto del body
  // (POST) como del query string (GET, ej. la bandeja de solicitudes
  // pendientes) para no duplicar esta función por verbo HTTP.
  const fuente: any = (req.body && Object.keys(req.body).length ? req.body : req.query) || {};
  const tokenJWT = extraerBearer(req.headers.authorization);
  if (tokenJWT) {
    const payload = verificarJWT(tokenJWT);
    if (!payload) return { ok: false, status: 401, error: 'Token de sesión inválido o vencido.' };
    if (payload.rol !== 'admin') return { ok: false, status: 403, error: 'Solo el Rector/Administrador de la institución puede realizar operaciones de traslado.' };
    return { ok: true, actorUsuario: payload.sub, actorNombre: fuente.actorNombre || payload.sub };
  }
  if (fuente.actorRol !== 'admin') {
    return { ok: false, status: 403, error: 'Solo el Rector/Administrador de la institución puede realizar operaciones de traslado.' };
  }
  return { ok: true, actorUsuario: fuente.actorUsuario || '—', actorNombre: fuente.actorNombre || fuente.actorUsuario || '—' };
}

// ════════════════════════════════════════════════════════════════════════
// RONDA 44 — DIMENSIÓN 11.b: JWT OBLIGATORIO específicamente para los 5
// endpoints /api/red/* (búsqueda en la red + Buzón de Solicitudes). A
// diferencia de `_autorizarActorAdmin()` (retrocompatible: JWT opcional,
// cae a `actorRol` del body si no hay token — usado por guardar-fila y por
// /api/traslado/* offline, que el coordinador pidió NO tocar en esta
// ronda), esta función RECHAZA con 401 cualquier petición sin un JWT
// válido. Justificación del alcance más estricto: estos 5 endpoints son
// los que mueven expedientes ENTRE instituciones (no dentro de la propia),
// así que el coordinador pidió tratarlos como el conjunto más sensible de
// toda la plataforma — y son, además, los más NUEVOS (Ronda 43), sin
// clientes desplegados que dependan todavía del modo retrocompatible.
function _exigirJWTAdmin(req: express.Request): { ok: true; actorUsuario: string; actorNombre: string } | { ok: false; status: number; error: string } {
  const fuente: any = (req.body && Object.keys(req.body).length ? req.body : req.query) || {};
  const tokenJWT = extraerBearer(req.headers.authorization);
  if (!tokenJWT) {
    return { ok: false, status: 401, error: 'Este endpoint requiere un token de sesión (JWT) válido — inicie sesión de nuevo si el problema persiste.' };
  }
  const payload = verificarJWT(tokenJWT);
  if (!payload) return { ok: false, status: 401, error: 'Token de sesión inválido o vencido.' };
  if (payload.rol !== 'admin') return { ok: false, status: 403, error: 'Solo el Rector/Administrador de la institución puede realizar operaciones de interconexión entre instituciones.' };
  return { ok: true, actorUsuario: payload.sub, actorNombre: fuente.actorNombre || payload.sub };
}

// ════════════════════════════════════════════════════════════════════════
// RONDA 45 — DIMENSIÓN 1, FASE 1: capa de lectura/escritura relacional
// (dual-write) — ver el comentario extenso de arquitectura junto a
// `ensureSchemaRelacionalNotas()` en src/db/index.ts.
let _schemaRelNotasListo = false;
async function _asegurarSchemaRelNotas(): Promise<void> {
  if (_schemaRelNotasListo) return;
  await ensureSchemaRelacionalNotas();
  _schemaRelNotasListo = true;
}

// Dual-write BEST-EFFORT de una nota de tipo "planilla" hacia las 3 tablas
// relacionales. Alcance de esta fase: SOLO tipo='planilla' (el grano
// est×materia×periodo, que es exactamente el que necesitan los 3
// endpoints /api/grados* de la Ronda 44) — tipo='actividad' (notas de
// quiz/actividad puntual, clave distinta: est×col×fecha) NO se migra en
// esta fase; sigue viviendo únicamente en el blob, documentado como
// decisión explícita de alcance (no un olvido). Cualquier error aquí se
// atrapa y se registra, pero NUNCA se propaga — el guardado real (el
// blob JSON, la fuente de verdad) ya se completó antes de llamar a esto.
async function _dualWriteCalificacionRel(sk: string, blob: any, estId: string, cId: number, per: number, notasFusionadas: any): Promise<void> {
  try {
    await _asegurarSchemaRelNotas();
    const e = (blob.ests || []).find((x: any) => String(x.id) === String(estId));
    const carga = (blob.carga || []).find((c: any) => String(c.id) === String(cId));
    const grado = (e && e.g) || (carga && carga.g) || '';
    if (e) {
      await db.insert(estudiantesRel)
        .values({ sk, estIdOrigen: String(estId), nombre: e.n || '', numDoc: e.numDoc || '', grado, estadoMatricula: e.estadoMatricula || 'activo', updatedAt: new Date() })
        .onConflictDoUpdate({ target: [estudiantesRel.sk, estudiantesRel.estIdOrigen], set: { nombre: e.n || '', numDoc: e.numDoc || '', grado, estadoMatricula: e.estadoMatricula || 'activo', updatedAt: new Date() } });
    }
    if (carga) {
      await db.insert(materiasRel)
        .values({ sk, cIdOrigen: String(cId), nombre: carga.m || '', grado: carga.g || grado, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [materiasRel.sk, materiasRel.cIdOrigen], set: { nombre: carga.m || '', grado: carga.g || grado, updatedAt: new Date() } });
    }
    await db.insert(calificacionesRel)
      .values({ sk, estIdOrigen: String(estId), cIdOrigen: String(cId), periodo: String(per), notas: notasFusionadas, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [calificacionesRel.sk, calificacionesRel.estIdOrigen, calificacionesRel.cIdOrigen, calificacionesRel.periodo], set: { notas: notasFusionadas, updatedAt: new Date() } });
  } catch (err) {
    console.error('_dualWriteCalificacionRel (best-effort, no afecta el guardado real en el blob)', err);
  }
}

// ════════════════════════════════════════════════════════════════════════
// RONDA 43 — ÍNDICE CRUZADO ENTRE INSTITUCIONES (estudiantes_indice_red).
//
// DECISIÓN DE ARQUITECTURA (documentada con transparencia, evaluando las 2
// alternativas que planteó el coordinador): se eligió un ÍNDICE RELACIONAL
// separado en Neon en vez de recorrer los blobs JSON de todas las
// instituciones en cada búsqueda. Razones: (a) el costo de una búsqueda por
// NUIP pasa de O(instituciones × estudiantes_por_institución) — leyendo
// blobs completos, cada uno potencialmente de varios MB — a una única
// consulta indexada por clave primaria (nuip) en una tabla angosta con 6
// columnas; (b) el índice no expone JAMÁS datos sensibles (notas,
// observador, ficha) porque físicamente no los contiene — es estructuralmente
// imposible filtrar de más por un bug de "se me olvidó excluir ese campo",
// a diferencia de tener que recortar campos de un blob completo en cada
// respuesta; (c) es la misma filosofía que ya usa este proyecto en otras
// tablas de solo-índice/auditoría (ej. `simat_estudiantes`, Ronda 36).
// Costo aceptado: hay que mantenerlo sincronizado explícitamente (no es
// una vista derivada en vivo) — se hace con hooks en los puntos donde el
// blob se guarda, nunca con un job batch aparte, para minimizar el margen
// de desactualización.
let _schemaRedListo = false;
async function _asegurarSchemaRed(): Promise<void> {
  if (_schemaRedListo) return;
  await ensureSchemaRedInterinstitucional();
  _schemaRedListo = true;
}

// Nombre de la institución a partir de su sk — lee el blob especial de la
// plataforma (GESTOR_SK) y busca dentro de `platforms`. Con fallback al sk
// mismo si no se encuentra (nunca debe romper el flujo por esto).
async function _obtenerNombreInstitucion(sk: string): Promise<string> {
  try {
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    const gestorDB: any = rows.length ? rows[0].value : null;
    const plat = gestorDB && Array.isArray(gestorDB.platforms) ? gestorDB.platforms.find((p: any) => p.sk === sk) : null;
    return (plat && plat.nombre) || sk;
  } catch {
    return sk;
  }
}

// Sincroniza UNA fila del índice a partir del estudiante real (nunca copia
// más campos que los estrictamente necesarios para la búsqueda pública).
// Best-effort: un fallo aquí NUNCA debe tumbar la operación principal que
// lo llama (guardar notas, matricular, trasladar) — se registra en consola
// y se sigue.
async function _sincronizarIndiceRedEstudiante(sk: string, e: any): Promise<void> {
  try {
    const numDoc = String(e?.numDoc || '').trim();
    if (!numDoc) return; // sin documento no hay forma de correlacionar en la red — se omite, no es un error
    await _asegurarSchemaRed();
    const institucionNombre = await _obtenerNombreInstitucion(sk);
    const activo = (e.estadoMatricula || 'activo') === 'activo';
    await db.insert(estudiantesIndiceRed).values({
      nuip: numDoc, sk, nombreCompleto: e.n || '', institucionNombre, grado: e.g || '', activo, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: estudiantesIndiceRed.nuip,
      set: { sk, nombreCompleto: e.n || '', institucionNombre, grado: e.g || '', activo, updatedAt: new Date() },
    });
  } catch (err) {
    console.error('_sincronizarIndiceRedEstudiante', err);
  }
}

// Resincroniza TODOS los estudiantes de una institución de una sola vez —
// se usa como hook desde POST /api/inetis/db (el guardado genérico de todo
// el blob), que es el punto por el que pasa CUALQUIER matrícula, retiro o
// edición hecha desde la UI normal (no solo los endpoints de traslado).
async function _resincronizarIndiceRedInstitucion(sk: string, ests: any[]): Promise<void> {
  try {
    if (!Array.isArray(ests) || !ests.length) return;
    await _asegurarSchemaRed();
    const institucionNombre = await _obtenerNombreInstitucion(sk);
    for (const e of ests) {
      const numDoc = String(e?.numDoc || '').trim();
      if (!numDoc) continue;
      const activo = (e.estadoMatricula || 'activo') === 'activo';
      await db.insert(estudiantesIndiceRed).values({
        nuip: numDoc, sk, nombreCompleto: e.n || '', institucionNombre, grado: e.g || '', activo, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: estudiantesIndiceRed.nuip,
        set: { sk, nombreCompleto: e.n || '', institucionNombre, grado: e.g || '', activo, updatedAt: new Date() },
      });
    }
  } catch (err) {
    console.error('_resincronizarIndiceRedInstitucion', err);
  }
}

// RONDA 44 — DIMENSIÓN 11.c: versión INCREMENTAL de la resincronización —
// compara `estsAntes` (instantánea previa al guardado) contra `estsAhora`
// (lo que se acaba de guardar) y solo toca en el índice las filas de los
// estudiantes cuyo numDoc/nombre/grado/estadoMatricula cambió, o que son
// nuevos (no existían en `estsAntes`). Un estudiante sin ningún cambio
// relevante para el índice (ej. se le agregó una nota) no genera ningún
// UPDATE contra estudiantes_indice_red.
function _huellaIndiceRed(e: any): string {
  return [e?.numDoc, e?.n, e?.g, e?.estadoMatricula || 'activo'].map((v) => String(v ?? '')).join('\u0001');
}
async function _sincronizarIndiceRedIncremental(sk: string, estsAntes: any[], estsAhora: any[]): Promise<void> {
  try {
    if (!Array.isArray(estsAhora) || !estsAhora.length) return;
    const huellasAntes = new Map<string, string>();
    for (const e of (Array.isArray(estsAntes) ? estsAntes : [])) {
      huellasAntes.set(String(e?.id), _huellaIndiceRed(e));
    }
    const cambiados = estsAhora.filter((e: any) => {
      const huellaVieja = huellasAntes.get(String(e?.id));
      return huellaVieja === undefined || huellaVieja !== _huellaIndiceRed(e);
    });
    if (!cambiados.length) return; // nada relevante para el índice cambió en este guardado
    await _asegurarSchemaRed();
    const institucionNombre = await _obtenerNombreInstitucion(sk);
    for (const e of cambiados) {
      const numDoc = String(e?.numDoc || '').trim();
      if (!numDoc) continue;
      const activo = (e.estadoMatricula || 'activo') === 'activo';
      await db.insert(estudiantesIndiceRed).values({
        nuip: numDoc, sk, nombreCompleto: e.n || '', institucionNombre, grado: e.g || '', activo, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: estudiantesIndiceRed.nuip,
        set: { sk, nombreCompleto: e.n || '', institucionNombre, grado: e.g || '', activo, updatedAt: new Date() },
      });
    }
  } catch (err) {
    console.error('_sincronizarIndiceRedIncremental', err);
  }
}

// ════════════════════════════════════════════════════════════════════════
// RONDA 43 — MOTOR COMPARTIDO DE MIGRACIÓN (usado por 3 flujos distintos:
// el paquete OFFLINE de las Rondas 41-42, y la Migración Directa Server-Side
// del nuevo Buzón de Solicitudes). Se extrae aquí para que "reutilizar el
// motor, no reescribirlo" sea literal: los 3 disparadores llaman a las
// MISMAS 2 funciones, nunca copias.
// ════════════════════════════════════════════════════════════════════════
function _construirPaqueteExportacionEstudiante(blob: any, sk: string, estId: string | number): { datos: any; e: any } | null {
  const e = (blob.ests || []).find((x: any) => String(x.id) === String(estId));
  if (!e) return null;
  const carga = (blob.carga || []).filter((c: any) => c.g === e.g);
  const datos = {
    version: 1,
    origenSk: sk,
    numDoc: e.numDoc || '',
    estudiante: e, // incluye nts, observaciones, ficha, foto, etc. — el objeto completo del estudiante
    materiasGradoOrigen: carga.map((c: any) => ({ id: c.id, m: c.m, a: c.a })),
    atencionesPsicopedagogicas: (blob.atencionesPsicopedagogicas || []).filter((a: any) => String(a.estId) === String(estId)),
    casosConvivencia: (blob.casosConvivencia || []).filter((c: any) => String(c.estId) === String(estId)),
    asistencia: (blob.asistencia || []).filter((a: any) => Array.isArray(a.registros) ? a.registros.some((r: any) => String(r.estId) === String(estId)) : false)
      .map((a: any) => ({ fecha: a.fecha, grado: a.grado, registro: (a.registros || []).find((r: any) => String(r.estId) === String(estId)) })),
    historicoAcademico: (blob.historicoAcademico || []).filter((h: any) => String(h.estId) === String(estId)),
    emitidoEn: new Date().toISOString(),
  };
  return { datos, e };
}

// RONDA 43 — al generar el paquete (sea por el botón offline o por la
// aprobación de una solicitud), el estudiante queda marcado de inmediato
// como 'inactivo_traslado' en el blob de ORIGEN — cumple la secuencia
// exacta pedida ("se cambia de inmediato el estado ... a Inactivo por
// Traslado/Retirado"). No se elimina al estudiante ni sus datos: solo se
// anota `estadoMatricula`, un campo NUEVO (no pisa ningún campo existente
// como `e.estado`/`e.activo`, que este sistema no usaba de forma consistente
// antes de esta ronda — ver CHECKLIST_DESPLIEGUE.md).
function _marcarEstudianteInactivoPorTraslado(e: any): void {
  e.estadoMatricula = 'inactivo_traslado';
  e.fechaInactivoPorTraslado = new Date().toISOString();
}

function _aplicarImportacionEstudianteADestino(blobDestino: any, datos: any, gradoDestino: string): string | number {
  const numDoc = String(datos.numDoc || '');
  const estudianteEntrante = datos.estudiante || {};
  blobDestino.ests = blobDestino.ests || [];
  let idx = numDoc ? blobDestino.ests.findIndex((x: any) => String(x.numDoc || '') === numDoc) : -1;
  let nuevoId: string | number;
  if (idx === -1) {
    // No existe todavía en destino: se crea con un id nuevo propio de esta
    // institución (los ids son locales a cada blob/sk), conservando todo
    // el resto del expediente entrante (nombre, ficha, notas históricas,
    // observador, etc.) bajo un nuevo campo `historicoExterno` para no
    // mezclarlo silenciosamente con la estructura `nts`/`observaciones`
    // nativa de esta institución (evita colisiones de ids de "carga" entre
    // colegios distintos). El estudiante llega ACTIVO en destino
    // (estadoMatricula no se copia del origen — allá quedó inactivo, aquí
    // empieza una matrícula nueva y activa).
    nuevoId = 'trasl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    blobDestino.ests.push({
      ...estudianteEntrante,
      id: nuevoId,
      g: gradoDestino,
      nts: {}, // las notas del colegio de origen no son comparables por id de carga — se archivan aparte, íntegras, ver historicoExterno
      estadoMatricula: 'activo',
      historicoExterno: {
        origenSk: datos.origenSk,
        notas: estudianteEntrante.nts || {},
        materiasGradoOrigen: datos.materiasGradoOrigen || [],
        observaciones: estudianteEntrante.observaciones || [],
        ficha: estudianteEntrante.ficha || null,
        importadoEn: new Date().toISOString(),
      },
    });
  } else {
    // Ya existe en destino (reingreso, o el traslado se registró dos
    // veces): se fusiona sin pisar nada local — el expediente entrante
    // queda anexado en historicoExterno para consulta, y nunca sobrescribe
    // notas/observaciones que la institución destino ya tenga.
    nuevoId = blobDestino.ests[idx].id;
    blobDestino.ests[idx].estadoMatricula = 'activo';
    blobDestino.ests[idx].historicoExterno = blobDestino.ests[idx].historicoExterno || [];
    (Array.isArray(blobDestino.ests[idx].historicoExterno) ? blobDestino.ests[idx].historicoExterno : [blobDestino.ests[idx].historicoExterno]).push({
      origenSk: datos.origenSk,
      notas: estudianteEntrante.nts || {},
      materiasGradoOrigen: datos.materiasGradoOrigen || [],
      observaciones: estudianteEntrante.observaciones || [],
      ficha: estudianteEntrante.ficha || null,
      importadoEn: new Date().toISOString(),
    });
  }
  blobDestino.atencionesPsicopedagogicas = blobDestino.atencionesPsicopedagogicas || [];
  (datos.atencionesPsicopedagogicas || []).forEach((a: any) => blobDestino.atencionesPsicopedagogicas.push({ ...a, estId: nuevoId, id: 'imp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) }));
  blobDestino.casosConvivencia = blobDestino.casosConvivencia || [];
  (datos.casosConvivencia || []).forEach((c: any) => blobDestino.casosConvivencia.push({ ...c, estId: nuevoId, id: 'imp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) }));
  blobDestino.historicoAcademico = blobDestino.historicoAcademico || [];
  (datos.historicoAcademico || []).forEach((h: any) => blobDestino.historicoAcademico.push({ ...h, estId: nuevoId }));
  return nuevoId;
}

app.post('/api/traslado/exportar-estudiante', async (req, res) => {
  try {
    const auth = _autorizarActorAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
    const { sk, estId } = (req.body || {}) as { sk?: string; estId?: string | number };
    if (!sk || estId === undefined || estId === null) {
      return res.status(400).json({ ok: false, error: 'Faltan datos (sk o estId).' });
    }
    if (!DOC_SIGN_SECRET) return res.status(503).json({ ok: false, error: 'La firma de paquetes de traslado no está configurada en el servidor (falta DOC_SIGN_SECRET).' });
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Institución no encontrada.' });
    const blob: any = rows[0].value;
    const construido = _construirPaqueteExportacionEstudiante(blob, sk, estId);
    if (!construido) return res.status(404).json({ ok: false, error: 'Estudiante no encontrado.' });
    const { datos, e } = construido;
    const firma = _firmarBlob(datos);
    // RONDA 43 — secuencia exacta pedida: el botón "Trasladar Estudiante
    // (Modo Offline)" debe dejar al estudiante como 'Inactivo por Traslado'
    // en origen de inmediato, en la MISMA operación que genera el paquete
    // (no un paso separado que el rector pudiera olvidar).
    _marcarEstudianteInactivoPorTraslado(e);
    // RONDA 42 — AUDITORÍA: se registra en el mismo log de auditoría de
    // matrícula ya existente (d.logMatricula, ver _registrarCambioMatricula
    // en el frontend) para que quede trazado quién generó este paquete,
    // cuándo, y de qué estudiante — resuelve reclamos futuros del tipo
    // "¿quién exportó el expediente de mi hijo?".
    blob.logMatricula = blob.logMatricula || [];
    blob.logMatricula.push({
      id: 'lm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      fecha: new Date().toISOString(),
      usuario: auth.actorUsuario,
      usuarioNombre: auth.actorNombre,
      estId,
      estNombre: e.n || '',
      tipo: 'traslado_interinstitucional_export_estudiante',
      detalle: `Paquete de transferencia generado (modo offline). Estudiante marcado 'Inactivo por Traslado' en esta institución.`,
    });
    const nowTs = new Date();
    await db.update(kvStore).set({ value: blob, updatedAt: nowTs }).where(eq(kvStore.key, sk));
    guardarDbCache(sk, blob, nowTs, true);
    broadcastChange(sk);
    await _sincronizarIndiceRedEstudiante(sk, e);
    return res.json({ ok: true, paquete: { datos, firma }, estadoMatricula: e.estadoMatricula });
  } catch (e) {
    console.error('POST /api/traslado/exportar-estudiante', e);
    return res.status(500).json({ ok: false, error: 'Error interno al exportar el paquete de traslado.' });
  }
});

// POST /api/traslado/importar-estudiante — la institución de DESTINO recibe
// el paquete, verifica su firma (rechaza cualquier alteración) y, si el
// estudiante ya existe en destino (correlacionado por numDoc), FUSIONA el
// expediente entrante con el ya existente sin borrar nada local; si no
// existe, lo crea a partir del paquete. Requiere indicar el grado destino
// (gradoDestino) porque el grado de origen probablemente no existe con ese
// nombre en la nueva institución.
app.post('/api/traslado/importar-estudiante', async (req, res) => {
  try {
    const auth = _autorizarActorAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
    const { skDestino, paquete, gradoDestino } = (req.body || {}) as { skDestino?: string; paquete?: { datos: any; firma: string }; gradoDestino?: string };
    if (!skDestino || !paquete || !paquete.datos || !paquete.firma || !gradoDestino) {
      return res.status(400).json({ ok: false, error: 'Faltan datos (skDestino, paquete o gradoDestino).' });
    }
    if (!DOC_SIGN_SECRET) return res.status(503).json({ ok: false, error: 'La verificación de paquetes de traslado no está configurada en el servidor (falta DOC_SIGN_SECRET).' });
    const firmaEsperada = _firmarBlob(paquete.datos);
    if (firmaEsperada !== paquete.firma) {
      return res.status(400).json({ ok: false, error: 'El paquete de traslado no es válido: su firma no coincide (fue alterado o no proviene de esta plataforma).' });
    }
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, skDestino));
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Institución destino no encontrada.' });
    const blob: any = rows[0].value;
    const estudianteEntrante = paquete.datos.estudiante || {};
    // RONDA 43 — reutiliza el MISMO motor de importación que usa la
    // Migración Directa Server-Side del Buzón de Solicitudes (ver
    // _aplicarImportacionEstudianteADestino más arriba) — el flujo offline
    // (copiar/pegar JSON) y el flujo online (aprobar solicitud) terminan en
    // exactamente la misma operación de fondo.
    const nuevoId = _aplicarImportacionEstudianteADestino(blob, paquete.datos, gradoDestino);

    // RONDA 42 — AUDITORÍA en el blob DESTINO (mismo log que arriba).
    blob.logMatricula = blob.logMatricula || [];
    blob.logMatricula.push({
      id: 'lm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      fecha: new Date().toISOString(),
      usuario: auth.actorUsuario,
      usuarioNombre: auth.actorNombre,
      estId: nuevoId,
      estNombre: estudianteEntrante.n || '',
      tipo: 'traslado_interinstitucional_import_estudiante',
      detalle: `Expediente importado desde institución origen (sk=${paquete.datos.origenSk || '—'}) al grado ${gradoDestino}. Matrícula registrada como activa.`,
    });

    const nowTs = new Date();
    await db.update(kvStore).set({ value: blob, updatedAt: nowTs }).where(eq(kvStore.key, skDestino));
    guardarDbCache(skDestino, blob, nowTs, true);
    broadcastChange(skDestino);
    const eNuevo = (blob.ests || []).find((x: any) => x.id === nuevoId);
    if (eNuevo) await _sincronizarIndiceRedEstudiante(skDestino, eNuevo);
    return res.json({ ok: true, estIdDestino: nuevoId });
  } catch (e) {
    console.error('POST /api/traslado/importar-estudiante', e);
    return res.status(500).json({ ok: false, error: 'Error interno al importar el paquete de traslado.' });
  }
});

// ────────────────────────────────────────────────────────────────────────
// PARTE 3.2 — PORTABILIDAD DE PERFIL Y HOJA DE VIDA DOCENTE ENTRE COLEGIOS
// DE LA PLATAFORMA.
//
// HALLAZGO (contrario a la hipótesis inicial del coordinador, documentado
// con transparencia): perfil_docente_extendido (tabla relacional de Neon,
// Ronda 35) NO es independiente de la institución — su clave real es
// (sk, user_u) (ver src/db/schema.ts, índice perfil_docente_ext_sk_user_idx),
// y la cuenta de usuario del docente en sí (usuario/contraseña) tampoco es
// global: vive dentro del blob JSON de cada institución (db.users), sin
// ninguna tabla de "usuarios" central en Neon. Por lo tanto la portabilidad
// del docente SÍ requiere una transferencia real de datos (igual que la del
// estudiante), no un simple "re-enlace" de sk como se había planteado.
// ────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────
// RONDA 42 — PORTABILIDAD COMPLETA DEL DOCENTE (extiende la Ronda 41).
//
// QUÉ SE AGREGA: (a) un RESUMEN de su historial de carga académica —
// grados/asignaturas/áreas que ha dictado en la institución de origen — y
// (b) los recursos de su Repositorio Pedagógico Institucional que él mismo
// subió (repositorio_resources, filtrado por institucionId=sk y
// uploader=usuario).
//
// QUÉ NO SE MIGRA, Y POR QUÉ (decisión de ingeniería deliberada, no un
// olvido): las NOTAS de los estudiantes que dictó en la institución de
// origen. La Parte 1 de la Ronda 41 estableció como principio arquitectónico
// que una nota pertenece a (institución, grado, asignatura, estudiante,
// periodo) — NUNCA al docente que la registró, que solo queda anotado como
// metadato de auditoría. Si "portar al docente" migrara también esas notas,
// se estaría copiando (o peor, moviendo) información que es propiedad de
// OTRA institución y de OTROS estudiantes que ni siquiera se están
// trasladando — una contradicción directa con ese principio, y una fuga de
// datos de estudiantes que nunca dieron ese consentimiento de traslado. Por
// eso el historial de carga se exporta como un RESUMEN de solo lectura
// (grado, asignatura, área — sin ninguna nota ni dato de estudiante), útil
// como referencia de experiencia profesional, jamás como una migración de
// calificaciones.
app.post('/api/traslado/exportar-docente', async (req, res) => {
  try {
    const auth = _autorizarActorAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
    const { sk, usuario } = (req.body || {}) as { sk?: string; usuario?: string };
    if (!sk || !usuario) return res.status(400).json({ ok: false, error: 'Faltan datos (sk o usuario).' });
    if (!DOC_SIGN_SECRET) return res.status(503).json({ ok: false, error: 'La firma de paquetes de traslado no está configurada en el servidor (falta DOC_SIGN_SECRET).' });
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, sk));
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Institución no encontrada.' });
    const blob: any = rows[0].value;
    const u = (blob.users || []).find((x: any) => x.u === usuario);
    if (!u) return res.status(404).json({ ok: false, error: 'Docente no encontrado.' });
    const perfilRows = await db.select().from(perfilDocenteExtendido).where(and(eq(perfilDocenteExtendido.sk, sk), eq(perfilDocenteExtendido.userU, usuario)));
    // Resumen de carga académica — SOLO metadatos de la asignación
    // (grado/materia/área/horas), JAMÁS notas ni datos de estudiantes.
    const historialCargaAcademica = (blob.carga || [])
      .filter((c: any) => c.d === usuario)
      .map((c: any) => ({ grado: c.g, materia: c.m, area: c.a || '', horas: c.ih || null }));
    const repoRows = await db.select().from(repositorioResources).where(and(eq(repositorioResources.institucionId, sk), eq(repositorioResources.uploader, usuario)));
    const repositorioPedagogico = repoRows.map((r: any) => ({
      title: r.title, author: r.author, level: r.level, skill: r.skill, type: r.type,
      description: r.description, link: r.link, fileData: r.fileData, fileName: r.fileName,
    }));
    const datos = {
      version: 2, // v2 = incluye historialCargaAcademica + repositorioPedagogico (Ronda 42)
      origenSk: sk,
      usuario: u.u,
      usuarioBasico: { n: u.n, correo: u.correo, foto: u.foto, cedula: u.cedula },
      perfilExtendido: perfilRows[0] || null,
      historialCargaAcademica,
      repositorioPedagogico,
      emitidoEn: new Date().toISOString(),
    };
    const firma = _firmarBlob(datos);
    blob.logMatricula = blob.logMatricula || [];
    blob.logMatricula.push({
      id: 'lm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      fecha: new Date().toISOString(),
      usuario: auth.actorUsuario,
      usuarioNombre: auth.actorNombre,
      estId: null,
      estNombre: `Docente: ${u.n || usuario}`,
      tipo: 'traslado_interinstitucional_export_docente',
      detalle: `Paquete de perfil docente generado (${historialCargaAcademica.length} carga(s) histórica(s), ${repositorioPedagogico.length} recurso(s) de repositorio).`,
    });
    const nowTs = new Date();
    await db.update(kvStore).set({ value: blob, updatedAt: nowTs }).where(eq(kvStore.key, sk));
    guardarDbCache(sk, blob, nowTs, true);
    return res.json({ ok: true, paquete: { datos, firma } });
  } catch (e) {
    console.error('POST /api/traslado/exportar-docente', e);
    return res.status(500).json({ ok: false, error: 'Error interno al exportar el perfil docente.' });
  }
});

// POST /api/traslado/importar-docente — verifica la firma y, en la
// institución destino, crea (si no existe ya un usuario con ese mismo
// nombre de usuario) la cuenta básica del docente y su fila en
// perfil_docente_extendido (Hoja de Vida, escalafón, decreto, CV), para que
// conserve su historial profesional al llegar al nuevo colegio. No importa
// contraseña (por seguridad, el docente debe fijar una nueva en destino vía
// el flujo normal de restablecimiento) ni datos de carga académica (eso se
// asigna de nuevo en destino, como cualquier docente nuevo).
app.post('/api/traslado/importar-docente', async (req, res) => {
  try {
    const auth = _autorizarActorAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
    const { skDestino, paquete } = (req.body || {}) as { skDestino?: string; paquete?: { datos: any; firma: string } };
    if (!skDestino || !paquete || !paquete.datos || !paquete.firma) return res.status(400).json({ ok: false, error: 'Faltan datos (skDestino o paquete).' });
    if (!DOC_SIGN_SECRET) return res.status(503).json({ ok: false, error: 'La verificación de paquetes de traslado no está configurada en el servidor (falta DOC_SIGN_SECRET).' });
    const firmaEsperada = _firmarBlob(paquete.datos);
    if (firmaEsperada !== paquete.firma) {
      return res.status(400).json({ ok: false, error: 'El paquete de traslado no es válido: su firma no coincide (fue alterado o no proviene de esta plataforma).' });
    }
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, skDestino));
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Institución destino no encontrada.' });
    const blob: any = rows[0].value;
    blob.users = blob.users || [];
    const yaExiste = blob.users.some((x: any) => x.u === paquete.datos.usuario);
    if (!yaExiste) {
      const ub = paquete.datos.usuarioBasico || {};
      blob.users.push({ u: paquete.datos.usuario, r: 'docente', n: ub.n || '', correo: ub.correo || '', foto: ub.foto || '', cedula: ub.cedula || '', p: '' });
      const nowTs = new Date();
      await db.update(kvStore).set({ value: blob, updatedAt: nowTs }).where(eq(kvStore.key, skDestino));
      guardarDbCache(skDestino, blob, nowTs, true);
      broadcastChange(skDestino);
    }
    if (paquete.datos.perfilExtendido) {
      const pe = paquete.datos.perfilExtendido;
      // Sin restricción UNIQUE sobre (sk, user_u) en este esquema (solo hay
      // índices no-únicos), así que se evita duplicar filas comprobando
      // primero si ya existe una para este (skDestino, usuario) — importar
      // el mismo paquete dos veces no debe crear dos Hojas de Vida.
      const yaTienePerfil = await db.select().from(perfilDocenteExtendido).where(and(eq(perfilDocenteExtendido.sk, skDestino), eq(perfilDocenteExtendido.userU, paquete.datos.usuario)));
      if (!yaTienePerfil.length) {
        await db.insert(perfilDocenteExtendido).values({
          sk: skDestino,
          userU: paquete.datos.usuario,
          rolEspecifico: pe.rolEspecifico || '',
          esDocenteOrientador: !!pe.esDocenteOrientador,
          esTutorPta: !!pe.esTutorPta,
          tipoDecretoNormativo: pe.tipoDecretoNormativo || '',
          escalafon: pe.escalafon || '',
          cvUrl: pe.cvUrl || '',
          cvNombreArchivo: pe.cvNombreArchivo || '',
        });
      }
    }
    // RONDA 42 — importa el Repositorio Pedagógico propio del docente
    // (recursos que él mismo subió) como filas NUEVAS en repositorio_resources
    // bajo la institución DESTINO — es una copia, no un "mover": el recurso
    // sigue existiendo también en la institución de origen, igual que la
    // filosofía de "exportar, no borrar" del resto de este módulo.
    let recursosImportados = 0;
    for (const r of (paquete.datos.repositorioPedagogico || [])) {
      await db.insert(repositorioResources).values({
        institucionId: skDestino,
        title: r.title || '',
        author: r.author || '',
        level: r.level || 'General',
        skill: r.skill || '',
        type: r.type || '',
        description: r.description || '',
        uploader: paquete.datos.usuario,
        link: r.link || null,
        fileData: r.fileData || null,
        fileName: r.fileName || null,
      });
      recursosImportados++;
    }
    // RONDA 42 — el historial de carga académica (historialCargaAcademica)
    // se guarda como referencia de solo lectura junto al usuario en el blob
    // destino (`historialCargaAcademicaPrevia`) — es información de
    // experiencia profesional, NO asignaciones activas de `db.carga`: el
    // admin de la institución destino sigue siendo quien decide y crea las
    // asignaciones reales de este docente en su nuevo colegio.
    {
      const historialCarga = Array.isArray(paquete.datos.historialCargaAcademica) ? paquete.datos.historialCargaAcademica : [];
      const rowsD = await db.select().from(kvStore).where(eq(kvStore.key, skDestino));
      const blobD: any = rowsD[0]?.value;
      if (blobD) {
        blobD.users = blobD.users || [];
        const uD = blobD.users.find((x: any) => x.u === paquete.datos.usuario);
        if (uD && historialCarga.length) uD.historialCargaAcademicaPrevia = { origenSk: paquete.datos.origenSk, carga: historialCarga };
        blobD.logMatricula = blobD.logMatricula || [];
        blobD.logMatricula.push({
          id: 'lm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          fecha: new Date().toISOString(),
          usuario: auth.actorUsuario,
          usuarioNombre: auth.actorNombre,
          estId: null,
          estNombre: `Docente: ${paquete.datos.usuarioBasico?.n || paquete.datos.usuario}`,
          tipo: 'traslado_interinstitucional_import_docente',
          detalle: `Perfil docente importado desde sk=${paquete.datos.origenSk || '—'} (${recursosImportados} recurso(s) de repositorio, ${historialCarga.length} carga(s) histórica(s) como referencia). Las notas de estudiantes de la institución de origen NO se migran (pertenecen al estudiante/asignatura, no al docente).`,
        });
        const nowTsD = new Date();
        await db.update(kvStore).set({ value: blobD, updatedAt: nowTsD }).where(eq(kvStore.key, skDestino));
        guardarDbCache(skDestino, blobD, nowTsD, true);
        broadcastChange(skDestino);
      }
    }
    return res.json({ ok: true, usuarioImportado: paquete.datos.usuario, cuentaCreada: !yaExiste, recursosImportados });
  } catch (e) {
    console.error('POST /api/traslado/importar-docente', e);
    return res.status(500).json({ ok: false, error: 'Error interno al importar el perfil docente.' });
  }
});

// ════════════════════════════════════════════════════════════════════════
// RONDA 43 — MÓDULO ONLINE: BUZÓN DE SOLICITUDES E INTERCONEXIÓN DIRECTA
// ════════════════════════════════════════════════════════════════════════

// GET /api/red/buscar-estudiante-nuip?nuip=...&sk=... — el Rector que quiere
// RECIBIR a un estudiante busca por NUIP/documento. Consulta ÚNICAMENTE el
// índice (estudiantes_indice_red), NUNCA los blobs completos de otras
// instituciones. Expone el mínimo indispensable: nombre completo, nombre de
// la institución de origen y su sk (necesario para poder crear la
// solicitud) — NUNCA notas, observador, ficha, ni ningún otro dato personal
// sensible, que físicamente no existen en esta tabla. Si el estudiante no
// existe en la red, o existe pero en la MISMA institución que consulta, o
// existe pero está inactivo (ya trasladado / nunca perteneció a otra
// institución activa), la respuesta es "no encontrado" — no se distingue
// el motivo exacto en la respuesta pública, para no revelar de más (ej. no
// se informa "existe pero está inactivo", que filtraría que ese documento
// SÍ es un NUIP real y activo en el sistema en algún momento).
app.get('/api/red/buscar-estudiante-nuip', async (req, res) => {
  try {
    const auth = _exigirJWTAdmin(req) /* RONDA 44 — Dimensión 11.b: JWT obligatorio */;
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
    const nuip = String(req.query.nuip || '').trim();
    const skConsultante = String(req.query.sk || '').trim();
    if (!nuip || !skConsultante) return res.status(400).json({ ok: false, error: 'Faltan datos (nuip o sk).' });
    await _asegurarSchemaRed();
    const filas = await db.select().from(estudiantesIndiceRed).where(eq(estudiantesIndiceRed.nuip, nuip));
    const fila = filas[0];
    if (!fila || !fila.activo || fila.sk === skConsultante) {
      return res.json({ ok: true, encontrado: false });
    }
    return res.json({
      ok: true,
      encontrado: true,
      nombreCompleto: fila.nombreCompleto,
      institucionOrigenNombre: fila.institucionNombre,
      skOrigen: fila.sk,
      grado: fila.grado,
    });
  } catch (e) {
    console.error('GET /api/red/buscar-estudiante-nuip', e);
    return res.status(500).json({ ok: false, error: 'Error interno al buscar en la red.' });
  }
});

// POST /api/red/solicitudes/crear — la institución DESTINO (que quiere
// RECIBIR al estudiante) crea la solicitud tras confirmar el resultado de
// la búsqueda de arriba.
app.post('/api/red/solicitudes/crear', async (req, res) => {
  try {
    const auth = _exigirJWTAdmin(req); // RONDA 44 — Dimensión 11.b: JWT obligatorio
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
    const { nuip, skOrigen, skDestino, gradoDestino, nombreEstudiante } = (req.body || {}) as { nuip?: string; skOrigen?: string; skDestino?: string; gradoDestino?: string; nombreEstudiante?: string };
    if (!nuip || !skOrigen || !skDestino || !gradoDestino) return res.status(400).json({ ok: false, error: 'Faltan datos (nuip, skOrigen, skDestino o gradoDestino).' });
    if (skOrigen === skDestino) return res.status(400).json({ ok: false, error: 'La institución de origen y destino no pueden ser la misma.' });
    await _asegurarSchemaRed();
    // No se permite abrir 2 solicitudes PENDING para el mismo estudiante al mismo tiempo.
    const yaHayPendiente = await db.select().from(solicitudesTraslado).where(and(eq(solicitudesTraslado.nuip, nuip), eq(solicitudesTraslado.estado, 'PENDING')));
    if (yaHayPendiente.length) return res.status(409).json({ ok: false, error: 'Ya existe una solicitud pendiente para este estudiante.' });
    const institucionOrigenNombre = await _obtenerNombreInstitucion(skOrigen);
    const institucionDestinoNombre = await _obtenerNombreInstitucion(skDestino);
    const insertado = await db.insert(solicitudesTraslado).values({
      nuip, skOrigen, institucionOrigenNombre, skDestino, institucionDestinoNombre, gradoDestino,
      nombreEstudiante: nombreEstudiante || '', estado: 'PENDING', actorSolicitante: auth.actorNombre,
    }).returning();
    return res.json({ ok: true, solicitud: insertado[0] });
  } catch (e) {
    console.error('POST /api/red/solicitudes/crear', e);
    return res.status(500).json({ ok: false, error: 'Error interno al crear la solicitud.' });
  }
});

// GET /api/red/solicitudes/pendientes?sk=... — bandeja del Rector de ORIGEN:
// solicitudes PENDING donde su institución es la que debe aprobar/rechazar.
app.get('/api/red/solicitudes/pendientes', async (req, res) => {
  try {
    const auth = _exigirJWTAdmin(req) /* RONDA 44 — Dimensión 11.b: JWT obligatorio */;
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
    const sk = String(req.query.sk || '').trim();
    if (!sk) return res.status(400).json({ ok: false, error: 'Falta sk.' });
    await _asegurarSchemaRed();
    const filas = await db.select().from(solicitudesTraslado).where(and(eq(solicitudesTraslado.skOrigen, sk), eq(solicitudesTraslado.estado, 'PENDING')));
    return res.json({ ok: true, solicitudes: filas });
  } catch (e) {
    console.error('GET /api/red/solicitudes/pendientes', e);
    return res.status(500).json({ ok: false, error: 'Error interno al listar solicitudes.' });
  }
});

// POST /api/red/solicitudes/:id/aprobar — MIGRACIÓN DIRECTA SERVER-SIDE.
// Es la versión SÍNCRONA/online del mismo motor de exportar+importar de
// las Rondas 41-42 (_construirPaqueteExportacionEstudiante +
// _aplicarImportacionEstudianteADestino): en una sola petición, sin pasar
// por el paso manual de copiar/pegar JSON, se lee el blob de origen, se
// construye el paquete, se marca al estudiante inactivo en origen, se
// aplica la importación en destino, y se persisten ambos blobs.
//
// RONDA 44 — DIMENSIÓN 11.a (CERRADA): las 3 escrituras (blob de origen,
// blob de destino, estado de la solicitud) ahora viajan dentro de
// `db.transaction(async (tx) => {...})` — una transacción SQL real con
// BEGIN al entrar y COMMIT al salir sin errores; si CUALQUIER escritura
// falla (ej. la institución destino desaparece a mitad de camino), Postgres
// hace ROLLBACK automático de TODO el bloque — el estudiante NUNCA queda
// marcado inactivo en origen sin haberse creado en destino, y viceversa.
// Se usa `tx` (no `db`) en cada sentencia dentro del callback para que
// TODAS compartan el mismo cliente/transacción del pool.
app.post('/api/red/solicitudes/:id/aprobar', async (req, res) => {
  try {
    // RONDA 44 — DIMENSIÓN 11.b (CERRADA): JWT OBLIGATORIO en este endpoint
    // (a diferencia de /api/traslado/* y guardar-fila, que siguen en modo
    // retrocompatible) — es de los 5 endpoints /api/red/* más sensibles
    // (mueve un expediente completo entre instituciones).
    const auth = _exigirJWTAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'id de solicitud inválido.' });
    if (!DOC_SIGN_SECRET) return res.status(503).json({ ok: false, error: 'La firma de paquetes de traslado no está configurada en el servidor (falta DOC_SIGN_SECRET).' });
    await _asegurarSchemaRed();
    const filas = await db.select().from(solicitudesTraslado).where(eq(solicitudesTraslado.id, id));
    const sol = filas[0];
    if (!sol) return res.status(404).json({ ok: false, error: 'Solicitud no encontrada.' });
    if (sol.estado !== 'PENDING') return res.status(409).json({ ok: false, error: `Esta solicitud ya fue resuelta (estado: ${sol.estado}).` });
    const { skActor } = (req.body || {}) as { skActor?: string };
    if (skActor !== sol.skOrigen) return res.status(403).json({ ok: false, error: 'Solo el Rector de la institución de ORIGEN puede aprobar esta solicitud.' });

    let eOrigenResultado: any = null;
    let blobDestinoResultado: any = null;
    let nuevoIdResultado: string | number = '';

    await db.transaction(async (tx) => {
      const rowsOrigen = await tx.select().from(kvStore).where(eq(kvStore.key, sol.skOrigen));
      if (!rowsOrigen.length) throw new Error('Institución de origen no encontrada.');
      const blobOrigen: any = rowsOrigen[0].value;
      const eOrigen = (blobOrigen.ests || []).find((x: any) => String(x.numDoc || '') === sol.nuip);
      if (!eOrigen) throw new Error('El estudiante ya no existe en la institución de origen.');

      const construido = _construirPaqueteExportacionEstudiante(blobOrigen, sol.skOrigen, eOrigen.id);
      if (!construido) throw new Error('No se pudo construir el paquete de exportación.');
      const { datos } = construido;
      _marcarEstudianteInactivoPorTraslado(eOrigen);
      blobOrigen.logMatricula = blobOrigen.logMatricula || [];
      blobOrigen.logMatricula.push({
        id: 'lm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        fecha: new Date().toISOString(), usuario: auth.actorUsuario, usuarioNombre: auth.actorNombre,
        estId: eOrigen.id, estNombre: eOrigen.n || '',
        tipo: 'traslado_interinstitucional_export_estudiante',
        detalle: `Solicitud #${id} APROBADA: migración directa server-side (transacción SQL) hacia "${sol.institucionDestinoNombre}". Estudiante marcado 'Inactivo por Traslado'.`,
      });
      const nowTsO = new Date();
      await tx.update(kvStore).set({ value: blobOrigen, updatedAt: nowTsO }).where(eq(kvStore.key, sol.skOrigen));

      const rowsDestino = await tx.select().from(kvStore).where(eq(kvStore.key, sol.skDestino));
      if (!rowsDestino.length) throw new Error('Institución de destino no encontrada.');
      const blobDestino: any = rowsDestino[0].value;
      const nuevoId = _aplicarImportacionEstudianteADestino(blobDestino, datos, sol.gradoDestino);
      blobDestino.logMatricula = blobDestino.logMatricula || [];
      blobDestino.logMatricula.push({
        id: 'lm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        fecha: new Date().toISOString(), usuario: auth.actorUsuario, usuarioNombre: auth.actorNombre,
        estId: nuevoId, estNombre: eOrigen.n || '',
        tipo: 'traslado_interinstitucional_import_estudiante',
        detalle: `Solicitud #${id} APROBADA: expediente migrado directamente desde "${sol.institucionOrigenNombre}" al grado ${sol.gradoDestino} (transacción SQL).`,
      });
      const nowTsD = new Date();
      await tx.update(kvStore).set({ value: blobDestino, updatedAt: nowTsD }).where(eq(kvStore.key, sol.skDestino));

      await tx.update(solicitudesTraslado).set({ estado: 'APROBADA', actorResolutor: auth.actorNombre, estIdDestino: String(nuevoId), resolvedAt: new Date() }).where(eq(solicitudesTraslado.id, id));

      eOrigenResultado = eOrigen;
      blobDestinoResultado = blobDestino;
      nuevoIdResultado = nuevoId;
      // Las cachés/broadcast se refrescan DESPUÉS del commit (fuera de este
      // callback) — no tiene sentido notificar a otros clientes de un dato
      // que todavía podría revertirse si una sentencia posterior del mismo
      // callback fallara.
    });

    invalidarDbCache(sol.skOrigen);
    invalidarDbCache(sol.skDestino);
    broadcastChange(sol.skOrigen);
    broadcastChange(sol.skDestino);

    // RONDA 44 — DIMENSIÓN 11.c (CERRADA): reindexación INCREMENTAL — solo
    // la fila del estudiante afectado en cada institución, no toda la
    // institución (a diferencia de lo que hacía el hook de
    // POST /api/inetis/db, que sigue resincronizando completo porque no
    // sabe cuál fila cambió — aquí SÍ lo sabemos exactamente).
    await _sincronizarIndiceRedEstudiante(sol.skOrigen, eOrigenResultado);
    const eNuevo = (blobDestinoResultado.ests || []).find((x: any) => x.id === nuevoIdResultado);
    if (eNuevo) await _sincronizarIndiceRedEstudiante(sol.skDestino, eNuevo);

    return res.json({ ok: true, estIdDestino: nuevoIdResultado });
  } catch (e: any) {
    console.error('POST /api/red/solicitudes/:id/aprobar', e);
    // Un throw dentro de db.transaction() ya hizo ROLLBACK automático —
    // aquí solo se traduce el mensaje a una respuesta HTTP legible.
    const msg = (e && e.message) || 'Error interno al aprobar la solicitud.';
    const esConocido = ['Institución de origen no encontrada.', 'El estudiante ya no existe en la institución de origen.', 'No se pudo construir el paquete de exportación.', 'Institución de destino no encontrada.'].includes(msg);
    return res.status(esConocido ? 404 : 500).json({ ok: false, error: msg });
  }
});

// POST /api/red/solicitudes/:id/rechazar
app.post('/api/red/solicitudes/:id/rechazar', async (req, res) => {
  try {
    const auth = _exigirJWTAdmin(req); // RONDA 44 — DIMENSIÓN 11.b: JWT obligatorio
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'id de solicitud inválido.' });
    await _asegurarSchemaRed();
    const filas = await db.select().from(solicitudesTraslado).where(eq(solicitudesTraslado.id, id));
    const sol = filas[0];
    if (!sol) return res.status(404).json({ ok: false, error: 'Solicitud no encontrada.' });
    if (sol.estado !== 'PENDING') return res.status(409).json({ ok: false, error: `Esta solicitud ya fue resuelta (estado: ${sol.estado}).` });
    const { skActor, motivo } = (req.body || {}) as { skActor?: string; motivo?: string };
    if (skActor !== sol.skOrigen) return res.status(403).json({ ok: false, error: 'Solo el Rector de la institución de ORIGEN puede rechazar esta solicitud.' });
    await db.update(solicitudesTraslado).set({ estado: 'RECHAZADA', actorResolutor: auth.actorNombre, motivoRechazo: motivo || '', resolvedAt: new Date() }).where(eq(solicitudesTraslado.id, id));
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/red/solicitudes/:id/rechazar', e);
    return res.status(500).json({ ok: false, error: 'Error interno al rechazar la solicitud.' });
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
    // Invalida de inmediato la caché compartida (ver src/lib/gestor-cache.ts)
    // que usan tanto el candado de "Pantalla en Blanco" del K-12 (arriba)
    // como el del sistema universitario — así, cuando el Súper Admin
    // activa/desactiva/edita algo desde su panel, el efecto es instantáneo
    // en vez de esperar hasta 8 segundos a que la caché expire sola.
    invalidarCacheGestorDB();
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/inetis/gestordb', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ============================================================
// LOTE 1 — ACTIVACIÓN DINÁMICA DE MÓDULOS OPCIONALES (ver src/lib/feature-
// flags.ts para el diseño completo del interruptor). Ambos endpoints:
//   1) Exigen las credenciales REALES del Súper Admin en el cuerpo ({u,p})
//      — igual verificación que ya usa POST /api/inetis/rescate/verificar
//      más arriba — porque esta acción ejecuta una migración SQL real
//      sobre Neon (crea tablas nuevas) y no debe quedar tan abierta como
//      POST /api/inetis/gestordb (que hoy no exige ninguna credencial:
//      ver el comentario de esa ruta). Es, a propósito, un estándar más
//      alto que el resto del sistema en este punto puntual.
//   2) Solo activan el flag en gestorDB DESPUÉS de que la migración
//      termine sin lanzar ninguna excepción — así nunca queda un flag
//      "encendido" con tablas que no llegaron a crearse.
// ============================================================
app.post('/api/superadmin/activar-modulo-etc', async (req, res) => {
  try {
    const { u, p } = (req.body || {}) as { u?: string; p?: string };
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    const gestorDB: any = rows[0]?.value || null;
    const superAdmin = gestorDB?.superAdmin;
    const autorizado = !!(superAdmin && u && p && String(u) === String(superAdmin.u) && _verificarPasswordSuperAdminServidor(String(p), String(superAdmin.p || '')));
    if (!autorizado) return res.status(401).json({ ok: false, error: 'Credenciales de Súper Admin incorrectas.' });
    await ensureSchemaETC();
    await ensureSchemaEtcAuditoria(); // Ronda 33 (Lote 5) — rastro de auditoría, migración perezosa propia (ver src/db/index.ts)
    await activarFlagEnGestorDB('ETC_CONTRACTING');
    return res.json({ ok: true, modulo: 'ENABLE_ETC_CONTRACTING_MODULE' });
  } catch (e) {
    console.error('POST /api/superadmin/activar-modulo-etc', e);
    return res.status(500).json({ ok: false, error: 'Error interno al activar el Módulo ETC. Revise los logs del servidor e intente de nuevo — la operación es segura de reintentar (las tablas se crean con CREATE TABLE IF NOT EXISTS).' });
  }
});

app.post('/api/superadmin/activar-modulo-universidades', async (req, res) => {
  try {
    const { u, p } = (req.body || {}) as { u?: string; p?: string };
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    const gestorDB: any = rows[0]?.value || null;
    const superAdmin = gestorDB?.superAdmin;
    const autorizado = !!(superAdmin && u && p && String(u) === String(superAdmin.u) && _verificarPasswordSuperAdminServidor(String(p), String(superAdmin.p || '')));
    if (!autorizado) return res.status(401).json({ ok: false, error: 'Credenciales de Súper Admin incorrectas.' });
    await ensureSchemaEducacionSuperior();
    await activarFlagEnGestorDB('UNIVERSITIES');
    return res.json({ ok: true, modulo: 'ENABLE_UNIVERSITIES_MODULE' });
  } catch (e) {
    console.error('POST /api/superadmin/activar-modulo-universidades', e);
    return res.status(500).json({ ok: false, error: 'Error interno al activar el Módulo Universidades. Revise los logs del servidor e intente de nuevo — la operación es segura de reintentar (las tablas se crean con CREATE TABLE IF NOT EXISTS).' });
  }
});

// Estado actual de ambos módulos — el frontend lo usa para decidir si
// muestra los menús/pantallas correspondientes sin tener que descargar el
// gestorDB completo solo para leer 2 banderas.
app.get('/api/superadmin/modulos-estado', async (_req, res) => {
  try {
    const [etcHabilitado, universidadesHabilitado, smsHabilitado, aiNeonHabilitado, aiAuditorHabilitado, keepAliveHabilitado, simatEtcHabilitado] = await Promise.all([
      moduloHabilitado('ETC_CONTRACTING'),
      moduloHabilitado('UNIVERSITIES'),
      smsNotificacionesHabilitadasGlobalmente(),
      checkAiNeonEnabled(),
      checkAiAuditorEnabled(),
      checkKeepAliveEnabled(),
      checkSimatEtcEnabled(),
    ]);
    return res.json({
      ok: true,
      ENABLE_ETC_CONTRACTING_MODULE: etcHabilitado,
      ENABLE_UNIVERSITIES_MODULE: universidadesHabilitado,
      ENABLE_SMS_NOTIFICATIONS: smsHabilitado,
      ENABLE_AI_NEON_QUERIES: aiNeonHabilitado,
      ENABLE_AI_ECOSYSTEM_AUDITOR: aiAuditorHabilitado,
      ENABLE_RENDER_KEEPALIVE_PING: keepAliveHabilitado,
      ENABLE_SIMAT_ETC_MODULE: simatEtcHabilitado,
    });
  } catch (e) {
    console.error('GET /api/superadmin/modulos-estado', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RONDA 34 — Control granular de activación/procesos de fondo del Agente IA
// (Adán + Auditor del Ecosistema) y del Keep-Alive de Render. Los 3
// interruptores nuevos (ENABLE_AI_NEON_QUERIES, ENABLE_AI_ECOSYSTEM_AUDITOR,
// ENABLE_RENDER_KEEPALIVE_PING) siguen el MISMO estándar de seguridad que
// activar-sms-notificaciones (credenciales reales de Súper Admin) y el
// mismo mecanismo de persistencia (establecerFlagSimpleEnGestorDB) — la
// única diferencia es que estos 3 nacen en "true" (ver
// flagSimpleHabilitadoPorDefecto() en feature-flags.ts).
//
// Auditoría: cada cambio de estado de estos 3 switches se registra en
// `agent_audit_logs` — la MISMA tabla que ya usa el Auditor del Ecosistema
// para su propia bitácora (visible en GET /api/agent/logs, categoría
// 'Tecnico') — no se creó ninguna tabla de auditoría nueva y exclusiva de
// Superadmin: esta ya es genérica (category/issueDetected/actionTaken/
// status/details en JSONB), y reutilizarla evita tener dos bitácoras
// distintas que revisar en el mismo panel.
// ════════════════════════════════════════════════════════════════════════════
async function registrarAuditoriaSuperadmin(actor: string, flag: string, valor: boolean, detalleExtra?: Record<string, unknown>): Promise<void> {
  try {
    await db.insert(agentAuditLogs).values({
      category: 'Tecnico',
      issueDetected: `El Súper Admin cambió el interruptor "${flag}".`,
      actionTaken: `Establecido a ${valor ? 'ACTIVADO' : 'DESACTIVADO'} por "${actor || '(sin identificar)'}".`,
      status: 'Informativo',
      details: { flag, valor, actor: actor || '', ...(detalleExtra || {}) },
    });
  } catch (e) {
    // Nunca debe impedir que el cambio de flag surta efecto — un fallo al
    // escribir la bitácora es, en el peor caso, una auditoría incompleta,
    // nunca una razón para que el interruptor no se pueda cambiar.
    console.error('registrarAuditoriaSuperadmin', e);
  }
}

app.post('/api/superadmin/activar-ai-neon-queries', async (req, res) => {
  try {
    const { u, p, activar } = (req.body || {}) as { u?: string; p?: string; activar?: boolean };
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    const gestorDB: any = rows[0]?.value || null;
    const superAdmin = gestorDB?.superAdmin;
    const autorizado = !!(superAdmin && u && p && String(u) === String(superAdmin.u) && _verificarPasswordSuperAdminServidor(String(p), String(superAdmin.p || '')));
    if (!autorizado) return res.status(401).json({ ok: false, error: 'Credenciales de Súper Admin incorrectas.' });
    await establecerFlagSimpleEnGestorDB(FLAG_AI_NEON_QUERIES, !!activar);
    await registrarAuditoriaSuperadmin(String(u), FLAG_AI_NEON_QUERIES, !!activar);
    return res.json({ ok: true, modulo: FLAG_AI_NEON_QUERIES, activo: !!activar });
  } catch (e) {
    console.error('POST /api/superadmin/activar-ai-neon-queries', e);
    return res.status(500).json({ ok: false, error: 'Error interno al cambiar el interruptor de consultas del Agente IA a Neon.' });
  }
});

app.post('/api/superadmin/activar-ai-ecosystem-auditor', async (req, res) => {
  try {
    const { u, p, activar } = (req.body || {}) as { u?: string; p?: string; activar?: boolean };
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    const gestorDB: any = rows[0]?.value || null;
    const superAdmin = gestorDB?.superAdmin;
    const autorizado = !!(superAdmin && u && p && String(u) === String(superAdmin.u) && _verificarPasswordSuperAdminServidor(String(p), String(superAdmin.p || '')));
    if (!autorizado) return res.status(401).json({ ok: false, error: 'Credenciales de Súper Admin incorrectas.' });
    await establecerFlagSimpleEnGestorDB(FLAG_AI_ECOSYSTEM_AUDITOR, !!activar);
    await registrarAuditoriaSuperadmin(String(u), FLAG_AI_ECOSYSTEM_AUDITOR, !!activar);
    return res.json({ ok: true, modulo: FLAG_AI_ECOSYSTEM_AUDITOR, activo: !!activar });
  } catch (e) {
    console.error('POST /api/superadmin/activar-ai-ecosystem-auditor', e);
    return res.status(500).json({ ok: false, error: 'Error interno al cambiar el interruptor del Auditor del Ecosistema.' });
  }
});

app.post('/api/superadmin/activar-keepalive-ping', async (req, res) => {
  try {
    const { u, p, activar } = (req.body || {}) as { u?: string; p?: string; activar?: boolean };
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    const gestorDB: any = rows[0]?.value || null;
    const superAdmin = gestorDB?.superAdmin;
    const autorizado = !!(superAdmin && u && p && String(u) === String(superAdmin.u) && _verificarPasswordSuperAdminServidor(String(p), String(superAdmin.p || '')));
    if (!autorizado) return res.status(401).json({ ok: false, error: 'Credenciales de Súper Admin incorrectas.' });
    await establecerFlagSimpleEnGestorDB(FLAG_RENDER_KEEPALIVE_PING, !!activar);
    await registrarAuditoriaSuperadmin(String(u), FLAG_RENDER_KEEPALIVE_PING, !!activar);
    return res.json({ ok: true, modulo: FLAG_RENDER_KEEPALIVE_PING, activo: !!activar });
  } catch (e) {
    console.error('POST /api/superadmin/activar-keepalive-ping', e);
    return res.status(500).json({ ok: false, error: 'Error interno al cambiar el interruptor de Keep-Alive de Render.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RONDA 37 — Interruptor MAESTRO del Módulo SIMAT/Portal ETC-Gobernación.
// Mismo patrón EXACTO que los 3 anteriores (credenciales reales de Súper
// Admin + establecerFlagSimpleEnGestorDB + auditoría en agent_audit_logs).
// A diferencia de esos 3 (que nacen en "true"), este nace en "false"
// (standby) — ver el comentario extenso junto a FLAG_SIMAT_ETC_MODULE en
// src/lib/feature-flags.ts. Nótese que, a propósito, este endpoint NO
// ejecuta ninguna migración SQL (a diferencia de activar-modulo-etc/
// universidades): la migración de `simat_estudiantes` sigue siendo
// perezosa y ahora, además, condicionada a este mismo flag — se dispara
// sola la primera vez que un endpoint SIMAT se usa CON el flag ya en
// true (ver _asegurarSchemaSimat() en src/routes/etc.ts), nunca desde
// aquí. Esto es intencional: encender el interruptor no debe demorar la
// respuesta de este endpoint esperando una migración que quizá ni haga
// falta todavía (una ETC puede activar el módulo días antes de importar
// su primer archivo SIMAT).
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/superadmin/activar-simat-etc', async (req, res) => {
  try {
    const { u, p, activar } = (req.body || {}) as { u?: string; p?: string; activar?: boolean };
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    const gestorDB: any = rows[0]?.value || null;
    const superAdmin = gestorDB?.superAdmin;
    const autorizado = !!(superAdmin && u && p && String(u) === String(superAdmin.u) && _verificarPasswordSuperAdminServidor(String(p), String(superAdmin.p || '')));
    if (!autorizado) return res.status(401).json({ ok: false, error: 'Credenciales de Súper Admin incorrectas.' });
    await establecerFlagSimpleEnGestorDB(FLAG_SIMAT_ETC_MODULE, !!activar);
    await registrarAuditoriaSuperadmin(String(u), FLAG_SIMAT_ETC_MODULE, !!activar);
    return res.json({ ok: true, modulo: FLAG_SIMAT_ETC_MODULE, activo: !!activar });
  } catch (e) {
    console.error('POST /api/superadmin/activar-simat-etc', e);
    return res.status(500).json({ ok: false, error: 'Error interno al cambiar el interruptor del Módulo SIMAT/ETC.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RONDA 35 — Módulo "Mi Perfil": clasificación extendida de rol/decreto +
// hoja de vida, con persistencia estructural en Neon para integración con
// el módulo ETC, confirmación de contraseña obligatoria antes de guardar
// cambios sensibles (correo/teléfono/contraseña) y auditoría (fecha, hora,
// rol, IP) de cada actualización. La institución (sk) y el usuario (userU)
// llegan del propio body — el frontend ya conoce ambos porque reutiliza el
// mismo formulario/lógica de guardado de docentes (editarDocente() /
// _guardarEdicionDocente()) parametrizado en modo "perfil propio".
// ════════════════════════════════════════════════════════════════════════════
let _schemaPerfilExtendidoListo = false;
async function _asegurarSchemaPerfilExtendido(): Promise<void> {
  if (_schemaPerfilExtendidoListo) return;
  await ensureSchemaPerfilExtendido();
  _schemaPerfilExtendidoListo = true;
}

function _ipDelRequest(req: import('express').Request): string {
  const xf = req.headers['x-forwarded-for'];
  const primera = Array.isArray(xf) ? xf[0] : (typeof xf === 'string' ? xf.split(',')[0] : '');
  return (primera && primera.trim()) || req.socket?.remoteAddress || req.ip || '';
}

// Verifica la contraseña ACTUAL antes de permitir un cambio sensible
// (correo, teléfono o contraseña) — reutiliza verificarPasswordServidor(),
// el mismo verificador PBKDF2 usado en todo el resto del sistema.
app.post('/api/perfil/verificar-password', async (req, res) => {
  try {
    const { sk, userU, passwordActual } = (req.body || {}) as { sk?: string; userU?: string; passwordActual?: string };
    if (!sk || !userU || !passwordActual) {
      return res.status(400).json({ ok: false, error: 'Faltan datos (sk, userU o passwordActual).' });
    }
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, String(sk)));
    const inst: any = rows[0]?.value || null;
    const usuario = inst?.users?.find((x: any) => String(x.u) === String(userU));
    if (!usuario) return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });
    const correcta = verificarPasswordServidor(String(passwordActual), String(usuario.p || ''));
    return res.json({ ok: true, correcta });
  } catch (e) {
    console.error('POST /api/perfil/verificar-password', e);
    return res.status(500).json({ ok: false, error: 'Error interno al verificar la contraseña.' });
  }
});

// Persiste estructuralmente en Neon (perfil_docente_extendido) los campos
// ampliados del perfil (rol específico, orientador, tutor PTA, decreto
// normativo, escalafón, hoja de vida) y deja rastro en perfil_audit_log.
// NO reemplaza el guardado normal del blob JSON (que sigue haciendo
// updDB()/el motor de sincronización, igual que para cualquier otro campo
// de un docente) — este endpoint es la copia estructurada adicional que el
// módulo ETC puede consultar por (sk, userU) sin tener que interpretar el
// JSON completo de la institución.
app.post('/api/perfil/actualizar', async (req, res) => {
  try {
    await _asegurarSchemaPerfilExtendido();
    const {
      sk, userU, rol, rolEspecifico, esDocenteOrientador, esTutorPta,
      tipoDecretoNormativo, escalafon, cvUrl, cvNombreArchivo,
      camposModificados, esCambioSensible,
    } = (req.body || {}) as {
      sk?: string; userU?: string; rol?: string; rolEspecifico?: string;
      esDocenteOrientador?: boolean; esTutorPta?: boolean; tipoDecretoNormativo?: string;
      escalafon?: string; cvUrl?: string; cvNombreArchivo?: string;
      camposModificados?: string[]; esCambioSensible?: boolean;
    };
    if (!sk || !userU) return res.status(400).json({ ok: false, error: 'Faltan datos (sk o userU).' });

    const existente = await db.select().from(perfilDocenteExtendido)
      .where(and(eq(perfilDocenteExtendido.sk, String(sk)), eq(perfilDocenteExtendido.userU, String(userU))));
    const valores = {
      sk: String(sk),
      userU: String(userU),
      rolEspecifico: rolEspecifico || '',
      esDocenteOrientador: !!esDocenteOrientador,
      esTutorPta: !!esTutorPta,
      tipoDecretoNormativo: tipoDecretoNormativo || '',
      escalafon: escalafon || '',
      cvUrl: cvUrl || '',
      cvNombreArchivo: cvNombreArchivo || '',
      updatedAt: new Date(),
    };
    if (existente[0]) {
      await db.update(perfilDocenteExtendido).set(valores).where(eq(perfilDocenteExtendido.id, existente[0].id));
    } else {
      await db.insert(perfilDocenteExtendido).values(valores);
    }

    try {
      await db.insert(perfilAuditLog).values({
        sk: String(sk),
        userU: String(userU),
        rol: rol || '',
        camposModificados: Array.isArray(camposModificados) ? camposModificados : [],
        esCambioSensible: !!esCambioSensible,
        ip: _ipDelRequest(req),
      });
    } catch (e) {
      // Igual que registrarAuditoriaSuperadmin(): un fallo al auditar nunca
      // debe impedir que el perfil se guarde.
      console.error('perfil_audit_log insert', e);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/perfil/actualizar', e);
    return res.status(500).json({ ok: false, error: 'Error interno al guardar el perfil extendido.' });
  }
});

// ============================================================
// Ajuste multicanal — interruptor global "Activar Notificaciones SMS
// (Requiere Proveedor)". A diferencia de activar-modulo-etc/universidades,
// este interruptor NO ejecuta ninguna migración SQL (no es un módulo con
// tablas propias, es un canal de entrega) — solo prende/apaga
// ENABLE_SMS_NOTIFICATIONS en gestorDB.featureFlags, con el mismo estándar
// de seguridad (credenciales reales de Súper Admin) que el resto de
// interruptores sensibles de este archivo. Encenderlo NO envía ningún SMS
// por sí solo: cada Entidad Territorial sigue necesitando configurar sus
// propias credenciales de proveedor (ver PUT /api/etc/entidades/:id) para
// que algo salga de verdad por ese canal — ver src/lib/sms-provider.ts.
// ============================================================
app.post('/api/superadmin/activar-sms-notificaciones', async (req, res) => {
  try {
    const { u, p, activar } = (req.body || {}) as { u?: string; p?: string; activar?: boolean };
    const rows = await db.select().from(kvStore).where(eq(kvStore.key, GESTOR_SK));
    const gestorDB: any = rows[0]?.value || null;
    const superAdmin = gestorDB?.superAdmin;
    const autorizado = !!(superAdmin && u && p && String(u) === String(superAdmin.u) && _verificarPasswordSuperAdminServidor(String(p), String(superAdmin.p || '')));
    if (!autorizado) return res.status(401).json({ ok: false, error: 'Credenciales de Súper Admin incorrectas.' });
    await establecerFlagSimpleEnGestorDB(FLAG_SMS_NOTIFICATIONS, !!activar);
    return res.json({ ok: true, modulo: FLAG_SMS_NOTIFICATIONS, activo: !!activar });
  } catch (e) {
    console.error('POST /api/superadmin/activar-sms-notificaciones', e);
    return res.status(500).json({ ok: false, error: 'Error interno al cambiar el interruptor de notificaciones SMS.' });
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
// GET /api/inetis/email-status — diagnóstico rápido, SIN exponer ningún
// secreto (ninguna API key ni contraseña), de qué canales de correo
// quedaron activos en ESTE despliegue concreto del servidor. Pensado
// para responder en segundos preguntas como "¿de verdad se leyeron
// EMAIL_API_PROVIDER/EMAIL_API_KEY?" o "¿este Render ya tiene el código
// nuevo?" sin tener que interpretar los logs de Render — basta con abrir
// esta URL en el navegador o consultarla con curl.
// ============================================================
app.get('/api/inetis/email-status', (_req, res) => {
  return res.json({
    apiHttpConfigurado: emailApiConfigurado,
    apiHttpProveedor: emailApiProveedor,
    smtpConfigurado: smtpGeneralConfigurado,
    algunCanalConfigurado: correoGeneralConfigurado,
  });
});

// ------------------------------------------------------------------
// POST /api/inetis/email-status/enviar-prueba
// ------------------------------------------------------------------
// El endpoint de arriba (GET /email-status) solo dice si las variables
// de entorno están PRESENTES — no dice si el envío REAL funciona (un
// token con formato válido pero revocado, o un remitente no verificado
// en ZeptoMail, igual pasarían esa prueba). Este endpoint SÍ intenta un
// envío real y de una vez devuelve, en la propia respuesta JSON, el
// error exacto del proveedor — así se puede diagnosticar con un solo
// comando `curl`, sin tener que ir a buscarlo entre el resto de los
// logs de Render (que se mezclan con cada petición normal del sistema).
//
// Protegido con la misma contraseña maestra de rescate que ya existe
// (RESCATE_SUPER_ADMIN_HASH — ver arriba) para que no sea un endpoint
// público de envío de correo libre; y con el mismo limitador estricto
// que /api/inetis/rescate (5 intentos/minuto) contra fuerza bruta.
//
// Uso:
//   curl -X POST https://TU-DOMINIO/api/inetis/email-status/enviar-prueba \
//     -H "Content-Type: application/json" \
//     -d '{"to":"tu-correo-personal@gmail.com","hashRescate":"<sha256 de tu contraseña de rescate>"}'
//
// Para calcular hashRescate a partir de la contraseña, en la consola del
// navegador (F12), en cualquier página del sistema:
//   crypto.subtle.digest("SHA-256", new TextEncoder().encode("Gestor2026*"))
//     .then(b=>console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")))
app.post('/api/inetis/email-status/enviar-prueba', async (req, res) => {
  try {
    const { to, hashRescate } = req.body as { to?: string; hashRescate?: string };
    const autorizado = typeof hashRescate === 'string' && hashRescate.length > 0 && _compararHashesSeguro(hashRescate.toLowerCase(), RESCATE_SUPER_ADMIN_HASH);
    if (!autorizado) {
      return res.status(403).json({ ok: false, error: 'hashRescate inválido o faltante.' });
    }
    if (!to) {
      return res.status(400).json({ ok: false, error: 'Falta el campo "to" (correo de prueba donde recibir el envío).' });
    }
    if (!emailApiConfigurado) {
      return res.status(200).json({
        ok: false,
        canalProbado: 'ninguno',
        error: 'El canal por API HTTP no está configurado (EMAIL_API_PROVIDER/EMAIL_API_KEY ausentes) — no hay nada que probar todavía.',
      });
    }
    // Se prueba DIRECTAMENTE el canal por API HTTP (sin caer a SMTP), para
    // que la respuesta aísle con certeza si el problema está ahí — si se
    // dejara caer a SMTP automáticamente (como hace el flujo real), un
    // fallo de SMTP por puerto bloqueado podría mezclarse en la misma
    // respuesta y hacer más confuso el diagnóstico.
    const resultado = await enviarPorApiHttp({
      to: String(to),
      subject: 'Correo de prueba — Gestor Académico YC',
      text: 'Este es un correo de prueba generado por /api/inetis/email-status/enviar-prueba para verificar que el canal de correo por API HTTP funciona correctamente.',
    });
    return res.status(200).json({ ok: resultado.ok, canalProbado: emailApiProveedor, error: resultado.error || null });
  } catch (e: any) {
    console.error('POST /api/inetis/email-status/enviar-prueba', e);
    return res.status(500).json({ ok: false, error: e?.message || 'Error interno al intentar el envío de prueba.' });
  }
});

// ============================================================
// ENVÍO DE CORREO DE PROPÓSITO GENERAL (K-12 original)
// ------------------------------------------------------------------
// Este endpoint faltaba por completo en el servidor: el frontend K-12
// (03-app-core.js y 06-documentos-y-resto.js) ya llamaba a
// POST /api/inetis/send-email para "¿Olvidó contraseña?", alertas
// académicas automáticas a acudientes, comunicados masivos y el correo
// de credenciales de pre-matrícula — pero al no existir la ruta, el
// navegador recibía 404 y esos flujos mostraban "No se pudo enviar el
// correo automático" aunque el correo SÍ estuviera registrado (el
// usuario sí se encontraba; lo que fallaba era únicamente el envío).
//
// Reutiliza las mismas variables SMTP_* ya configuradas para el módulo
// universitario (ver src/lib/email-general.ts). Body esperado:
//   { to: string, subject: string, text?: string, html?: string }
// Responde siempre JSON. Éxito → 200 { ok:true }. Si SMTP no está
// configurado o el envío falla → estado distinto de 200 con
// { ok:false, error, hint } (los frontends ya existentes leen tanto el
// código HTTP como el campo "ok"/"error"/"hint", así que este contrato
// es compatible con todos los puntos de llamada tal como están hoy).
// ============================================================
app.post('/api/inetis/send-email', async (req, res) => {
  try {
    const { to, subject, text, html } = req.body as { to?: string; subject?: string; text?: string; html?: string };
    if (!to || !subject) {
      return res.status(400).json({ ok: false, error: 'Faltan campos requeridos (to, subject).', hint: 'Datos incompletos' });
    }
    const resultado = await enviarCorreoGeneral({ to: String(to), subject: String(subject), text, html });
    if (resultado.ok) return res.json({ ok: true });
    // 503 = servicio no disponible (SMTP no configurado); 500 = falló el envío puntual.
    const status = resultado.hint === 'SMTP no configurado' ? 503 : 500;
    return res.status(status).json(resultado);
  } catch (e: any) {
    console.error('POST /api/inetis/send-email', e);
    return res.status(500).json({ ok: false, error: 'Error interno', hint: 'Error interno' });
  }
});

// ============================================================
// "4 pilares de autonomía" — Pilar 1 (Self-Service Onboarding):
// RESTABLECIMIENTO DE CONTRASEÑA CON TOKEN DE UN SOLO USO
// ------------------------------------------------------------
// Mecanismo ADICIONAL al flujo existente de "¿Olvidó su contraseña?"
// (contraseña temporal enviada vía POST /api/inetis/send-email) — no lo
// reemplaza ni lo toca. Ver src/lib/reset-tokens.ts para el diseño
// completo (por qué es un JWT de un solo uso, alcance de esta ronda,
// etc.). El enlace enviado por correo apunta al propio front del sistema
// con los parámetros necesarios para que una pantalla nueva (a construir
// en el front cuando se adopte este flujo) pueda leerlos y llamar a
// /confirmar.
// ============================================================
app.post('/api/inetis/auth/restablecer/solicitar', async (req, res) => {
  try {
    const { sk, usuario } = req.body as { sk?: string; usuario?: string };
    if (!sk || !usuario) {
      return res.status(400).json({ ok: false, error: 'Faltan campos requeridos (sk, usuario).' });
    }
    // Respuesta genérica SIEMPRE (se explique o no abajo): evita que alguien
    // pueda usar este endpoint para averiguar qué nombres de usuario existen
    // en una institución con solo observar si la respuesta cambia.
    const respuestaGenerica = { ok: true, mensaje: 'Si el usuario existe, se envió un correo con instrucciones para restablecer la contraseña.' };
    const blob = await leerBlobInstitucion(String(sk));
    if (!blob || !Array.isArray(blob.users)) return res.json(respuestaGenerica);
    const cuenta = blob.users.find((u: any) => u && u.u === usuario);
    const correoDestino = cuenta && (cuenta.correo || cuenta.email);
    if (!cuenta || !correoDestino) return res.json(respuestaGenerica);
    const token = await emitirTokenRestablecimiento(String(sk), String(usuario));
    const baseUrl = (process.env.SITIO_BASE_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const enlace = `${baseUrl}/?restablecerToken=${encodeURIComponent(token)}&sk=${encodeURIComponent(String(sk))}`;
    const nombreCuenta = cuenta.n || cuenta.u;
    await enviarCorreoGeneral({
      to: String(correoDestino),
      subject: 'Restablecer contraseña — Gestor Académico YC',
      text: `Hola ${nombreCuenta},\n\nRecibimos una solicitud para restablecer su contraseña en Gestor Académico YC.\n\nUse este enlace (válido por 30 minutos, y solo puede usarse una vez) para crear una nueva contraseña:\n${enlace}\n\nSi usted no solicitó esto, ignore este correo — su contraseña actual sigue siendo válida.`,
      html: `<p>Hola ${nombreCuenta},</p><p>Recibimos una solicitud para restablecer su contraseña en <b>Gestor Académico YC</b>.</p><p>Use este enlace (válido por 30 minutos, y solo puede usarse una vez) para crear una nueva contraseña:</p><p><a href="${enlace}">${enlace}</a></p><p>Si usted no solicitó esto, ignore este correo — su contraseña actual sigue siendo válida.</p>`,
    });
    // Se responde ok:true igual, tanto si el correo se pudo entregar en el
    // acto como si no (por ejemplo, el proveedor de correo aún en revisión
    // — ver checklist): el usuario no debe saber por este medio si el envío
    // interno falló, y el enlace ya quedó registrado y es válido de todas
    // formas por si el correo llega con retraso desde el panel del proveedor.
    return res.json(respuestaGenerica);
  } catch (e) {
    console.error('POST /api/inetis/auth/restablecer/solicitar', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

app.post('/api/inetis/auth/restablecer/confirmar', async (req, res) => {
  try {
    const { sk, token, nuevaPassword } = req.body as { sk?: string; token?: string; nuevaPassword?: string };
    if (!sk || !token || !nuevaPassword) {
      return res.status(400).json({ ok: false, error: 'Faltan campos requeridos (sk, token, nuevaPassword).' });
    }
    if (String(nuevaPassword).length < 6) {
      return res.status(400).json({ ok: false, error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }
    const payload = await verificarYConsumirTokenRestablecimiento(String(token));
    if (!payload || payload.sk !== String(sk)) {
      return res.status(400).json({ ok: false, error: 'El enlace no es válido, ya fue usado, o expiró. Solicite uno nuevo.' });
    }
    // Se lee directo de Neon (sin caché) para no arriesgar sobrescribir con
    // un blob de hace unos segundos justo en la operación más sensible
    // (cambiar una contraseña) de todo este mecanismo.
    const filas = await db.select().from(kvStore).where(eq(kvStore.key, payload.sk));
    if (!filas.length) return res.status(404).json({ ok: false, error: 'Institución no encontrada.' });
    const blob: any = filas[0].value;
    const idx = Array.isArray(blob.users) ? blob.users.findIndex((u: any) => u && u.u === payload.usuario) : -1;
    if (idx === -1) return res.status(404).json({ ok: false, error: 'La cuenta ya no existe.' });
    blob.users[idx].p = hashPasswordServidor(String(nuevaPassword));
    const nowTs = new Date();
    await db
      .insert(kvStore)
      .values({ key: payload.sk, value: blob, updatedAt: nowTs })
      .onConflictDoUpdate({ target: kvStore.key, set: { value: blob, updatedAt: nowTs } });
    guardarDbCache(payload.sk, blob, nowTs, true);
    broadcastChange(payload.sk);
    return res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente. Ya puede iniciar sesión con su nueva contraseña.' });
  } catch (e) {
    console.error('POST /api/inetis/auth/restablecer/confirmar', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ============================================================
// "4 pilares de autonomía" — Pilar 1 (Self-Service Onboarding):
// REGISTRO POR CÓDIGO DE INVITACIÓN INSTITUCIONAL
// ------------------------------------------------------------
// El rector/admin genera un código de 6 dígitos para un rol (docente,
// directivo, gestor…) y lo comparte por fuera del sistema (WhatsApp,
// cartelera, etc.); cualquiera con ese código puede autoregistrarse SIN
// aprobación manual — se le crea de inmediato una cuenta en db.users con
// el rol que trae el código, lista para iniciar sesión.
//
// Alcance de esta ronda: cuentas de "personal" (mismo alcance que el
// restablecimiento de contraseña — ver reset-tokens.ts). El auto-registro
// de ESTUDIANTES/ACUDIENTES queda fuera a propósito: esas cuentas están
// ligadas a un registro de matrícula (grado, grupo, número de documento,
// datos del acudiente) que hoy solo se crea desde "Estudiantes" por un
// admin — abrir su creación a autoregistro exige definir reglas de negocio
// nuevas (a qué grado/grupo queda un estudiante que se autoregistra, cómo
// se evitan duplicados por número de documento, etc.) que no vinieron
// especificadas; se documenta como pendiente en el checklist.
//
// Nota sobre el modelo de confianza: igual que TODO el sistema K-12 hoy
// (que confía en que quien llama a POST /api/inetis/db con un "sk" válido
// tiene derecho a leer/escribir los datos de esa institución — el "sk" es,
// en la práctica, el secreto compartido de la institución), este endpoint
// confía en que quien conoce el "sk" y llama a /generar es realmente un
// admin de esa institución. No es una debilidad NUEVA: quien ya tiene el
// "sk" podría de todas formas escribir directamente en db.users vía POST
// /api/inetis/db. Se documenta explícitamente para que quede claro que es
// una decisión consciente de consistencia con el modelo existente, no un
// descuido.
// ============================================================
function _generarCodigoInvitacion(): string {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos, 100000-999999
}

app.post('/api/inetis/auth/invitacion/generar', async (req, res) => {
  try {
    const { sk, rol, creadoPor, usosMax, expiraEnHoras } = req.body as { sk?: string; rol?: string; creadoPor?: string; usosMax?: number | null; expiraEnHoras?: number | null };
    const rolesValidos = ['docente', 'directivo', 'gestor', 'rector', 'admin'];
    if (!sk || !rol || !rolesValidos.includes(String(rol))) {
      return res.status(400).json({ ok: false, error: `Faltan campos requeridos, o "rol" inválido (use uno de: ${rolesValidos.join(', ')}).` });
    }
    const filas = await db.select().from(kvStore).where(eq(kvStore.key, String(sk)));
    if (!filas.length) return res.status(404).json({ ok: false, error: 'Institución no encontrada.' });
    const blob: any = filas[0].value || {};
    if (!Array.isArray(blob.codigosInvitacion)) blob.codigosInvitacion = [];
    const codigo = _generarCodigoInvitacion();
    const ahora = new Date();
    const horasVigencia = typeof expiraEnHoras === 'number' && expiraEnHoras > 0 ? expiraEnHoras : 72; // 72h por defecto: cómodo para compartir, no queda abierto indefinidamente
    blob.codigosInvitacion.push({
      codigo,
      rol: String(rol),
      creadoPor: creadoPor ? String(creadoPor) : 'admin',
      creadoEn: ahora.toISOString(),
      expiraEn: new Date(ahora.getTime() + horasVigencia * 60 * 60 * 1000).toISOString(),
      usosMax: typeof usosMax === 'number' && usosMax > 0 ? usosMax : 1, // por defecto, de un solo uso
      usosActuales: 0,
    });
    await db
      .insert(kvStore)
      .values({ key: String(sk), value: blob, updatedAt: ahora })
      .onConflictDoUpdate({ target: kvStore.key, set: { value: blob, updatedAt: ahora } });
    guardarDbCache(String(sk), blob, ahora, true);
    broadcastChange(String(sk));
    return res.json({ ok: true, codigo, expiraEn: blob.codigosInvitacion[blob.codigosInvitacion.length - 1].expiraEn });
  } catch (e) {
    console.error('POST /api/inetis/auth/invitacion/generar', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

app.post('/api/inetis/auth/invitacion/registrar', async (req, res) => {
  try {
    const { sk, codigo, u, p, n, correo } = req.body as { sk?: string; codigo?: string; u?: string; p?: string; n?: string; correo?: string };
    if (!sk || !codigo || !u || !p || !n) {
      return res.status(400).json({ ok: false, error: 'Faltan campos requeridos (sk, codigo, u, p, n).' });
    }
    if (String(p).length < 6) {
      return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' });
    }
    const filas = await db.select().from(kvStore).where(eq(kvStore.key, String(sk)));
    if (!filas.length) return res.status(404).json({ ok: false, error: 'Institución no encontrada.' });
    const blob: any = filas[0].value || {};
    const lista: any[] = Array.isArray(blob.codigosInvitacion) ? blob.codigosInvitacion : [];
    const ahoraIso = new Date().toISOString();
    const entrada = lista.find(c => c && c.codigo === String(codigo) && c.expiraEn > ahoraIso && c.usosActuales < c.usosMax);
    if (!entrada) {
      return res.status(400).json({ ok: false, error: 'El código de invitación no es válido, ya expiró, o ya alcanzó su límite de usos.' });
    }
    if (!Array.isArray(blob.users)) blob.users = [];
    if (blob.users.some((x: any) => x && x.u === String(u))) {
      return res.status(409).json({ ok: false, error: 'Ese nombre de usuario ya está en uso en esta institución. Elija otro.' });
    }
    blob.users.push({
      u: String(u),
      p: hashPasswordServidor(String(p)),
      n: String(n),
      r: entrada.rol,
      correo: correo ? String(correo) : '',
    });
    entrada.usosActuales = (entrada.usosActuales || 0) + 1;
    const nowTs = new Date();
    await db
      .insert(kvStore)
      .values({ key: String(sk), value: blob, updatedAt: nowTs })
      .onConflictDoUpdate({ target: kvStore.key, set: { value: blob, updatedAt: nowTs } });
    guardarDbCache(String(sk), blob, nowTs, true);
    broadcastChange(String(sk));
    return res.json({ ok: true, rol: entrada.rol, mensaje: 'Cuenta creada correctamente. Ya puede iniciar sesión.' });
  } catch (e) {
    console.error('POST /api/inetis/auth/invitacion/registrar', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ============================================================
// "4 pilares de autonomía" — Pilar 2 (Módulo Financiero + Pasarela de Pago
// Multi-propósito vía Webhooks): WOMPI, MERCADO PAGO, STRIPE
// ------------------------------------------------------------------------------
// Andamiaje genérico — ver el comentario grande en src/db/schema.ts sobre
// fin_transacciones/fin_suscripciones y src/lib/pagos-webhooks.ts sobre la
// verificación de firma de cada proveedor y la convención de "reference".
//
// Cada endpoint queda "vivo" solo si su secreto de verificación está
// configurado por variable de entorno — si no, responde 503 sin procesar
// nada (mismo criterio de "seguro cuando no está configurado" ya usado
// para los proveedores de correo). Si el secreto SÍ está configurado pero
// la firma no coincide, responde 401 y NO registra la transacción — así
// una llamada falsificada a esta URL pública nunca puede inventarse un
// pago aprobado.
//
// Pendiente de decisión del usuario antes de ir a producción (documentado
// en el checklist): elegir proveedor(es) reales, sus credenciales, precios
// y reglas de negocio; y conectar "entregableGenerado" con la generación
// real del PDF firmado (certificados/paz y salvo) — aquí solo se deja el
// punto de extensión marcado, no se inventa esa integración sin poder
// verificarla contra el generador de PDFs real del sistema.
// ============================================================
// Ronda 12, Sección 3: acredita un pago de mensualidad/pensión en el
// estado de cuenta del estudiante (blob K-12, campo est.pagos[], el mismo
// arreglo que ya usa el resto del sistema — ver su creación en
// cambiarEstadoPM()/_procesarMatriculaDesdeSolicitud() en el frontend).
// Se lee la fila directo de Neon (sin caché) para no arriesgar
// sobrescribir un blob desactualizado en la operación más sensible de
// todo este mecanismo: registrar dinero recibido.
async function _registrarPagoMensualidadEnBlob(
  ref: ReferenciaPago,
  datos: { proveedor: string; proveedorPagoId: string; montoCentavos: number; moneda: string },
  nowTs: Date,
) {
  try {
    if (!ref.sk || !ref.estudianteId) return;
    const filas = await db.select().from(kvStore).where(eq(kvStore.key, ref.sk));
    if (!filas.length) return;
    const blob: any = filas[0].value;
    if (!Array.isArray(blob.ests)) return;
    const idx = blob.ests.findIndex((e: any) => e && String(e.id) === String(ref.estudianteId));
    if (idx === -1) {
      console.error(`_registrarPagoMensualidadEnBlob: estudiante ${ref.estudianteId} no encontrado en ${ref.sk} — pago ${datos.proveedor}/${datos.proveedorPagoId} quedó registrado en fin_transacciones pero SIN acreditar en el estado de cuenta. Requiere conciliación manual.`);
      return;
    }
    const est = { ...blob.ests[idx] };
    est.pagos = Array.isArray(est.pagos) ? [...est.pagos] : [];
    est.pagos.push({
      concepto: ref.concepto || 'Mensualidad',
      montoCentavos: datos.montoCentavos,
      moneda: datos.moneda,
      proveedor: datos.proveedor,
      proveedorPagoId: datos.proveedorPagoId,
      fecha: nowTs.toISOString(),
      origen: 'webhook-automatico',
    });
    est.pensionAlDia = true; // habilita de inmediato lo que dependa de este indicador (ej. bloqueo por mora)
    blob.ests[idx] = est;
    await db
      .insert(kvStore)
      .values({ key: ref.sk, value: blob, updatedAt: nowTs })
      .onConflictDoUpdate({ target: kvStore.key, set: { value: blob, updatedAt: nowTs } });
    guardarDbCache(ref.sk, blob, nowTs, true);
    broadcastChange(ref.sk);
  } catch (e) {
    console.error('_registrarPagoMensualidadEnBlob', e);
  }
}

// Ronda 12, Sección 3 → ciclo de vigencia cerrado en Ronda 13: activa/
// renueva la suscripción SaaS de la institución. Reglas de negocio dadas
// explícitamente por el usuario: 30 días calendario para planes
// mensuales, 365 días para planes anuales — se detecta cuál es por el
// texto del "plan" (viene del concepto de la referencia de pago, ej.
// "Plan-Institucional-Anual"); si no dice "anual"/"annual" en ningún
// lado, se asume mensual (30 días), que es el caso más común y el que ya
// existía antes de esta ronda.
const DIAS_CICLO_SAAS_ANUAL = 365;
const DIAS_CICLO_SAAS_MENSUAL = 30;
function _esPlanAnualSaas(plan: string): boolean {
  return /anual|annual|yearly|year\b/i.test(String(plan || ''));
}
async function _actualizarSuscripcionSaas(
  ref: ReferenciaPago,
  datos: { proveedor: string; proveedorPagoId: string; metadata: any },
  nowTs: Date,
) {
  try {
    if (!ref.sk) return;
    const plan = ref.concepto || 'basico';
    const dias = _esPlanAnualSaas(plan) ? DIAS_CICLO_SAAS_ANUAL : DIAS_CICLO_SAAS_MENSUAL;
    const vigenteHasta = new Date(nowTs.getTime() + dias * 24 * 60 * 60 * 1000);
    await db
      .insert(finSuscripciones)
      .values({
        sk: ref.sk,
        plan,
        estado: 'activa',
        proveedor: datos.proveedor,
        proveedorSuscripcionId: datos.proveedorPagoId,
        vigenteHasta,
        metadata: datos.metadata,
        // Ronda 13: cada renovación reinicia el aviso de vencimiento — así
        // la alerta de "vence en 5 días" se vuelve a poder enviar en ESTE
        // nuevo ciclo, en vez de quedar marcada como "ya enviada" para
        // siempre desde el ciclo anterior.
        alertaVencimientoEnviada: false,
        updatedAt: nowTs,
      })
      .onConflictDoUpdate({
        target: finSuscripciones.sk,
        set: { plan, estado: 'activa', proveedor: datos.proveedor, proveedorSuscripcionId: datos.proveedorPagoId, vigenteHasta, metadata: datos.metadata, alertaVencimientoEnviada: false, updatedAt: nowTs },
      });
  } catch (e) {
    console.error('_actualizarSuscripcionSaas', e);
  }
}

// Ronda 13, punto 3: reversión de una mensualidad ya acreditada cuando el
// proveedor la reembolsa/contracarga después. Regla dada explícitamente
// por el usuario: el concepto vuelve a "pendiente/mora" — en la
// arquitectura de este sistema, eso es est.pensionAlDia=false. Se ubica
// (y marca) la entrada específica de est.pagos[] que corresponde a ESTE
// pago exacto (por proveedor+proveedorPagoId, igual llave que usa
// fin_transacciones) en vez de simplemente vaciar todo el arreglo, para
// no borrar el historial de otros pagos distintos del mismo estudiante.
async function _revertirPagoMensualidadEnBlob(
  ref: ReferenciaPago,
  datos: { proveedor: string; proveedorPagoId: string },
  nowTs: Date,
) {
  try {
    if (!ref.sk || !ref.estudianteId) return;
    const filas = await db.select().from(kvStore).where(eq(kvStore.key, ref.sk));
    if (!filas.length) return;
    const blob: any = filas[0].value;
    if (!Array.isArray(blob.ests)) return;
    const idx = blob.ests.findIndex((e: any) => e && String(e.id) === String(ref.estudianteId));
    if (idx === -1) return;
    const est = { ...blob.ests[idx] };
    est.pagos = Array.isArray(est.pagos) ? est.pagos.map((p: any) =>
      p && p.proveedor === datos.proveedor && p.proveedorPagoId === datos.proveedorPagoId
        ? { ...p, estado: 'reembolsado', fechaReembolso: nowTs.toISOString() }
        : p,
    ) : [];
    // Vuelve a "PENDIENTE/MORA" — simplificación consciente (documentada en
    // el checklist): no se intenta calcular si OTRO pago distinto sigue
    // cubriendo el periodo, se asume que la única mensualidad reembolsada
    // deja al estudiante en mora hasta que se verifique/registre un nuevo pago.
    est.pensionAlDia = false;
    blob.ests[idx] = est;
    await db
      .insert(kvStore)
      .values({ key: ref.sk, value: blob, updatedAt: nowTs })
      .onConflictDoUpdate({ target: kvStore.key, set: { value: blob, updatedAt: nowTs } });
    guardarDbCache(ref.sk, blob, nowTs, true);
    broadcastChange(ref.sk);
  } catch (e) {
    console.error('_revertirPagoMensualidadEnBlob', e);
  }
}

// Ronda 13, punto 2: "periodo de gracia de 3 días antes de congelar las
// funciones administrativas". Solo aplica a instituciones que
// EFECTIVAMENTE tienen una fila en fin_suscripciones (es decir, que ya
// procesaron al menos un pago de suscripción SaaS por webhook) — la
// inmensa mayoría de instituciones hoy NO usan esta facturación
// automática todavía (es andamiaje, ver Ronda 11/12), así que para ellas
// esto sigue sin tener ningún efecto, exactamente como antes de esta ronda.
//
// Adaptación de alcance documentada: en la arquitectura de este sistema
// K-12 (un solo blob JSON por institución, un solo endpoint genérico de
// escritura — POST /api/inetis/db — para TODO: notas, asistencia,
// matrículas, configuración, etc.), no existe una forma de distinguir
// "una acción administrativa" de "una acción operativa cualquiera" a
// nivel de endpoint. "Congelar las funciones administrativas" se
// implementa entonces como bloquear la ESCRITURA (POST) mientras la
// LECTURA (GET) se mantiene disponible: el rector, los docentes y las
// familias siguen viendo toda la información ya guardada, pero no se
// pueden guardar cambios nuevos hasta que se renueve el pago o el Súper
// Admin intervenga manualmente (el rescate de Súper Admin, igual que con
// "Pantalla en Blanco", siempre puede pasar por encima de este candado).
const DIAS_GRACIA_SAAS = 3;
async function verificarSuscripcionSaas(sk: string): Promise<{ ok: boolean; motivo?: string }> {
  try {
    const filas = await db.select().from(finSuscripciones).where(eq(finSuscripciones.sk, sk));
    if (!filas.length) return { ok: true };
    const sus: any = filas[0];
    if (!sus.vigenteHasta) return { ok: true };
    const limiteConGracia = new Date(new Date(sus.vigenteHasta).getTime() + DIAS_GRACIA_SAAS * 24 * 60 * 60 * 1000);
    if (new Date() <= limiteConGracia) return { ok: true };
    return {
      ok: false,
      motivo: 'La suscripción de esta institución venció y ya pasó el periodo de gracia de 3 días. Los cambios no se pueden guardar hasta renovar el plan — puede seguir consultando la información existente. Si esto es un error, contacte al administrador del sistema.',
    };
  } catch {
    // Ante un error de esta verificación puntual, no se bloquea todo el
    // sistema — mismo criterio que verificarEstadoInstitucion().
    return { ok: true };
  }
}

// Ronda 13, punto 2: alerta automática por correo 5 días antes de que
// venza el plan SaaS — pedida explícitamente por el usuario. Se envía al
// correo del primer usuario con rol 'admin' o 'rector' que tenga un
// correo/email registrado en la institución (no existe hoy un campo
// dedicado de "correo de facturación" separado; se documenta como
// adaptación razonable en el checklist). No se reenvía más de una vez
// por ciclo de vigencia (fin_suscripciones.alertaVencimientoEnviada, que
// se reinicia a false en cada renovación — ver _actualizarSuscripcionSaas()).
async function enviarAlertasVencimientoSaas() {
  try {
    const filas = await db.select().from(finSuscripciones);
    const ahora = Date.now();
    const CINCO_DIAS_MS = 5 * 24 * 60 * 60 * 1000;
    for (const sus of filas as any[]) {
      try {
        if (sus.estado !== 'activa' || sus.alertaVencimientoEnviada || !sus.vigenteHasta) continue;
        const msRestantes = new Date(sus.vigenteHasta).getTime() - ahora;
        if (msRestantes > CINCO_DIAS_MS || msRestantes < 0) continue; // todavía faltan más de 5 días, o ya venció (eso lo maneja el periodo de gracia, no esta alerta preventiva)
        const blob = await leerBlobInstitucion(sus.sk);
        if (!blob || !Array.isArray(blob.users)) continue;
        const contacto = blob.users.find((u: any) => u && (u.r === 'admin' || u.r === 'rector') && (u.correo || u.email));
        const correoDestino = contacto && (contacto.correo || contacto.email);
        if (!correoDestino) {
          console.warn(`⚠️  Suscripción SaaS de "${sus.sk}" vence en menos de 5 días, pero no se encontró un correo de admin/rector para avisar.`);
          continue;
        }
        const diasRestantes = Math.max(0, Math.ceil(msRestantes / (24 * 60 * 60 * 1000)));
        const resultado = await enviarCorreoGeneral({
          to: String(correoDestino),
          subject: `Su plan vence en ${diasRestantes} día(s) — ${blob.nombre || 'Gestor Académico YC'}`,
          text: `Hola,\n\nLe informamos que la suscripción de "${blob.nombre || 'su institución'}" vence el ${new Date(sus.vigenteHasta).toLocaleDateString('es-CO')} (en ${diasRestantes} día(s)).\n\nPara evitar interrupciones en las funciones administrativas del sistema, renueve su plan antes de esa fecha. Después del vencimiento hay un periodo de gracia de 3 días antes de que se congelen los cambios.\n\nEste es un mensaje automático.`,
        });
        if (resultado.ok) {
          await db.update(finSuscripciones).set({ alertaVencimientoEnviada: true }).where(eq(finSuscripciones.sk, sus.sk));
          console.log(`📧 Alerta de vencimiento SaaS enviada a "${correoDestino}" (${sus.sk}, vence en ${diasRestantes} día(s)).`);
        }
      } catch (errUno) {
        console.error(`❌ Error procesando alerta de vencimiento SaaS de "${sus.sk}":`, errUno);
      }
    }
  } catch (err) {
    console.error('❌ Error general enviando alertas de vencimiento SaaS:', err);
  }
}

async function _registrarTransaccionPago(datos: {
  proveedor: string;
  proveedorPagoId: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'reembolsado';
  montoCentavos: number;
  moneda: string;
  referencia: string | null;
  metadata: any;
}) {
  const ref = datos.referencia ? parsearReferenciaPago(datos.referencia) : null;
  const nowTs = new Date();

  // ── Idempotencia (Ronda 12) ──────────────────────────────────────────
  // Los tres proveedores documentan que SÍ pueden reenviar el mismo
  // webhook más de una vez (reintentos de red, reconciliación, etc.).
  // Sin esto, cada reintento de un pago que YA se había marcado
  // "aprobado" volvería a abonar la misma mensualidad o a "reactivar" la
  // suscripción SaaS otra vez, duplicando el efecto. Se compara contra el
  // estado que YA estaba guardado para esta transacción (identificada por
  // proveedor + su id externo — la misma llave única de la tabla) antes
  // de decidir si hay que disparar el Punto de Extensión.
  const filaPrevia = await db
    .select()
    .from(finTransacciones)
    .where(and(eq(finTransacciones.proveedor, datos.proveedor), eq(finTransacciones.proveedorPagoId, datos.proveedorPagoId)));
  const estadoPrevio = filaPrevia[0]?.estado;
  const esNuevaAprobacion = datos.estado === 'aprobado' && estadoPrevio !== 'aprobado';
  // Ronda 13, punto 3: reversión — solo dispara al TRANSICIONAR de
  // "aprobado" a "reembolsado" (idéntico criterio de idempotencia que la
  // aprobación: un reintento del webhook con el mismo estado ya reflejado
  // no vuelve a disparar nada).
  const esNuevaReversion = datos.estado === 'reembolsado' && estadoPrevio === 'aprobado';

  let entregableGenerado = filaPrevia[0]?.entregableGenerado || false;
  let codigoVerificacionFinal: string | null = filaPrevia[0]?.codigoVerificacion || null;
  let revocado = filaPrevia[0]?.revocado || false;
  let metadataFinal: any = datos.metadata;

  // ── Punto de extensión (Ronda 11 → implementado en Ronda 12/13) ──────
  if (esNuevaAprobacion && ref) {
    if (ref.tipo === 'tramite') {
      // NO se genera el PDF en el servidor: todo el sistema genera sus
      // PDFs (boletines, actas) 100% en el navegador con jsPDF, que
      // requiere un DOM/Canvas que Node no tiene, y el proyecto no trae
      // ninguna librería de PDF server-side (decisión consciente de no
      // agregar una dependencia nueva — pdfkit/puppeteer — sin que el
      // usuario la pida explícitamente). En su lugar, el servidor genera y
      // FIRMA los DATOS del certificado (igual que ya hace con los
      // boletines — ver _firmarBlob()/DOC_SIGN_SECRET) y los deja listos
      // para que el estudiante/acudiente los descargue: el navegador ya
      // tiene jsPDF + generación de QR cargados (ver _generarBoletinesPDF
      // y _dibujarFirmaDigitalPDF en 03-app-core.js) y puede dibujar el
      // certificado igual que dibuja un boletín. El QR apunta a la URL
      // pública GET /api/certificados/verificar/:hash (Ronda 13, pedida
      // explícitamente por el usuario) en vez de requerir la app abierta.
      const datosCertificado = {
        sk: ref.sk,
        estudianteId: ref.estudianteId,
        concepto: ref.concepto || 'Certificado',
        proveedor: datos.proveedor,
        proveedorPagoId: datos.proveedorPagoId,
        montoCentavos: datos.montoCentavos,
        moneda: datos.moneda,
        fechaEmision: nowTs.toISOString(),
      };
      const codigoVerificacion = _firmarBlob(datosCertificado);
      metadataFinal = { ...datos.metadata, certificado: { ...datosCertificado, codigoVerificacion } };
      codigoVerificacionFinal = codigoVerificacion;
      revocado = false; // una nueva aprobación (ej. tras reintentar un pago previamente rechazado) siempre emite un certificado vigente
      entregableGenerado = true;
    } else if (ref.tipo === 'mensualidad') {
      await _registrarPagoMensualidadEnBlob(ref, datos, nowTs);
    } else if (ref.tipo === 'suscripcion_saas') {
      await _actualizarSuscripcionSaas(ref, datos, nowTs);
    }
  } else if (esNuevaReversion && ref) {
    // Ronda 13, punto 3 — reglas dadas explícitamente por el usuario para
    // REFUNDED/CHARGEBACK/DISPUTED (los tres ya normalizados a "reembolsado"
    // por normalizarEstadoPago()):
    if (ref.tipo === 'mensualidad') {
      await _revertirPagoMensualidadEnBlob(ref, datos, nowTs);
    } else if (ref.tipo === 'tramite') {
      // "el hash del código QR de ese PDF se marca como REVOCADO/NO VÁLIDO"
      revocado = true;
    }
    // suscripcion_saas: el usuario no pidió una regla específica para el
    // reembolso de una suscripción SaaS (distinto de una mensualidad de
    // estudiante); se deja documentado como punto abierto en el checklist
    // en vez de inventar una consecuencia (¿se corta el servicio de
    // inmediato? ¿se deja vigente hasta el fin del ciclo ya pagado?).
  }

  await db
    .insert(finTransacciones)
    .values({
      sk: ref?.sk || null,
      tipo: ref?.tipo || 'tramite',
      concepto: ref?.concepto || '',
      estudianteId: ref?.estudianteId || null,
      proveedor: datos.proveedor,
      proveedorPagoId: datos.proveedorPagoId,
      estado: datos.estado,
      montoCentavos: datos.montoCentavos,
      moneda: datos.moneda,
      metadata: metadataFinal,
      entregableGenerado,
      codigoVerificacion: codigoVerificacionFinal,
      revocado,
      updatedAt: nowTs,
    })
    .onConflictDoUpdate({
      target: [finTransacciones.proveedor, finTransacciones.proveedorPagoId],
      set: { estado: datos.estado, metadata: metadataFinal, entregableGenerado, codigoVerificacion: codigoVerificacionFinal, revocado, updatedAt: nowTs },
    });
}

// Ronda 12: consulta pública (acotada por "sk" — mismo modelo de confianza
// que el resto del sistema K-12) de los certificados/trámites ya
// aprobados y firmados, para que el frontend (portal del estudiante o del
// acudiente) los liste y genere el PDF final con jsPDF en el navegador.
app.get('/api/inetis/pagos/certificados', async (req, res) => {
  try {
    const sk = String(req.query.sk || '');
    const estudianteId = req.query.estudianteId ? String(req.query.estudianteId) : null;
    if (!sk) return res.status(400).json({ ok: false, error: 'Falta "sk".' });
    const condiciones = [eq(finTransacciones.sk, sk), eq(finTransacciones.tipo, 'tramite'), eq(finTransacciones.entregableGenerado, true)];
    if (estudianteId) condiciones.push(eq(finTransacciones.estudianteId, estudianteId));
    const filas = await db.select().from(finTransacciones).where(and(...condiciones));
    const certificados = filas
      .map((f: any) => (f.metadata?.certificado ? { ...f.metadata.certificado, revocado: !!f.revocado } : null))
      .filter(Boolean);
    return res.json({ ok: true, certificados });
  } catch (e) {
    console.error('GET /api/inetis/pagos/certificados', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// Ronda 13, punto 1: URL PÚBLICA de verificación de certificados —
// pedida explícitamente por el usuario para que el código QR del PDF
// funcione sin necesidad de tener la app abierta (a diferencia del
// panel "Verificar Autenticidad" de boletines, que exige pegar/escanear
// dentro de la aplicación). Es de solo lectura y no expone el número de
// documento del estudiante ni datos financieros sensibles — solo lo
// necesario para confirmar que el documento es auténtico y sigue vigente.
function _htmlPaginaVerificacionCertificado(opts: {
  encontrado: boolean;
  revocado?: boolean;
  nombreInst?: string;
  nombreEst?: string;
  concepto?: string;
  fechaEmision?: string;
  codigo?: string;
}): string {
  const { encontrado, revocado, nombreInst, nombreEst, concepto, fechaEmision, codigo } = opts;
  const estadoTitulo = !encontrado ? '❌ Código no encontrado' : revocado ? '⚠️ Documento REVOCADO' : '✅ Documento auténtico y vigente';
  const estadoColor = !encontrado ? '#7f8c8d' : revocado ? '#c0392b' : '#1e8449';
  const estadoDetalle = !encontrado
    ? 'Este código de verificación no corresponde a ningún certificado emitido por este sistema. Verifique que lo escribió/escaneó correctamente.'
    : revocado
    ? 'El pago que originó este certificado fue reembolsado o contracargado después de emitido. Este documento ya NO es válido como soporte oficial.'
    : 'Este certificado fue emitido y firmado digitalmente por el sistema académico de la institución, y el pago que lo originó sigue vigente.';
  const filas = encontrado
    ? `<tr><td style="padding:6px 10px;color:#666;font-weight:bold">Institución</td><td style="padding:6px 10px">${nombreInst || '—'}</td></tr>
       <tr><td style="padding:6px 10px;color:#666;font-weight:bold">Estudiante</td><td style="padding:6px 10px">${nombreEst || '—'}</td></tr>
       <tr><td style="padding:6px 10px;color:#666;font-weight:bold">Concepto</td><td style="padding:6px 10px">${concepto || '—'}</td></tr>
       <tr><td style="padding:6px 10px;color:#666;font-weight:bold">Fecha de emisión</td><td style="padding:6px 10px">${fechaEmision ? new Date(fechaEmision).toLocaleString('es-CO') : '—'}</td></tr>
       <tr><td style="padding:6px 10px;color:#666;font-weight:bold">Código</td><td style="padding:6px 10px"><code>${codigo || '—'}</code></td></tr>`
    : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verificación de certificado — Gestor Académico YC</title>
  <style>body{font-family:Arial,sans-serif;background:#f0f4f8;margin:0;padding:24px;color:#1a1a2e}.card{max-width:520px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);overflow:hidden}.head{background:#003366;color:#fff;padding:20px;text-align:center}.body{padding:24px}table{width:100%;border-collapse:collapse;margin-top:12px}tr:nth-child(even){background:#f7f9fb}</style>
  </head><body><div class="card"><div class="head"><h2 style="margin:0">🎓 Gestor Académico YC</h2><p style="margin:6px 0 0;font-size:0.85rem;color:#cce4ff">Verificación pública de certificados</p></div>
  <div class="body"><h3 style="color:${estadoColor};margin:0 0 8px">${estadoTitulo}</h3><p style="font-size:0.9rem;color:#444;line-height:1.5">${estadoDetalle}</p>
  ${filas ? `<table>${filas}</table>` : ''}
  </div></div></body></html>`;
}
app.get('/api/certificados/verificar/:hash', async (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  try {
    const hash = String(req.params.hash || '').trim().toUpperCase();
    if (!hash) return res.status(400).send(_htmlPaginaVerificacionCertificado({ encontrado: false }));
    const filas = await db.select().from(finTransacciones).where(eq(finTransacciones.codigoVerificacion, hash));
    if (!filas.length) return res.status(404).send(_htmlPaginaVerificacionCertificado({ encontrado: false }));
    const fila: any = filas[0];
    const cert = fila.metadata?.certificado || {};
    let nombreInst = cert.sk || '';
    let nombreEst = cert.estudianteId || '';
    try {
      const blob = await leerBlobInstitucion(String(cert.sk || ''));
      if (blob) {
        nombreInst = blob.nombre || nombreInst;
        const est = Array.isArray(blob.ests) ? blob.ests.find((e: any) => e && String(e.id) === String(cert.estudianteId)) : null;
        if (est) nombreEst = est.n || `${est.nombres || ''} ${est.apellidos || ''}`.trim() || nombreEst;
      }
    } catch { /* si no se puede leer el blob, se sigue mostrando el resultado con lo que ya se tiene */ }
    return res.send(_htmlPaginaVerificacionCertificado({
      encontrado: true,
      revocado: !!fila.revocado,
      nombreInst,
      nombreEst,
      concepto: cert.concepto,
      fechaEmision: cert.fechaEmision,
      codigo: hash,
    }));
  } catch (e) {
    console.error('GET /api/certificados/verificar/:hash', e);
    return res.status(500).send(_htmlPaginaVerificacionCertificado({ encontrado: false }));
  }
});

app.post('/api/payments/webhook/wompi', async (req, res) => {
  try {
    const secreto = process.env.WOMPI_EVENTOS_SECRETO;
    if (!secreto) return res.status(503).json({ ok: false, error: 'Wompi no está configurado (falta WOMPI_EVENTOS_SECRETO).' });
    if (!verificarFirmaWompi(req.body, secreto)) return res.status(401).json({ ok: false, error: 'Firma inválida.' });
    const tx = req.body?.data?.transaction || {};
    await _registrarTransaccionPago({
      proveedor: 'wompi',
      proveedorPagoId: String(tx.id || ''),
      estado: normalizarEstadoPago('wompi', tx.status),
      montoCentavos: Number(tx.amount_in_cents) || 0,
      moneda: String(tx.currency || 'COP'),
      referencia: tx.reference || null,
      metadata: req.body,
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/payments/webhook/wompi', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

app.post('/api/payments/webhook/mercadopago', async (req, res) => {
  try {
    const secreto = process.env.MERCADOPAGO_WEBHOOK_SECRETO;
    if (!secreto) return res.status(503).json({ ok: false, error: 'Mercado Pago no está configurado (falta MERCADOPAGO_WEBHOOK_SECRETO).' });
    const dataId = String(req.body?.data?.id || req.query['data.id'] || '');
    const xRequestId = String(req.headers['x-request-id'] || '');
    const xSignature = String(req.headers['x-signature'] || '');
    if (!verificarFirmaMercadoPago(dataId, xRequestId, xSignature, secreto)) {
      return res.status(401).json({ ok: false, error: 'Firma inválida.' });
    }
    // La notificación de Mercado Pago solo trae el ID — para conocer el
    // estado real y la "external_reference" hay que consultar su API con
    // el access token de la cuenta. Si no está configurado, se registra la
    // transacción como "pendiente" para conciliar manualmente después.
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    let estado: 'pendiente' | 'aprobado' | 'rechazado' | 'reembolsado' = 'pendiente';
    let montoCentavos = 0;
    let referencia: string | null = null;
    let detalle: any = req.body;
    if (accessToken && dataId) {
      try {
        const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (r.ok) {
          const pago: any = await r.json();
          estado = normalizarEstadoPago('mercadopago', pago.status);
          montoCentavos = Math.round(Number(pago.transaction_amount || 0) * 100);
          referencia = pago.external_reference || null;
          detalle = pago;
        } else {
          console.warn(`⚠️ Mercado Pago: no se pudo consultar el pago ${dataId} (HTTP ${r.status}) — se registra como pendiente para conciliar.`);
        }
      } catch (errFetch) {
        console.error('⚠️ Mercado Pago: error consultando el pago para conciliar', errFetch);
      }
    } else if (!accessToken) {
      console.warn('⚠️ Mercado Pago: MERCADOPAGO_ACCESS_TOKEN no configurado — no se puede resolver el estado/referencia real del pago, se registra como pendiente.');
    }
    await _registrarTransaccionPago({
      proveedor: 'mercadopago',
      proveedorPagoId: dataId,
      estado,
      montoCentavos,
      moneda: 'COP',
      referencia,
      metadata: detalle,
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/payments/webhook/mercadopago', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

app.post('/api/payments/webhook/stripe', async (req, res) => {
  try {
    const secreto = process.env.STRIPE_WEBHOOK_SECRETO;
    if (!secreto) return res.status(503).json({ ok: false, error: 'Stripe no está configurado (falta STRIPE_WEBHOOK_SECRETO).' });
    const cuerpoCrudo: Buffer | undefined = (req as any).rawBody;
    const firmaHeader = String(req.headers['stripe-signature'] || '');
    if (!cuerpoCrudo || !verificarFirmaStripe(cuerpoCrudo, firmaHeader, secreto)) {
      return res.status(401).json({ ok: false, error: 'Firma inválida.' });
    }
    const evento = req.body;
    const objeto = evento?.data?.object || {};
    const estadoBruto = objeto.status || evento?.type || '';
    await _registrarTransaccionPago({
      proveedor: 'stripe',
      proveedorPagoId: String(objeto.id || evento?.id || ''),
      estado: normalizarEstadoPago('stripe', estadoBruto),
      montoCentavos: Number(objeto.amount_total ?? objeto.amount ?? 0),
      moneda: String(objeto.currency || 'usd').toUpperCase(),
      referencia: objeto.client_reference_id || objeto.metadata?.referencia || null,
      metadata: evento,
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/payments/webhook/stripe', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
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
// RONDA 37 — VERIFICACIÓN DIGITAL PÚBLICA CON HASH/QR (certificados,
// boletines, libros de calificaciones).
// ------------------------------------------------------------------
// La firma HMAC de arriba (boletin/firmar|verificar) es "stateless": para
// comprobar un código hay que volver a mandarle al servidor TODOS los
// datos originales del documento — algo que solo la propia app puede
// hacer, porque ya los tiene. Eso es excelente para el flujo interno de
// "escanee el QR con esta misma app" (funciona sin conexión a Neon en el
// momento de verificar, ideal para sedes rurales), pero NO sirve para el
// requisito nuevo: un tercero cualquiera (ej. un empleador) que escanea el
// QR impreso y solo tiene el hash, sin la app y sin los datos originales.
//
// Por eso este es un mecanismo APARTE (no reemplaza al anterior, coexiste
// con él): el servidor SÍ recuerda, en `certificados_emitidos`, un resumen
// mínimo y no sensible de cada documento emitido (nombre del estudiante,
// tipo de documento, institución, fecha de emisión) asociado a un hash
// único. Deliberadamente NUNCA se guardan notas, número de documento
// completo, dirección u otro dato sensible — ni siquiera el `datos`
// original del documento: si se filtrara la tabla completa, lo máximo que
// se expone es lo mismo que ya se ve impreso en el propio boletín.
//
// Hash = SHA-256 de (datos_no_sensibles + timestamp + DOC_SIGN_SECRET como
// sal del servidor) — igual principio de "el navegador nunca puede fabricar
// uno válido por su cuenta" que ya usa _firmarBlob().
// ============================================================
let _schemaCertificadosListo = false;
async function _asegurarSchemaCertificados(): Promise<void> {
  if (_schemaCertificadosListo) return;
  await ensureSchemaCertificados();
  _schemaCertificadosListo = true;
}

function _generarHashCertificado(payload: unknown): string {
  const sal = DOC_SIGN_SECRET || 'inseguro-configure-DOC_SIGN_SECRET';
  return crypto.createHash('sha256').update(_jsonEstable(payload) + '|' + sal).digest('hex');
}

// Emite (registra) un nuevo hash de verificación para un documento — se
// llama desde el navegador justo al generar el PDF (boletín, certificado o
// libro de calificaciones), después de que el documento ya está armado.
// Solo recibe/guarda los campos no sensibles necesarios para la vista
// pública; el PDF en sí sigue generándose 100% en el navegador (jsPDF),
// igual que el resto del sistema.
// RONDA 38 — se agregaron `documentoEstudiante` (opcional, ej. "T.I. 1234567")
// y `anioLectivo` (opcional) al cuerpo aceptado, para que la vista pública
// pueda mostrarlos (ver _htmlVerificacionCertificado abajo). Siguen siendo
// OPCIONALES a propósito: los boletines (Ronda 37) ya venían llamando a este
// endpoint sin esos 2 campos, y esta ronda no debía romper esa integración
// existente — si no se envían, simplemente quedan como '' en la tabla.
app.post('/api/inetis/certificado/emitir-hash', async (req, res) => {
  try {
    const { sk, tipoDocumento, nombreEstudiante, documentoEstudiante, anioLectivo, institucion, emitidoPor } = (req.body || {}) as {
      sk?: string; tipoDocumento?: string; nombreEstudiante?: string; documentoEstudiante?: string; anioLectivo?: string; institucion?: string; emitidoPor?: string;
    };
    if (!sk || !tipoDocumento || !nombreEstudiante) {
      return res.status(400).json({ ok: false, error: 'sk, tipoDocumento y nombreEstudiante son obligatorios.' });
    }
    await _asegurarSchemaCertificados();
    const ip = _ipDelRequest(req);
    const ahora = new Date();
    const hash = _generarHashCertificado({ sk, tipoDocumento, nombreEstudiante, institucion: institucion || '', ts: ahora.toISOString(), rnd: crypto.randomBytes(8).toString('hex') });
    await db.insert(certificadosEmitidos).values({
      hash, sk, tipoDocumento: String(tipoDocumento), nombreEstudiante: String(nombreEstudiante),
      documentoEstudiante: String(documentoEstudiante || ''), anioLectivo: String(anioLectivo || ''),
      institucion: String(institucion || ''), emitidoPor: String(emitidoPor || ''), ip, fechaEmision: ahora,
    });
    return res.json({ ok: true, hash, urlVerificacion: '/verificar-certificado?hash=' + hash });
  } catch (e) {
    console.error('POST /api/inetis/certificado/emitir-hash', e);
    return res.status(500).json({ ok: false, error: 'Error interno al emitir el hash de verificación.' });
  }
});

// Vista PÚBLICA (sin autenticación, sin sesión) de verificación por hash.
// Devuelve SOLO nombre, tipo de documento, institución y fecha de emisión
// — nunca notas, número de documento, ni ningún otro dato del estudiante.
// Responde HTML legible por defecto (para que alguien que escanea el QR con
// la cámara de su teléfono vea algo presentable de inmediato) y JSON si se
// pide explícitamente (?formato=json), para integraciones.
app.get('/verificar-certificado', async (req, res) => {
  try {
    const hash = String(req.query.hash || '').trim();
    const quiereJson = String(req.query.formato || '') === 'json';
    if (!hash) {
      if (quiereJson) return res.status(400).json({ ok: false, error: 'Falta el parámetro hash.' });
      return res.status(400).send(_htmlVerificacionCertificado({ valido: false, error: 'Falta el parámetro "hash" en el enlace.' }));
    }
    await _asegurarSchemaCertificados();
    const filas = await db.select().from(certificadosEmitidos).where(eq(certificadosEmitidos.hash, hash));
    const registro = filas[0];
    if (!registro) {
      if (quiereJson) return res.json({ ok: true, valido: false });
      return res.send(_htmlVerificacionCertificado({ valido: false }));
    }
    const datosPublicos = {
      valido: true,
      nombreEstudiante: registro.nombreEstudiante,
      documentoEstudiante: registro.documentoEstudiante || '',
      anioLectivo: registro.anioLectivo || '',
      tipoDocumento: registro.tipoDocumento,
      institucion: registro.institucion,
      fechaEmision: registro.fechaEmision,
      estado: 'Válido — Emitido Oficialmente',
    };
    if (quiereJson) return res.json({ ok: true, ...datosPublicos });
    return res.send(_htmlVerificacionCertificado(datosPublicos));
  } catch (e) {
    console.error('GET /verificar-certificado', e);
    if (String(req.query.formato || '') === 'json') return res.status(500).json({ ok: false, error: 'Error interno' });
    return res.status(500).send(_htmlVerificacionCertificado({ valido: false, error: 'Error interno al verificar el documento.' }));
  }
});

function _escaparHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
// RONDA 38 — nombres legibles para cada `tipoDocumento` interno (el mismo
// valor que cada generador de PDF envía a /emitir-hash), tal como el
// usuario pidió explícitamente ("Certificado de Estudio, Acta de Grado,
// Boletín de Notas") en la vista pública. Si llega un tipo no listado
// (ej. de una integración futura), se muestra tal cual llegó — nunca se
// oculta el tipo de documento.
const ETIQUETAS_TIPO_DOCUMENTO_PUBLICAS: Record<string, string> = {
  boletin: 'Boletín de Notas',
  informe_final: 'Informe Final Anual',
  certificado_calificaciones: 'Certificado de Calificaciones',
  certificado_estudio: 'Certificado de Estudios',
  constancia_matricula: 'Constancia de Matrícula',
  constancia_estudios_cursado: 'Constancia de Estudios Cursados',
  acta_grado: 'Acta de Grado',
  acta_promocion: 'Acta de Promoción/Graduación',
  acta: 'Acta Institucional',
  certificado_comportamiento: 'Certificado de Comportamiento / Conducta', // RONDA 39
};
function _htmlVerificacionCertificado(datos: { valido: boolean; error?: string; nombreEstudiante?: string; documentoEstudiante?: string; anioLectivo?: string; tipoDocumento?: string; institucion?: string; fechaEmision?: unknown; estado?: string }): string {
  const color = datos.valido ? '#1e7e34' : '#c0392b';
  const titulo = datos.valido ? '✅ Documento auténtico' : '❌ Documento no verificado';
  const tipoLegible = ETIQUETAS_TIPO_DOCUMENTO_PUBLICAS[String(datos.tipoDocumento || '')] || String(datos.tipoDocumento || '');
  const cuerpo = datos.valido
    ? `<table style="margin:0 auto;text-align:left;font-size:1rem;line-height:1.8">
        <tr><td style="color:#666;padding-right:12px">Institución:</td><td><b>${_escaparHtml(datos.institucion)}</b></td></tr>
        <tr><td style="color:#666;padding-right:12px">Tipo de documento:</td><td><b>${_escaparHtml(tipoLegible)}</b></td></tr>
        <tr><td style="color:#666;padding-right:12px">Estudiante:</td><td><b>${_escaparHtml(datos.nombreEstudiante)}${datos.documentoEstudiante ? ' — ' + _escaparHtml(datos.documentoEstudiante) : ''}</b></td></tr>
        ${datos.anioLectivo ? `<tr><td style="color:#666;padding-right:12px">Año lectivo:</td><td><b>${_escaparHtml(datos.anioLectivo)}</b></td></tr>` : ''}
        <tr><td style="color:#666;padding-right:12px">Fecha de emisión:</td><td><b>${_escaparHtml(datos.fechaEmision ? new Date(datos.fechaEmision as any).toLocaleString('es-CO') : '')}</b></td></tr>
        <tr><td style="color:#666;padding-right:12px">Estado:</td><td><b style="color:#1e7e34">${_escaparHtml(datos.estado || 'Válido — Emitido Oficialmente')}</b></td></tr>
      </table>`
    : `<p style="color:#666">${_escaparHtml(datos.error || 'El código no corresponde a ningún documento emitido por esta plataforma, o fue escrito incorrectamente.')}</p>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Verificación de documento — GESTOR ACADÉMICO YC</title></head>
    <body style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;background:#f4f6f8;margin:0;padding:32px 16px;text-align:center;color:#222">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 22px;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
        <h2 style="color:${color};margin-top:0">${titulo}</h2>
        ${cuerpo}
        <p style="font-size:0.75rem;color:#aaa;margin-top:24px">Verificación pública de GESTOR ACADÉMICO YC — no requiere iniciar sesión.</p>
      </div>
    </body></html>`;
}

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

// ════════════════════════════════════════════════════════════════════════════
// RONDA 44 — DIMENSIÓN 7: CRUD básico de `ai_subscriptions` (base SaaS, sin
// cobros reales activados). No se enlaza todavía a ningún cobro/webhook —
// es infraestructura de datos, consultable/editable por un Súper Admin
// desde un futuro panel. Usa SQL crudo (`db.execute(sql\`...\`)`) porque la
// tabla no tiene (aún) una definición Drizzle propia en schema.ts — decisión
// deliberada para no tocar ese archivo compartido por muchas otras rondas
// en esta pasada; si en el futuro se necesita más que CRUD simple, conviene
// promoverla a una tabla Drizzle formal.
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/ai-subscriptions/:sk', async (req, res) => {
  try {
    const sk = req.params.sk;
    const r = await db.execute(sql`SELECT * FROM ai_subscriptions WHERE sk = ${sk} LIMIT 1`);
    const fila = (r as any).rows?.[0] || null;
    if (!fila) {
      return res.json({ ok: true, subscription: { sk, proveedor: 'gemini', plan: 'gratuito', estado: 'activa', limiteMensual: 0, usoMesActual: 0 } });
    }
    return res.json({ ok: true, subscription: fila });
  } catch (e: any) {
    console.error('GET /api/ai-subscriptions/:sk', e);
    return res.status(500).json({ ok: false, error: 'Error interno.' });
  }
});

app.post('/api/ai-subscriptions/:sk', async (req, res) => {
  try {
    const auth = _exigirJWTAdmin(req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
    const sk = req.params.sk;
    const { proveedor = 'gemini', plan = 'gratuito', estado = 'activa', limiteMensual = 0 } = (req.body || {}) as any;
    await db.execute(sql`
      INSERT INTO ai_subscriptions (sk, proveedor, plan, estado, limite_mensual, updated_at)
      VALUES (${sk}, ${proveedor}, ${plan}, ${estado}, ${limiteMensual}, NOW())
      ON CONFLICT (sk) DO UPDATE SET proveedor = ${proveedor}, plan = ${plan}, estado = ${estado}, limite_mensual = ${limiteMensual}, updated_at = NOW()
    `);
    return res.json({ ok: true });
  } catch (e: any) {
    console.error('POST /api/ai-subscriptions/:sk', e);
    return res.status(500).json({ ok: false, error: 'Error interno.' });
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

    // RONDA 48: diagnóstico migrado al wrapper central de resiliencia —
    // ya no reintenta manualmente ni declara su propia lista de modelos.
    let activeModel = '';
    let lastError = '';

    const diag = await generarContenidoConResiliencia(genAI, {
      contents: 'Hola',
      config: { maxOutputTokens: 10 },
    }, { etiqueta: 'Adán diagnóstico' });

    if (diag.ok && diag.resultado && (diag.resultado.text || diag.resultado.candidates)) {
      activeModel = diag.modeloUsado || '';
    } else {
      lastError = diag.error?.message || String(diag.error || 'Error desconocido');
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

    // Ronda 35 — checkAiNeonEnabled(): si el Súper Admin apagó "Agente IA -
    // Consultas Base de Datos Neon" Y esta solicitud es una consulta de
    // auditoría global del ecosistema (gestorMode:true, chat propio del
    // Súper Admin), se responde el mensaje estático exacto pedido (200,
    // conversacional — nunca un 403/501) SIN llamar a Gemini. Planeación de
    // clase, actividades/dinámicas y cualquier otra consulta docente normal
    // (sin gestorMode) siguen funcionando con normalidad aunque el flag esté
    // apagado (ver criterio documentado arriba de _esConsultaDeAuditoriaGlobal()).
    if (_esConsultaDeAuditoriaGlobal(context) && !(await checkAiNeonEnabled())) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ content: MENSAJE_PAUSA_CONSULTA_DB_IA })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

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

    // RONDA 48: migrado al wrapper central de resiliencia
    // (llamarGeminiConResiliencia) — reintenta el MISMO modelo con backoff
    // exponencial ante 429/503, y solo cambia de modelo ante 404 o backoff
    // agotado. Se conserva exactamente el mismo comportamiento de streaming
    // de antes (chat.create + sendMessageStream), solo se centralizó el
    // bucle de reintento/cambio de modelo.
    const intento = await llamarGeminiConResiliencia(async (candidateModel) => {
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
        return chat.sendMessageStream({
          message: [
            { text: userText || 'Analiza esta imagen.' },
            { inlineData: { mimeType: imagePart.mimeType || 'image/jpeg', data: imagePart.data } },
          ],
        });
      }
      return chat.sendMessageStream({ message: userText });
    }, { etiqueta: 'Adán chat' });

    const stream = intento.ok ? intento.resultado : null;
    if (!stream) {
      // RONDA 50 — se detectó que aquí se filtraba el `.message` crudo del
      // SDK de Google (incluyendo JSON técnico en 429/RESOURCE_EXHAUSTED)
      // directo al chat del usuario final. Ahora se usa siempre un mensaje
      // amigable clasificado por tipo de error (429/503/404/otro), NUNCA el
      // objeto de error original. El detalle técnico completo sigue yendo a
      // los logs del servidor vía console.error más abajo si aplica.
      console.error(`[Adán chat] Fallaron todos los modelos (${intento.modelosIntentados.join(', ')}):`, intento.error);
      res.write(`data: ${JSON.stringify({ content: mensajeAmigablePorError(intento) })}\n\n`);
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
    // RONDA 50 — mismo criterio: el catch-all también pasaba `e.message`
    // crudo al usuario (por ejemplo, si el error ocurre antes de llegar al
    // wrapper de resiliencia). Se sanea igual con mensajeAmigablePorError.
    console.error('POST /api/inetis/ai/chat error:', e);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
    try {
      res.write(`data: ${JSON.stringify({ content: mensajeAmigablePorError(e) })}\n\n`);
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

    // Ronda 35 — mismo criterio que POST /api/inetis/ai/chat (ver comentario
    // extenso ahí): 200 con el mensaje estático exacto, no un error.
    if (_esConsultaDeAuditoriaGlobal(context) && !(await checkAiNeonEnabled())) {
      return res.json({ ok: true, content: MENSAJE_PAUSA_CONSULTA_DB_IA });
    }

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

    // RONDA 48: migrado al wrapper central de resiliencia.
    const intentoGeneral = await generarContenidoConResiliencia(genAI, {
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
      contents: userText,
    }, { etiqueta: 'Adán general' });

    const resultText = intentoGeneral.ok ? (intentoGeneral.resultado?.text || '') : '';

    if (!resultText && !intentoGeneral.ok) {
      // RONDA 50 — se detectó que aquí se filtraba `lastError?.message` (JSON
      // técnico del SDK de Google en 429/RESOURCE_EXHAUSTED, etc.) tanto en
      // `error` como en `content`. IMPORTANTE: varios puntos del frontend
      // (gestor-academico/dist/modules/03-app-core.js, ej.
      // generarDescDesdeArchivoIA y la generación de observador) hacen
      // `throw new Error(data.error)` y muestran ese `err.message` tal cual
      // en un customAlert — por eso `error` también debe llevar el mensaje
      // amigable ya sanitizado (nunca un código técnico ni el objeto crudo),
      // igual que `content`.
      console.error(`[Adán general] Fallaron todos los modelos (${intentoGeneral.modelosIntentados.join(', ')}):`, intentoGeneral.error);
      const mensajeAmigable = mensajeAmigablePorError(intentoGeneral);
      return res.json({
        ok: false,
        error: mensajeAmigable,
        content: mensajeAmigable
      });
    }

    return res.json({ ok: true, content: resultText || '' });
  } catch (e: unknown) {
    console.error('POST /api/inetis/ai/general', e);
    const mensajeAmigable = mensajeAmigablePorError(e);
    return res.json({ ok: false, error: mensajeAmigable, content: mensajeAmigable });
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

    // Ronda 35 — este endpoint genera reportes psicopedagógicos individuales
    // de aula (inasistencias/observador de UN estudiante/grado), nunca una
    // auditoría global de infraestructura, así que queda EXCLUIDO a propósito
    // del switch ENABLE_AI_NEON_QUERIES: debe seguir funcionando siempre,
    // esté el switch encendido o apagado (ver criterio documentado arriba de
    // _esConsultaDeAuditoriaGlobal()).

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

    // RONDA 48: migrado al wrapper central de resiliencia.
    const intentoPsico = await generarContenidoConResiliencia(genAI, {
      config: {
        systemInstruction: buildSystemPrompt(context || {}),
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
      contents: promptText,
    }, { etiqueta: 'Adán psicopedagógico' });

    // RONDA 50 — antes, si TODOS los modelos fallaban, este endpoint
    // devolvía `ok:true` con `report:''` (falla silenciosa, sin avisar al
    // usuario). Ahora se detecta ese caso explícitamente y se responde con
    // el mismo mensaje amigable clasificado, nunca el error crudo.
    if (!intentoPsico.ok) {
      console.error(`[Adán psicopedagógico] Fallaron todos los modelos (${intentoPsico.modelosIntentados.join(', ')}):`, intentoPsico.error);
      return res.json({ ok: false, error: intentoPsico.tipoError || 'ERROR_GEMINI', report: mensajeAmigablePorError(intentoPsico) });
    }

    const resultText = intentoPsico.resultado?.text || '';
    return res.json({ ok: true, report: resultText });
  } catch (e: any) {
    // RONDA 50 — se detectó que aquí se filtraba `e?.message` crudo. Se sanea
    // igual que en los otros 3 endpoints.
    console.error('Error en /api/inetis/ai/psicopedagogico:', e);
    return res.status(500).json({ ok: false, error: 'ERROR_INTERNO', report: mensajeAmigablePorError(e) });
  }
});

// ============================================================
// A06b · RUTAS — MÓDULO REPOSITORIO
// ============================================================

app.use('/api/repositorio', repositorioRouter);
app.use('/api/lms', lmsRouter);
// AGENTE AUTÓNOMO Y AUDITOR SUPREMO DEL ECOSISTEMA — ver
// src/services/ecosystemAgent.js y src/routes/agent.js. Router propio (no
// exige sesión de institución: lo usa el Súper Admin desde su panel, y el
// cron interno lo llama directamente sin pasar por HTTP).
app.use('/api/agent', agentRouter);

// ============================================================
// RONDA 49 — MONITOREO DE INFRAESTRUCTURA Y TELEMETRÍA DEL SERVIDOR
// ------------------------------------------------------------------------------
// Control de acceso: mismo patrón ya usado en el resto del panel del
// Súper Admin para acciones sensibles de servidor — el token de rescate
// firmado (`_tieneRescateValido`, HMAC, ver el bloque "ACCESO DE RESCATE
// DEL SÚPER ADMIN" más arriba en este archivo), que YA se emite de forma
// transparente en cuanto el Súper Admin inicia sesión normalmente (no le
// pide nada aparte) y viaja solo. Se prefirió sobre exigir {u,p} en cada
// GET (como hacen activar-modulo-etc/universidades) porque este endpoint
// se sondea repetidamente desde el panel (botón "Recargar Telemetría",
// carga inicial de la pestaña) y pedir la contraseña en cada sondeo sería
// mala experiencia — el token de rescate ya es, en esencia, el "JWT de
// sesión de Súper Admin" que este proyecto usa (firmado, con expiración de
// 12h), así que reutilizarlo aquí es exactamente el "JWT si aplica" que
// pidió esta ronda. Se extendió `_envolverFetchParaRescate` en
// 03-app-core.js para que el token viaje automáticamente también hacia
// esta URL (antes solo viajaba hacia /api/inetis/db).
// ============================================================
app.get('/api/admin/infrastructure-status', async (req, res) => {
  if (!_tieneRescateValido(req)) {
    return res.status(401).json({ ok: false, error: 'NO_AUTORIZADO', mensaje: 'Esta ruta requiere una sesión válida de Súper Admin.' });
  }
  try {
    // IMPORTANTE: esta ruta se sondea a demanda (carga de la pestaña, botón
    // "Recargar Telemetría") — a propósito solo LEE la telemetría y evalúa
    // los umbrales para mostrarlos (`infraTelemetry.evaluarAlertas`), sin
    // llamar a `procesarAlertas()` (eso escribiría en agent_audit_logs y
    // podría disparar un correo en CADA clic del botón, rompiendo el
    // anti-spam pensado para el job programado). El job de cada 15 minutos
    // (`ejecutarCicloMonitoreo`, ver iniciarMonitoreoInfraestructura más
    // abajo) es el único que registra notificaciones/envía correos.
    const telemetria = await infraTelemetry.obtenerTelemetria();
    const alertas = infraTelemetry.evaluarAlertas(telemetria);
    return res.json({ ok: true, telemetria, alertas });
  } catch (e: any) {
    console.error('GET /api/admin/infrastructure-status', e);
    return res.status(500).json({ ok: false, error: 'Error interno al recolectar la telemetría del servidor.' });
  }
});

// Ronda 20: bitácora de conflictos de sincronización — ver
// src/routes/sync-log.js. Reutiliza agent_audit_logs (categoría
// "Sincronizacion"), por eso las filas aparecen solas en el mismo panel
// "🤖 Auditoría IA / Agente" sin tener que tocar routes/agent.js.
app.use('/api/sync-log', syncLogRouter);
// Sistema INDEPENDIENTE de Educación Superior — ver el comentario al
// inicio de src/routes/university.ts. No comparte lógica con el resto
// del backend K-12; solo lee/escribe el mismo kv_store para no duplicar
// la base de usuarios/estudiantes.
app.use('/api/university', universityRouter);

// ============================================================
// LOTE 1 — MÓDULO ETC (Entidades Territoriales Certificadas) + MÓDULO
// UNIVERSIDADES/EDUCACIÓN SUPERIOR (catálogo) — ambos apagados por
// defecto; cada router se autoprotege con checkModuleEnabled() como su
// PRIMER middleware (ver src/routes/etc.ts / educacion-superior.ts), así
// que mientras el Súper Admin no los active, cualquier ruta bajo estos dos
// prefijos responde 403 "Módulo no activado" sin tocar Neon.
// ============================================================
app.use('/api/etc', etcRouter);
app.use('/api/educacion-superior', educacionSuperiorRouter);
app.use('/api/contratacion', contratacionRouter);

// ============================================================
// MÓDULO UNIVERSITARIO ENTERPRISE (LMS/SIS completo) — INTEGRACIÓN DIRECTA
// ============================================================
// Reutiliza EXACTAMENTE el mismo esquema de sesión que ya usa el sistema
// universitario existente (mismo token HMAC firmado con
// DOC_SIGN_SECRET/UNIV_SIGN_SECRET, emitido por POST /api/university/auth/token):
//   1) exigirSesionUniv        → exige "Authorization: Bearer <token>" y
//                                  deja la sesión verificada en req.sesionUniv
//   2) verificación de institución activa/bloqueada, igual que en
//      src/routes/university.ts (línea ~155), para que un Súper Admin
//      pueda suspender la institución y que el módulo LMS deje de
//      responder de inmediato, sin sesiones "colgadas".
// La compresión (gzip/brotli) y el límite de payload JSON ya están
// aplicados de forma GLOBAL más arriba (app.use(compression(...)),
// express.json({ limit: '50mb' })) — no hace falta repetirlos aquí.
app.use(
  '/api/university-lms',
  exigirSesionUniv,
  async (req: any, res: any, next: any) => {
    try {
      const estado = await verificarInstitucionActivaUniv(req.sesionUniv.sk);
      if (!estado.ok) return res.status(403).json({ error: estado.motivo, institucionPausada: true });
      next();
    } catch (e) {
      next(e);
    }
  },
  universityLmsRouter
);

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

// ============================================================
// "4 pilares de autonomía" — Pilar 4 (Tareas Programadas / Mantenimiento
// Autónomo). Mismo patrón que el respaldo automático de arriba: funciones
// idempotentes que se pueden llamar tantas veces como haga falta sin
// causar daño, programadas con setTimeout/setInterval nativos de Node
// (sin librerías de cron nuevas, siguiendo el mismo criterio ya usado en
// todo este proyecto para no sumar dependencias sin necesidad real).
// ============================================================

// ── 4-a. Cierre autónomo de planillas a la medianoche de la fecha límite ──
// Cuando la fecha "hasta" de un periodo (configurada en Cronograma de
// Notas, db.cronograma.p<N>) ya pasó y ese periodo seguía marcado como
// abierto (db.periodosActivos[N-1]===true), se cierra automáticamente
// (mismo campo, mismo efecto, que si el admin lo cerrara a mano desde
// Cronograma de Notas) — así ya no hace falta que un humano recuerde
// cerrar la planilla justo el día en que vence el periodo.
async function cerrarPlanillasVencidasAutomaticamente() {
  try {
    const todasLasFilas = await db.select().from(kvStore);
    const filasInstituciones = todasLasFilas.filter((f) => !f.key.startsWith('_'));
    const hoy = new Date().toISOString().slice(0, 10);
    for (const fila of filasInstituciones) {
      try {
        const blob: any = fila.value;
        if (!blob || !blob.cronograma || !Array.isArray(blob.periodosActivos)) continue;
        const numPeriodos = (blob.config && blob.config.numPeriodos) || blob.periodosActivos.length || 4;
        let huboCambios = false;
        for (let p = 1; p <= numPeriodos; p++) {
          const rango = blob.cronograma['p' + p];
          if (rango && rango.hasta && hoy > rango.hasta && blob.periodosActivos[p - 1] !== false) {
            blob.periodosActivos[p - 1] = false;
            huboCambios = true;
            console.log(`🔒 Periodo ${p} de "${fila.key}" cerrado automáticamente (fecha límite ${rango.hasta} ya pasó).`);
          }
        }
        if (huboCambios) {
          const nowTs = new Date();
          await db.update(kvStore).set({ value: blob, updatedAt: nowTs }).where(eq(kvStore.key, fila.key));
          guardarDbCache(fila.key, blob, nowTs, true);
          broadcastChange(fila.key);
        }
      } catch (errUno) {
        console.error(`❌ Error cerrando planillas vencidas de "${fila.key}":`, errUno);
      }
    }
  } catch (err) {
    console.error('❌ Error general cerrando planillas vencidas automáticamente:', err);
  }
}

// ── 4-b. Alertas automáticas de ausentismo a acudientes (OPCIONAL, ──
// desactivada por defecto). Cada institución activa esto por su cuenta
// poniendo config.alertasAusenciasActivas=true (aún no hay un botón
// dedicado en el panel de administración para esto — se documenta como
// pendiente en el checklist; por ahora se activa guardando ese campo en
// el blob de la institución, por ejemplo desde la consola del navegador
// o una futura pantalla). Por defecto NO envía nada, para que ninguna
// institución existente reciba correos nuevos sin haberlo pedido.
//
// Evita reenviar la misma alerta cada semana: solo notifica cuando el
// conteo de ausencias del estudiante cruza un NUEVO múltiplo del umbral
// configurado (config.umbralAusenciasAlerta, por defecto 3) desde la
// última vez que se le notificó a su acudiente.
async function enviarAlertasAusentismoAutomaticas() {
  try {
    const todasLasFilas = await db.select().from(kvStore);
    const filasInstituciones = todasLasFilas.filter((f) => !f.key.startsWith('_'));
    for (const fila of filasInstituciones) {
      try {
        const blob: any = fila.value;
        if (!blob || !blob.config || blob.config.alertasAusenciasActivas !== true) continue;
        if (!Array.isArray(blob.ests) || !Array.isArray(blob.asistencia)) continue;
        const umbral = Number(blob.config.umbralAusenciasAlerta) > 0 ? Number(blob.config.umbralAusenciasAlerta) : 3;
        if (!blob.config._ultimoConteoAusenciasNotificado) blob.config._ultimoConteoAusenciasNotificado = {};
        const registroNotificados: Record<string, number> = blob.config._ultimoConteoAusenciasNotificado;
        let huboCambios = false;
        for (const est of blob.ests) {
          if (!est || est.deletedAt || !est.emailAcud) continue;
          const conteo = blob.asistencia.filter((a: any) => a && !a.deletedAt && Array.isArray(a.ausentes) && a.ausentes.includes(est.id)).length;
          const yaNotificadoHasta = registroNotificados[est.id] || 0;
          if (conteo < umbral) continue;
          const cruzoNuevoUmbral = Math.floor(conteo / umbral) > Math.floor(yaNotificadoHasta / umbral);
          if (!cruzoNuevoUmbral) continue;
          const resultado = await enviarCorreoGeneral({
            to: String(est.emailAcud),
            subject: `Alerta de ausentismo — ${est.n || 'Estudiante'}`,
            text: `Hola,\n\nLe informamos que ${est.n || 'el/la estudiante'} acumula ${conteo} inasistencia(s) registrada(s) en el sistema académico hasta la fecha.\n\nSi considera que esta información no es correcta, comuníquese con la institución.\n\nEste es un mensaje automático de seguimiento académico.`,
          });
          if (resultado.ok) {
            registroNotificados[est.id] = conteo;
            huboCambios = true;
            console.log(`📧 Alerta de ausentismo enviada a acudiente de "${est.n}" (${fila.key}) — ${conteo} ausencias.`);
          }
        }
        if (huboCambios) {
          const nowTs = new Date();
          await db.update(kvStore).set({ value: blob, updatedAt: nowTs }).where(eq(kvStore.key, fila.key));
          guardarDbCache(fila.key, blob, nowTs, true);
        }
      } catch (errUno) {
        console.error(`❌ Error procesando alertas de ausentismo de "${fila.key}":`, errUno);
      }
    }
  } catch (err) {
    console.error('❌ Error general enviando alertas de ausentismo automáticas:', err);
  }
}

// ── 4-c. Limpieza periódica de tokens/códigos temporales vencidos ──────────
// Borra fichas de restablecimiento de contraseña (reset-tokens.ts) que
// expiraron sin usarse, y códigos de invitación institucional vencidos —
// mantenimiento de higiene de kv_store, sin efecto sobre datos académicos.
async function limpiarTokensYCodigosExpirados() {
  try {
    const cantidadReset = await limpiarTokensRestablecimientoExpirados();
    if (cantidadReset > 0) console.log(`🧹 ${cantidadReset} token(s) de restablecimiento de contraseña vencido(s) eliminado(s).`);
  } catch (err) {
    console.error('❌ Error limpiando tokens de restablecimiento vencidos:', err);
  }
  try {
    const todasLasFilas = await db.select().from(kvStore);
    const filasInstituciones = todasLasFilas.filter((f) => !f.key.startsWith('_'));
    const ahoraIso = new Date().toISOString();
    for (const fila of filasInstituciones) {
      try {
        const blob: any = fila.value;
        if (!blob || !Array.isArray(blob.codigosInvitacion) || !blob.codigosInvitacion.length) continue;
        const antes = blob.codigosInvitacion.length;
        blob.codigosInvitacion = blob.codigosInvitacion.filter((c: any) => c && c.expiraEn > ahoraIso);
        if (blob.codigosInvitacion.length !== antes) {
          const nowTs = new Date();
          await db.update(kvStore).set({ value: blob, updatedAt: nowTs }).where(eq(kvStore.key, fila.key));
          guardarDbCache(fila.key, blob, nowTs, true);
        }
      } catch (errUno) {
        console.error(`❌ Error limpiando códigos de invitación vencidos de "${fila.key}":`, errUno);
      }
    }
  } catch (err) {
    console.error('❌ Error general limpiando códigos de invitación vencidos:', err);
  }
}

function msHastaProximaMedianocheColombia(): number {
  // Colombia usa UTC-5 todo el año (sin horario de verano) — medianoche en
  // Colombia equivale a las 05:00 UTC. Se agregan 5 minutos de margen para
  // no correr justo en el segundo del cambio de fecha.
  const OFFSET_HORAS_COLOMBIA = -5;
  const horaUtcMedianocheCol = 0 - OFFSET_HORAS_COLOMBIA; // 5
  const ahora = new Date();
  let proxima = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), horaUtcMedianocheCol, 5, 0));
  if (proxima.getTime() <= ahora.getTime()) proxima = new Date(proxima.getTime() + 24 * 60 * 60 * 1000);
  return proxima.getTime() - ahora.getTime();
}

function iniciarTareasAutonomasProgramadas() {
  // Cierre de planillas: se revisa a diario, justo después de la
  // medianoche (hora Colombia), y luego cada 24 horas desde ahí.
  setTimeout(() => {
    cerrarPlanillasVencidasAutomaticamente();
    setInterval(() => { cerrarPlanillasVencidasAutomaticamente(); }, 24 * 60 * 60 * 1000);
  }, msHastaProximaMedianocheColombia());

  // Alertas de ausentismo: una vez por semana (no a diario, para que sea
  // un "resumen" y no un correo repetido todos los días), empezando a los
  // 10 minutos de arrancar el servidor.
  setTimeout(() => {
    enviarAlertasAusentismoAutomaticas();
    setInterval(() => { enviarAlertasAusentismoAutomaticas(); }, 7 * 24 * 60 * 60 * 1000);
  }, 10 * 60 * 1000);

  // Limpieza de tokens/códigos vencidos: cada 6 horas, empezando a los 5
  // minutos de arrancar el servidor.
  setTimeout(() => {
    limpiarTokensYCodigosExpirados();
    setInterval(() => { limpiarTokensYCodigosExpirados(); }, 6 * 60 * 60 * 1000);
  }, 5 * 60 * 1000);

  // Ronda 13: alerta de vencimiento de suscripción SaaS — igual criterio
  // que las demás tareas autónomas (revisión periódica en vez de una hora
  // fija, para ser resistente a reinicios del servidor). Solo tiene efecto
  // sobre instituciones que ya tienen una fila en fin_suscripciones.
  setTimeout(() => {
    enviarAlertasVencimientoSaas();
    setInterval(() => { enviarAlertasVencimientoSaas(); }, 12 * 60 * 60 * 1000);
  }, 15 * 60 * 1000);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server escuchando en puerto ${PORT}`);
  // RONDA 45 — DIMENSIÓN 4: auto-seeding server-side del Súper Admin por
  // defecto si la base de datos está recién creada/limpia (ver
  // autoSeedSuperAdmin() en src/db/index.ts para el diseño completo:
  // idempotente, nunca sobreescribe, contraseña nunca hardcodeada). Se
  // llama aquí (al terminar de escuchar, no antes) para no demorar el
  // "server listo" si la consulta a Neon tardara; es "mejor esfuerzo" —
  // si falla, el servidor sigue funcionando con normalidad (ver try/catch
  // interno de la propia función).
  autoSeedSuperAdmin(GESTOR_SK).catch(() => {});
  const key = getGeminiApiKey();
  if (!key) {
    console.warn('⚠️  GEMINI_API_KEY no configurada — IA no disponible');
  } else {
    console.log(`✅  Asistente Adán IA configurado. Modelo preferido: ${PRIMARY_MODEL}`);
  }
  iniciarRespaldosAutomaticosProgramados();
  console.log('🗄️  Respaldo automático semanal programado (revisión cada 12 horas).');
  iniciarTareasAutonomasProgramadas();
  console.log('🤖 Tareas autónomas programadas: cierre de planillas (diario, medianoche Colombia), alertas de ausentismo (semanal, opcional por institución), limpieza de tokens/códigos vencidos (cada 6 horas).');

  // ── AGENTE AUTÓNOMO Y AUDITOR SUPREMO DEL ECOSISTEMA ──────────────────────
  if (!key) {
    console.warn('⚠️  [EcosystemAgent] GEMINI_API_KEY no configurada — el Agente Auditor operará en modo de auditoría determinista (reglas fijas, sin razonamiento generativo ni Function Calling). El servidor sigue funcionando con normalidad.');
  } else {
    console.log(`✅  [EcosystemAgent] Agente Auditor Supremo listo con Function Calling. Modelo: ${ecosystemAgent.AGENT_MODEL}`);
  }
  ecosystemAgent.iniciarAuditoriaProgramada();
  console.log('🕵️  [EcosystemAgent] Auditoría global programada: todos los domingos a las 2:00 a.m. (hora de Colombia). Disparo manual disponible en POST /api/agent/run-full-audit.');
  iniciarKeepAliveInteligente();
  console.log('💓 Keep-Alive Inteligente activo — GET /api/health se autopingea cada 15–30 min si hubo actividad reciente, y espacia el intervalo hasta 2 horas en ventanas de inactividad prolongada (madrugada sin uso).');
  infraTelemetry.iniciarMonitoreoInfraestructura();
  console.log('🖥️  Monitoreo de Infraestructura activo — RAM/Disco/Conexiones de BD evaluados cada 15 minutos, con alerta preventiva (>80%) y crítica (>90%). GET /api/admin/infrastructure-status disponible en el panel de Súper Admin.');
});