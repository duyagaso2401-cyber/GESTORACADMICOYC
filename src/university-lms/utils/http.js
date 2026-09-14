// =====================================================================
// server/utils/http.js
// Utilidades transversales de OPTIMIZACIÓN DE RED (sección 7 de la
// especificación): paginación, ETag/Cache-Control, consultas
// incrementales ("delta updates") y envoltura de errores.
// =====================================================================
import crypto from 'crypto';

/** Evita repetir try/catch en cada ruta. Cualquier error cae en el
 * manejador de errores central de Express (ver server/index.example.js). */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Paginación obligatoria — nunca se debe devolver una tabla completa.
 * Límite por defecto 20, tope duro 100 para que un cliente mal
 * configurado no pueda pedir "todo" de un solo golpe. */
export function parsePaginacion(req, { limitPorDefecto = 20, limitMaximo = 100 } = {}) {
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = limitPorDefecto;
  if (limit > limitMaximo) limit = limitMaximo;
  let page = parseInt(req.query.page, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  const offset = (page - 1) * limit;
  return { limit, page, offset };
}

/** "Delta updates": el cliente manda ?since=<ISO date> y solo recibe lo
 * que cambió desde ahí. Si no manda since, se asume "desde siempre"
 * (primera carga). Devuelve también `nextSince` para que el cliente lo
 * guarde y lo use en su siguiente sondeo — así jamás vuelve a pedir la
 * lista completa. */
export function parseSince(req) {
  const raw = req.query.since;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function respuestaConDelta(res, filas, { columnaFecha = 'updated_at' } = {}) {
  const nextSince = filas.length
    ? filas.reduce((max, f) => (f[columnaFecha] && f[columnaFecha] > max ? f[columnaFecha] : max), filas[0][columnaFecha] || new Date(0).toISOString())
    : new Date().toISOString();
  res.json({ items: filas, count: filas.length, nextSince });
}

/** Calcula un ETag débil a partir del payload y responde 304 si el
 * cliente ya tiene esa versión exacta (cabecera If-None-Match). Evita
 * retransmitir bytes idénticos — clave para no gastar los 5 GB del plan
 * gratuito con datos que no cambiaron entre un polling y el siguiente. */
export function enviarConEtag(req, res, payload, { cacheControl = 'private, max-age=15, must-revalidate' } = {}) {
  const cuerpo = JSON.stringify(payload);
  const etag = 'W/"' + crypto.createHash('sha1').update(cuerpo).digest('hex') + '"';
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).send(cuerpo);
}

/** Whitelist explícita de columnas permitidas en un SELECT — nunca
 * "SELECT *". Ayuda a documentar y a que un review detecte de un
 * vistazo qué viaja por la red en cada endpoint. */
export function columnas(lista) {
  return lista.join(', ');
}

/** Valida y acota un arreglo recibido para "batching" (autoguardado en
 * bloque). Rechaza lotes absurdamente grandes (protección contra abuso /
 * bugs de cliente que acumulen de más). */
export function validarLoteCambios(cambios, { maxItems = 500 } = {}) {
  if (!Array.isArray(cambios)) return { ok: false, error: 'Se esperaba un arreglo de cambios.' };
  if (cambios.length === 0) return { ok: false, error: 'El lote de cambios está vacío.' };
  if (cambios.length > maxItems) return { ok: false, error: `El lote excede el máximo permitido (${maxItems}).` };
  return { ok: true };
}

export function errorHandlerUniversidad(err, req, res, _next) {
  console.error('[univ-lms] Error en', req.method, req.originalUrl, ':', err);
  if (err.code === '23505') return res.status(409).json({ error: 'El registro ya existe (violación de unicidad).' });
  if (err.code === '23503') return res.status(409).json({ error: 'La operación viola una relación de integridad referencial.' });
  if (err.code === '23514') return res.status(422).json({ error: 'Uno de los valores no cumple una regla de negocio (constraint).' });
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Error interno del servidor.' });
}

export default { asyncHandler, parsePaginacion, parseSince, respuestaConDelta, enviarConEtag, columnas, validarLoteCambios, errorHandlerUniversidad };
