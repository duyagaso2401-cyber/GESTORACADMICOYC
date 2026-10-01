// ════════════════════════════════════════════════════════════════════════
// RONDA 102 — Cabeceras de seguridad HTTP (helmet casero)
//
// Por qué un módulo propio en vez de la librería `helmet`: este sandbox de
// desarrollo no tiene acceso al registro de npm para instalar paquetes
// nuevos (ver nota en rondas anteriores), y las cabeceras que hacen falta
// aquí son pocas y bien conocidas — así que se implementan a mano, como
// funciones puras (mismo patrón que `cors-allowlist.ts` y
// `login-lockout.ts`): sin Express, sin red, 100% probables con `npx tsx`.
// Si en el futuro se instala `helmet` como dependencia real, este módulo
// se puede reemplazar sin cambiar el comportamiento ya validado aquí.
//
// DECISIÓN DE DISEÑO IMPORTANTE — Content-Security-Policy en modo
// "Report-Only" por defecto:
// Este sistema es una aplicación monolítica de muchos años, con decenas de
// bloques <script> inline repartidos en portal.html y varias librerías de
// terceros cargadas desde CDNs (jsPDF, Chart.js, SheetJS, Bootstrap,
// QRCode, jsQR, Sentry). Activar una CSP "enforcing" (que BLOQUEE lo que
// no está en la lista) a ciegas, sin poder abrir la aplicación real en un
// navegador desde este entorno, es un riesgo real de dejar la plataforma
// en blanco para todos los colegios que la usan — algo mucho peor que no
// tener la cabecera.
//
// Por eso, igual que con ALLOWED_ORIGINS en la Ronda 101, esta función
// nace seguro por defecto: envía la política como
// `Content-Security-Policy-Report-Only` (el navegador AVISA en la consola
// qué bloquearía, pero no bloquea nada) hasta que se active explícitamente
// con la variable de entorno `CSP_ENFORCE=true` una vez se haya revisado
// la consola del navegador en producción y confirmado que no hay falsos
// positivos. El resto de cabeceras (nosniff, X-Frame-Options,
// Referrer-Policy, Permissions-Policy, HSTS) SÍ son seguras de aplicar de
// inmediato — no restringen nada que la aplicación necesite — y por eso
// van activas siempre, sin bandera.
// ════════════════════════════════════════════════════════════════════════

/** Directivas de Content-Security-Policy, construidas a partir de un
 * inventario real de todos los hosts externos que carga el frontend
 * (ver portal.html y los módulos de gestor-academico/dist/modules/*.js):
 * jsPDF/jsPDF-autotable/Chart.js/QRCode/jsQR/Bootstrap/SheetJS vía CDN,
 * Sentry (bundle de navegador + el envío de eventos a *.sentry.io),
 * imágenes de Cloudinary (subidas de fotos/documentos) y del generador de
 * QR api.qrserver.com, e imágenes de muestra de images.unsplash.com. */
const CSP_DIRECTIVAS: Record<string, string[]> = {
  'default-src': ["'self'"],
  // 'unsafe-inline' es necesario porque el sistema usa bloques <script>
  // inline históricos (no nonces) — ver nota de diseño arriba. Esto no es
  // ideal, pero es exactamente lo que ya existía implícitamente (sin CSP
  // no había NINGUNA restricción); migrar esos bloques a nonces es un
  // trabajo aparte, de mayor esfuerzo, documentado en la hoja de ruta.
  'script-src': [
    "'self'",
    "'unsafe-inline'",
    'https://cdnjs.cloudflare.com',
    'https://cdn.jsdelivr.net',
    'https://browser.sentry-cdn.com',
    'https://cdn.sheetjs.com',
    'https://unpkg.com',
  ],
  'style-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
  'img-src': [
    "'self'",
    'data:',
    'blob:',
    'https://res.cloudinary.com',
    'https://api.qrserver.com',
    'https://images.unsplash.com',
  ],
  'font-src': ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
  'connect-src': [
    "'self'",
    'https://*.sentry.io',
    'https://*.ingest.sentry.io',
    'https://*.ingest.us.sentry.io',
    'https://*.ingest.de.sentry.io',
    'https://res.cloudinary.com',
    'https://api.cloudinary.com',
  ],
  'media-src': ["'self'", 'blob:'],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  // object-src 'none': bloquea <object>/<embed>/Flash — no se usa nada de
  // esto en el sistema, es una restricción 100% segura.
  'object-src': ["'none'"],
  // base-uri 'self': evita que una inyección pueda cambiar el <base> de la
  // página para desviar las rutas relativas (script-src/import) a un
  // dominio atacante. No afecta nada legítimo del sistema.
  'base-uri': ["'self'"],
  // frame-ancestors 'none': nadie puede embeber esta aplicación dentro de
  // un <iframe> de otro sitio (protección anti-clickjacking). El propio
  // código del sistema ya intenta detectar y bloquear iframes de Replit
  // (ver 01-proteccion.js) — esto lo refuerza a nivel de navegador/cabecera,
  // que es más confiable que detectarlo con JavaScript.
  'frame-ancestors': ["'none'"],
  'form-action': ["'self'"],
};

/** Arma el string final de la cabecera CSP a partir de las directivas de
 * arriba, más "upgrade-insecure-requests" (sin valor, solo la palabra). */
export function construirPoliticaCSP(): string {
  const partes = Object.entries(CSP_DIRECTIVAS).map(
    ([directiva, fuentes]) => `${directiva} ${fuentes.join(' ')}`
  );
  partes.push('upgrade-insecure-requests');
  return partes.join('; ');
}

export interface OpcionesCabecerasSeguridad {
  /** true = la CSP se envía como `Content-Security-Policy` (bloquea lo que
   * no está permitido). false/ausente (valor por defecto, más seguro ante
   * el riesgo de romper producción sin poder probarlo primero) = se envía
   * como `Content-Security-Policy-Report-Only` (solo avisa en consola,
   * nunca bloquea). Pensado para controlarse con `process.env.CSP_ENFORCE
   * === 'true'` desde el servidor real. */
  cspEnforce?: boolean;
}

/** Devuelve el mapa completo {nombre de cabecera: valor} a aplicar en
 * TODAS las respuestas del servidor. Función pura: no toca `res` ni
 * `process.env` directamente (eso lo hace quien la llama en
 * src/index.ts), para que sea 100% probable sin Express ni red. */
export function construirCabecerasSeguridad(
  opts: OpcionesCabecerasSeguridad = {}
): Record<string, string> {
  const cspEnforce = opts.cspEnforce === true;
  const nombreCabeceraCSP = cspEnforce
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only';

  return {
    // Evita que el navegador intente "adivinar" el tipo de un archivo
    // distinto al declarado en Content-Type (protección contra ataques de
    // MIME-sniffing). Seguro de aplicar siempre, no restringe nada.
    'X-Content-Type-Options': 'nosniff',
    // Nadie puede embeber el sistema en un <iframe> de otro sitio —
    // cabecera "clásica" equivalente a frame-ancestors, para navegadores
    // que aún no soportan bien esa directiva de CSP.
    'X-Frame-Options': 'DENY',
    // No se envía la URL completa de origen al navegar hacia otro sitio
    // (solo el origen, y nada en absoluto si se baja de HTTPS a HTTP) —
    // reduce la fuga de información como tokens o IDs en query strings.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Desactiva por defecto el acceso a geolocalización y micrófono desde
    // cualquier origen (el sistema no los usa); la cámara SÍ se deja
    // disponible para el propio sitio porque se usa para escanear QR y
    // tomar fotos (ver getUserMedia en 03-app-core.js y
    // 06-documentos-y-resto.js).
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(self)',
    // HSTS: una vez el navegador visita el sitio por HTTPS (siempre, en
    // Render), le exige repetirlo por 2 años y a todos los subdominios —
    // evita ataques de downgrade a HTTP. preload es opcional y no se
    // incluye aquí para no comprometer al dominio con el listado global
    // de precarga de los navegadores sin que el usuario lo decida aparte.
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    [nombreCabeceraCSP]: construirPoliticaCSP(),
  };
}
