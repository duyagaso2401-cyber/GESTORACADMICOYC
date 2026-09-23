// ════════════════════════════════════════════════════════════════════════════
// RONDA 49 — RESOLUCIÓN AGNÓSTICA DE SSL PARA LA CONEXIÓN A POSTGRES
// ------------------------------------------------------------------------------
// CONTEXTO: hasta esta ronda, tanto `src/db/index.ts` como
// `src/university-lms/lib/db.js` creaban su `pg.Pool` con
// `ssl: { rejectUnauthorized: false }` FIJO, sin condición alguna. Eso
// funciona bien contra Neon (que siempre exige TLS), pero es un problema
// REAL y verificado contra un Postgres recién instalado SIN TLS
// configurado — como el servicio `postgres` del propio
// `infra/docker-compose.yml` (imagen oficial `postgres:16-alpine`, que no
// trae certificados ni SSL activado por defecto).
//
// Se verificó en el código fuente de la librería `pg` (node_modules/pg/lib/
// connection.js, manejo del paquete SSLRequest): si el cliente pide SSL y
// el servidor responde 'N' (no lo soporta), `pg` emite el error "The
// server does not support SSL connections" y LA CONEXIÓN FALLA por
// completo — no hay una degradación silenciosa a texto plano. Es decir,
// con el código anterior, cualquiera que siguiera la guía de despliegue en
// VPS propio (Ronda 49, `infra/README.md`) usando el Postgres del propio
// `docker-compose.yml` se habría encontrado con el servidor sin arrancar,
// sin ninguna pista clara de por qué.
//
// SOLUCIÓN: esta función decide si usar SSL o no, de forma agnóstica al
// proveedor, con DOS mecanismos (en este orden de prioridad):
//   1) El propio `DATABASE_URL` — si trae `?sslmode=disable` (o
//      `sslmode=allow`), NO se activa SSL. Si trae `sslmode=require`,
//      `sslmode=prefer` o `sslmode=verify-*`, SÍ se activa (comportamiento
//      histórico, compatible con Neon, que siempre incluye
//      `sslmode=require` en la cadena que entrega su consola).
//   2) Si el `DATABASE_URL` no trae ningún `sslmode` explícito (caso del
//      valor por defecto que trae `infra/docker-compose.yml` para el
//      servicio `postgres` interno), se puede forzar con la variable de
//      entorno nueva `DATABASE_SSL` (`true`/`false`) SIN tener que editar
//      la cadena de conexión a mano.
//   3) Si ninguna de las dos está presente, se mantiene el comportamiento
//      de SIEMPRE (SSL activado) — no se cambia nada para quien ya está
//      en producción contra Neon y nunca tocó esta variable, así esta
//      ronda no rompe ningún despliegue existente.
//
// `infra/docker-compose.yml` se actualizó en esta misma ronda para incluir
// `?sslmode=disable` en el valor por defecto de `DATABASE_URL` del
// servicio `postgres` interno, así que un despliegue nuevo con Docker
// Compose usando ese valor por defecto queda resuelto sin que el usuario
// tenga que hacer nada adicional — `DATABASE_SSL` es la vía de escape
// manual para cualquier otro caso (ej. alguien que arme su propio
// `DATABASE_URL` sin `sslmode` y con un Postgres propio sin TLS).
// ════════════════════════════════════════════════════════════════════════════

export type OpcionSslPg = false | { rejectUnauthorized: boolean };

/**
 * Decide la opción `ssl` a pasar a `new pg.Pool({...})` a partir de la
 * cadena de conexión y, opcionalmente, de la variable de entorno
 * DATABASE_SSL. Nunca lanza — ante cualquier valor raro/mal formado, cae
 * al comportamiento histórico (SSL activado), que es el más seguro por
 * defecto (Neon y la mayoría de proveedores administrados lo exigen).
 */
export function resolverSslPg(connectionString: string | undefined | null): OpcionSslPg {
  const cs = String(connectionString || '').toLowerCase();

  // 1) sslmode explícito en la propia cadena de conexión — máxima prioridad,
  // porque es lo que el usuario puso a propósito ahí.
  if (/[?&]sslmode=disable\b/.test(cs) || /[?&]sslmode=allow\b/.test(cs)) return false;
  if (/[?&]sslmode=(require|prefer|verify-ca|verify-full)\b/.test(cs)) return { rejectUnauthorized: false };

  // 2) Variable de entorno DATABASE_SSL, para quien arma su propia cadena
  // sin sslmode y quiere desactivar SSL sin tocarla.
  const envSsl = (process.env.DATABASE_SSL || '').trim().toLowerCase();
  if (envSsl === 'false' || envSsl === '0' || envSsl === 'off' || envSsl === 'disable') return false;
  if (envSsl === 'true' || envSsl === '1' || envSsl === 'on') return { rejectUnauthorized: false };

  // 3) Sin ninguna señal explícita: comportamiento histórico intacto.
  return { rejectUnauthorized: false };
}
