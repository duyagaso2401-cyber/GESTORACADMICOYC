// =====================================================================
// server/middleware/auth.js
// Middleware de Control de Acceso basado en Roles para el módulo
// universitario/LMS: checkUniversityRole(...rolesPermitidos)
//
// DISEÑADO PARA ENCAJAR CON LO QUE YA EXISTE en src/routes/university.ts:
// ese archivo ya autentica cada request con un token firmado (HMAC) y
// deja la sesión verificada en `req.sesionUniv = { sk, rol, userId,
// nombre, exp }`. Este middleware se monta DESPUÉS de ese `exigirSesion`
// y solo decide si el rol de la sesión puede pasar — no reinventa el
// login ni la verificación de token, para no duplicar lógica de
// seguridad ya probada.
//
// También incluye una versión standalone (verificarTokenSesion /
// exigirSesionUniv) por si este paquete se usa en un backend que
// todavía no tiene ese middleware — útil para pruebas o para un
// despliegue nuevo desde cero.
// =====================================================================
import crypto from 'crypto';
import { query } from '../lib/db.js';

const SIGN_SECRET = process.env.DOC_SIGN_SECRET || process.env.UNIV_SIGN_SECRET || '';
const SESION_HORAS_VALIDEZ = Number(process.env.UNIV_SESION_HORAS || 12);

// Jerarquía de roles "enterprise" pedida en la especificación. Se
// normaliza a minúsculas para ser compatible con los roles ya
// existentes en el sistema ('admin', 'docente', 'estudiante').
export const ROLES = Object.freeze({
  SUPER_ADMIN: 'superadmin',
  RECTOR: 'rector',
  DECANO: 'decano',
  DOCENTE: 'docente',
  ESTUDIANTE: 'estudiante',
  AUXILIAR: 'auxiliar',
});

// Compatibilidad con los roles heredados del sistema K-12 / prototipo
// universitario ya existente: "admin" se trata como super-set de
// Rector+Decano+SuperAdmin (mismo criterio que ya usan las rutas
// actuales al validar `rol !== 'estudiante'` para permitir todo lo que
// no sea estudiante).
const ALIAS_ROL = {
  admin: ROLES.SUPER_ADMIN,
  administrador: ROLES.SUPER_ADMIN,
  superadmin: ROLES.SUPER_ADMIN,
  'super-admin': ROLES.SUPER_ADMIN,
  rector: ROLES.RECTOR,
  decano: ROLES.DECANO,
  docente: ROLES.DOCENTE,
  catedratico: ROLES.DOCENTE,
  profesor: ROLES.DOCENTE,
  auxiliar: ROLES.AUXILIAR,
  monitor: ROLES.AUXILIAR,
  estudiante: ROLES.ESTUDIANTE,
  alumno: ROLES.ESTUDIANTE,
};

export function normalizarRol(rolCrudo) {
  const r = String(rolCrudo || '').trim().toLowerCase();
  return ALIAS_ROL[r] || r;
}

// El tipo ENUM univ_rol en PostgreSQL (ver 01_univ_lms_schema.sql) usa
// los nombres EXACTOS de la especificación, capitalizados:
// 'SuperAdmin','Rector','Decano','Docente','Estudiante','Auxiliar','Padre'.
// normalizarRol() trabaja siempre en minúsculas (para comparar sin
// importar cómo venga el rol del token); esta función traduce de vuelta
// justo antes de escribir en la columna `rol` de univ_usuarios_perfil.
const ROL_NORMALIZADO_A_ENUM_DB = {
  [ROLES.SUPER_ADMIN]: 'SuperAdmin',
  [ROLES.RECTOR]: 'Rector',
  [ROLES.DECANO]: 'Decano',
  [ROLES.DOCENTE]: 'Docente',
  [ROLES.ESTUDIANTE]: 'Estudiante',
  [ROLES.AUXILIAR]: 'Auxiliar',
};
export function rolParaEnumDb(rolCrudoOnormalizado) {
  const normalizado = normalizarRol(rolCrudoOnormalizado);
  return ROL_NORMALIZADO_A_ENUM_DB[normalizado] || 'Estudiante';
}

// Orden de "poder" para permitir jerarquía simple (un Rector puede todo
// lo que puede un Decano, etc.) cuando una ruta se protege con el rol
// mínimo requerido en vez de una lista explícita.
const JERARQUIA = [ROLES.ESTUDIANTE, ROLES.AUXILIAR, ROLES.DOCENTE, ROLES.DECANO, ROLES.RECTOR, ROLES.SUPER_ADMIN];

/**
 * Middleware de autorización por rol.
 *
 *   router.post('/facultades', checkUniversityRole('SuperAdmin','Rector'), crearFacultad)
 *
 * Acepta los nombres en cualquier capitalización ("Docente", "docente",
 * "DOCENTE"). Requiere que un middleware de autenticación previo ya haya
 * puesto la sesión en req.sesionUniv (o req.univUser — ambos se aceptan
 * para no forzar un solo nombre de propiedad).
 */
export function checkUniversityRole(...rolesPermitidos) {
  const permitidos = new Set(rolesPermitidos.map(normalizarRol));
  return function (req, res, next) {
    const sesion = req.sesionUniv || req.univUser;
    if (!sesion) {
      return res.status(401).json({ error: 'No autenticado. Inicie sesión nuevamente.' });
    }
    const rol = normalizarRol(sesion.rol);
    if (!rol) {
      return res.status(403).json({ error: 'La sesión no tiene un rol válido asignado.' });
    }
    if (permitidos.size === 0 || permitidos.has(rol)) {
      req.univRol = rol;
      return next();
    }
    return res.status(403).json({ error: `No autorizado: se requiere uno de estos roles: ${[...permitidos].join(', ')}.` });
  };
}

/** Variante jerárquica: exige un rol igual o "superior" al mínimo dado,
 * según JERARQUIA. Útil para endpoints tipo "cualquiera con rango de
 * Docente para arriba puede ver esta analítica". */
export function checkUniversityRoleMinimo(rolMinimo) {
  const minIdx = JERARQUIA.indexOf(normalizarRol(rolMinimo));
  return function (req, res, next) {
    const sesion = req.sesionUniv || req.univUser;
    if (!sesion) return res.status(401).json({ error: 'No autenticado.' });
    const idx = JERARQUIA.indexOf(normalizarRol(sesion.rol));
    if (idx === -1 || idx < minIdx) {
      return res.status(403).json({ error: 'No tiene el rango suficiente para esta acción.' });
    }
    req.univRol = normalizarRol(sesion.rol);
    next();
  };
}

/** Restringe a que un estudiante solo pueda operar sobre SUS PROPIOS
 * datos (ej. su propio perfil, su propia entrega), salvo que su rol sea
 * Docente o superior. Compara req.params[paramId] contra sesion.userId. */
export function checkPropioOStaff(paramId = 'estudianteId') {
  return function (req, res, next) {
    const sesion = req.sesionUniv || req.univUser;
    if (!sesion) return res.status(401).json({ error: 'No autenticado.' });
    const rol = normalizarRol(sesion.rol);
    const esStaff = [ROLES.DOCENTE, ROLES.DECANO, ROLES.RECTOR, ROLES.SUPER_ADMIN, ROLES.AUXILIAR].includes(rol);
    if (esStaff) { req.univRol = rol; return next(); }
    const objetivo = req.params[paramId] || req.body?.[paramId] || req.query?.[paramId];
    if (String(objetivo) !== String(sesion.userId)) {
      return res.status(403).json({ error: 'No puede acceder a los datos de otro usuario.' });
    }
    req.univRol = rol;
    next();
  };
}

// ---------------------------------------------------------------------
// Verificación de token standalone (compatible con el esquema HMAC ya
// usado en university.ts). Solo se usa si NO hay ya un exigirSesion()
// montado antes en la app.
// ---------------------------------------------------------------------
function jsonEstable(datos) {
  if (datos === null || typeof datos !== 'object') return JSON.stringify(datos);
  if (Array.isArray(datos)) return '[' + datos.map(jsonEstable).join(',') + ']';
  const keys = Object.keys(datos).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + jsonEstable(datos[k])).join(',') + '}';
}
function firmar(datos) {
  return crypto.createHmac('sha256', SIGN_SECRET).update(jsonEstable(datos)).digest('hex');
}
export function generarTokenSesion(payload) {
  const completo = { ...payload, exp: Date.now() + SESION_HORAS_VALIDEZ * 60 * 60 * 1000 };
  const payloadB64 = Buffer.from(JSON.stringify(completo)).toString('base64url');
  return payloadB64 + '.' + firmar(completo);
}
export function verificarTokenSesion(token) {
  try {
    const [payloadB64, firma] = String(token || '').split('.');
    if (!payloadB64 || !firma) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (firmar(payload) !== firma) return null;
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Middleware standalone equivalente a exigirSesion() de university.ts.
 * Además de exigir el token, RENUEVA la ventana de expiración cada vez
 * que llega una petición válida (sliding session), para cumplir con el
 * requisito de "persistencia de sesión por inactividad controlada de
 * mínimo 1 hora" sin forzar al usuario a loguearse de nuevo mientras
 * sigue activo. */
export function exigirSesionUniv(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.cookies?.univ_token || '');
  const sesion = verificarTokenSesion(token);
  if (!sesion) return res.status(401).json({ error: 'Sesión inválida o vencida. Vuelva a iniciar sesión.', code: 'SESSION_EXPIRED' });
  req.sesionUniv = sesion;
  // Sliding expiration: si a la sesión le queda menos de la mitad de su
  // ventana de vida, se emite un token renovado en la cabecera de
  // respuesta para que el cliente lo reemplace silenciosamente (sin
  // interrumpir al usuario ni redirigirlo al login).
  const restante = sesion.exp - Date.now();
  if (restante < (SESION_HORAS_VALIDEZ * 60 * 60 * 1000) / 2) {
    res.setHeader('X-Univ-Refresh-Token', generarTokenSesion({ sk: sesion.sk, rol: sesion.rol, userId: sesion.userId, nombre: sesion.nombre }));
  }
  next();
}

// ---------------------------------------------------------------------
// PUENTE DE IDENTIDAD: sesionUniv.userId (el id del sistema de sesión YA
// EXISTENTE, ej. username/id legado) → univ_usuarios_perfil.id (UUID).
// ---------------------------------------------------------------------
// El token de sesión ya usado por src/routes/university.ts (y por la
// versión standalone de este archivo) trae un `userId` que pertenece a
// la identidad LEGADA del sistema (kv_store), no al UUID nuevo de
// univ_usuarios_perfil. Toda tabla nueva del módulo enterprise referencia
// usuarios por ese UUID (FKs a univ_usuarios_perfil.id), así que este
// middleware resuelve (o auto-provisiona, la primera vez) la fila de
// perfil correspondiente y dejal el UUID listo en `req.univPerfilId`.
//
// Se monta UNA vez en university.routes.js, después de la sesión y
// antes de todos los sub-routers — así ningún archivo de rutas necesita
// preocuparse por esta traducción.
export async function resolverPerfilUniversitario(req, res, next) {
  try {
    const sesion = req.sesionUniv || req.univUser;
    if (!sesion) return next(); // rutas públicas (si las hubiera) siguen de largo
    const existente = await query(
      `SELECT id FROM univ_usuarios_perfil WHERE institucion_sk = $1 AND usuario_u = $2`,
      [sesion.sk, sesion.userId]
    );
    if (existente.rows.length) {
      req.univPerfilId = existente.rows[0].id;
      return next();
    }
    // Auto-provisión mínima: evita exigir un paso manual de "migración
    // de usuarios" antes de poder usar el módulo — el perfil se completa
    // después desde /profile/me (auto-gestión, sección 3).
    const nombreCompleto = String(sesion.nombre || '').trim();
    const [nombres, ...resto] = nombreCompleto ? nombreCompleto.split(' ') : [''];
    const creado = await query(
      `INSERT INTO univ_usuarios_perfil (institucion_sk, usuario_u, rol, nombres, apellidos)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (institucion_sk, usuario_u) DO UPDATE SET rol = EXCLUDED.rol
       RETURNING id`,
      [sesion.sk, sesion.userId, rolParaEnumDb(sesion.rol), nombres || '', resto.join(' ') || '']
    );
    req.univPerfilId = creado.rows[0].id;
    next();
  } catch (err) {
    next(err);
  }
}

export default { checkUniversityRole, checkUniversityRoleMinimo, checkPropioOStaff, exigirSesionUniv, generarTokenSesion, verificarTokenSesion, normalizarRol, rolParaEnumDb, ROLES, resolverPerfilUniversitario };
