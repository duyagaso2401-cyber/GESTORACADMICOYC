// =====================================================================
// src/lib/email-http-provider.ts
// ------------------------------------------------------------------------
// Envío de correo por API HTTP (puerto 443, el que ningún plan de hosting
// bloquea) como CANAL ADICIONAL — no un reemplazo — al envío por SMTP que
// ya existe en src/lib/email-general.ts y src/university-lms/utils/email.js.
//
// Motivo: desde septiembre de 2025, Render.com bloquea en su plan
// gratuito todo el tráfico saliente a los puertos SMTP (25, 465, 587),
// así que un servidor en ese plan nunca puede enviar correo por SMTP sin
// importar qué tan bien configuradas estén las credenciales. Este módulo
// permite seguir enviando correo igual, sin necesidad de cambiar de plan,
// usando la API HTTP del mismo proveedor (o de otro) en su lugar.
//
// LAS DOS FORMAS CONVIVEN: email-general.ts y email.js intentan primero
// este canal (si está configurado) y, si falla o no está configurado,
// caen automáticamente al SMTP de siempre — así que si en algún momento
// se pasa a un plan pago de Render (donde el SMTP sí funciona), no hace
// falta tocar nada: basta con no configurar las variables de este
// archivo y todo sigue funcionando exactamente como hoy.
//
// Proveedores soportados (se elige UNO con la variable de entorno
// EMAIL_API_PROVIDER):
//
//   "resend"    → https://resend.com — 100 correos/día gratis. Requiere
//                 crear una cuenta, verificar un dominio propio por DNS
//                 (agregar unos registros TXT/CNAME que Resend te indica)
//                 y generar una API key.
//
//   "zeptomail" → https://www.zoho.com/zeptomail/ — producto de correo
//                 TRANSACCIONAL de Zoho (distinto del Zoho Mail normal
//                 que ya usas por SMTP). Como ya tienes una cuenta y un
//                 dominio verificado en Zoho, probablemente sea el más
//                 rápido de activar. Requiere activar ZeptoMail dentro de
//                 tu cuenta Zoho y generar una "Send Mail Token".
//
// Variables de entorno nuevas (todas opcionales — si no se definen,
// simplemente no se usa este canal y todo sigue por SMTP como hasta
// ahora):
//   EMAIL_API_PROVIDER = "resend" | "zeptomail"
//   EMAIL_API_KEY      = la API key / token de ese proveedor
//   EMAIL_API_FROM     = remitente a mostrar (también se acepta EMAIL_FROM
//                        como alias; si ninguna de las dos se define, se
//                        usa SMTP_FROM o SMTP_USER como respaldo)
//
// IMPORTANTE al pegar estos valores en Render (o cualquier hosting): NO
// incluyan comillas alrededor del valor. El código ya intenta detectar y
// quitar un par de comillas que envuelvan todo el valor (ver _limpiarEnv
// más abajo), pero es más seguro pegarlo tal cual, sin comillas.
// =====================================================================

// Es MUY común, al pegar un valor en el panel de "Environment Variables"
// de Render (o de cualquier otro hosting), incluir por accidente las
// comillas que rodeaban el valor al copiarlo de otro lado (por ejemplo, de
// un archivo .env donde estaba escrito como KEY="valor", o de un mensaje/
// documento que lo mostraba entre comillas). Render (y la mayoría de
// hostings) NO quita esas comillas automáticamente: las guarda como parte
// LITERAL del valor, así que el proceso recibe algo como
// '"Zoho-enczapikey abc123"' (con comillas incluidas) en vez de
// 'Zoho-enczapikey abc123' — esto rompe silenciosamente cualquier
// comparación de prefijo y cualquier token/API key, sin que aparezca
// ningún error obvio de "variable faltante" (la variable SÍ está definida,
// solo que con basura extra). _limpiarEnv() quita un único par de comillas
// (dobles o simples) que envuelvan TODO el valor, y además recorta
// espacios en blanco al inicio/final (otro descuido común al copiar).
function _limpiarEnv(v: string | undefined): string {
  let s = (v || '').trim();
  if (s.length >= 2) {
    const primera = s[0];
    const ultima = s[s.length - 1];
    if ((primera === '"' && ultima === '"') || (primera === "'" && ultima === "'")) {
      s = s.slice(1, -1).trim();
    }
  }
  return s;
}

const EMAIL_API_PROVIDER = _limpiarEnv(process.env.EMAIL_API_PROVIDER).toLowerCase();
const EMAIL_API_KEY = _limpiarEnv(process.env.EMAIL_API_KEY);
// EMAIL_FROM se acepta como alias de EMAIL_API_FROM: es un nombre de
// variable igual de razonable y, en la práctica, algunos despliegues lo
// configuraron así por error (confundiéndolo con el nombre "esperado") —
// en vez de dejar ese valor silenciosamente ignorado, se usa como
// respaldo antes de caer a SMTP_FROM/SMTP_USER.
const EMAIL_API_FROM =
  _limpiarEnv(process.env.EMAIL_API_FROM) ||
  _limpiarEnv(process.env.EMAIL_FROM) ||
  _limpiarEnv(process.env.SMTP_FROM) ||
  _limpiarEnv(process.env.SMTP_USER) ||
  '';

export const emailApiConfigurado = Boolean(EMAIL_API_PROVIDER && EMAIL_API_KEY);
// Se expone el NOMBRE del proveedor (nunca la API key) para poder mostrarlo
// en un endpoint de diagnóstico (ver GET /api/inetis/email-status en
// src/index.ts) — así se puede confirmar desde afuera, sin mirar los logs
// de Render, si las variables de entorno realmente llegaron al proceso
// desplegado.
export const emailApiProveedor = EMAIL_API_PROVIDER || null;

if (EMAIL_API_PROVIDER && !EMAIL_API_KEY) {
  console.warn('⚠️  [email-http-provider] EMAIL_API_PROVIDER="' + EMAIL_API_PROVIDER + '" definido pero falta EMAIL_API_KEY — este canal quedará inactivo hasta que se defina.');
}
if (emailApiConfigurado) {
  console.log('✅ [email-http-provider] Canal de correo por API HTTP activo (' + EMAIL_API_PROVIDER + ') — se intentará primero, con SMTP como respaldo automático si falla o no está configurado.');
} else {
  console.log('ℹ️  [email-http-provider] Canal de correo por API HTTP no configurado (opcional) — el envío sigue funcionando por SMTP como hasta ahora. Para activarlo (recomendado si el hosting bloquea puertos SMTP, ej. Render.com plan gratuito), define EMAIL_API_PROVIDER + EMAIL_API_KEY.');
}

export interface ResultadoEnvioApi {
  ok: boolean;
  error?: string;
}

interface ParametrosEnvioApi {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

/** Envía un correo por la API HTTP configurada. Nunca lanza: siempre
 * resuelve con {ok:true} o {ok:false, error} para que el llamador pueda
 * decidir con calma si cae de inmediato al respaldo SMTP. */
export async function enviarPorApiHttp(params: ParametrosEnvioApi): Promise<ResultadoEnvioApi> {
  if (!emailApiConfigurado) {
    // Este es, en la práctica, el mensaje más importante de todo este
    // archivo para diagnosticar problemas en producción: si esto aparece
    // en los logs de Render cuando se esperaba que el canal HTTP
    // funcionara, significa que EMAIL_API_PROVIDER y/o EMAIL_API_KEY NO
    // llegaron al proceso — casi siempre porque faltan en las variables
    // de entorno de Render, o porque el servicio no se reinició/redesplegó
    // después de agregarlas (Render no relee el .env solo; hay que hacer
    // "Manual Deploy" o esperar el redeploy automático tras el push).
    console.error(
      '❌ [email-http-provider] Se intentó enviar por API HTTP pero el canal NO está configurado ' +
      '(EMAIL_API_PROVIDER="' + (EMAIL_API_PROVIDER || '(vacío)') + '", EMAIL_API_KEY ' + (EMAIL_API_KEY ? 'presente' : 'AUSENTE') + '). ' +
      'Verifique en Render → su servicio → Environment que ambas variables estén puestas, y que el servicio se haya reiniciado/redesplegado después de agregarlas.'
    );
    return { ok: false, error: 'Canal de API HTTP no configurado (EMAIL_API_PROVIDER/EMAIL_API_KEY).' };
  }
  try {
    if (EMAIL_API_PROVIDER === 'resend') return await enviarConResend(params);
    if (EMAIL_API_PROVIDER === 'zeptomail') return await enviarConZeptoMail(params);
    console.error('❌ [email-http-provider] EMAIL_API_PROVIDER="' + EMAIL_API_PROVIDER + '" no reconocido (valores válidos: "resend", "zeptomail").');
    return { ok: false, error: 'EMAIL_API_PROVIDER="' + EMAIL_API_PROVIDER + '" no reconocido (valores válidos: "resend", "zeptomail").' };
  } catch (err: any) {
    // Un throw aquí significa que ni siquiera se pudo completar la
    // petición HTTP (por ejemplo, DNS, TLS, o el fetch nativo de Node
    // rechazándola por algún motivo de red) — se registra completo, no
    // solo el mensaje corto, para poder diagnosticarlo sin adivinar.
    console.error('❌ [email-http-provider] Excepción al intentar enviar por ' + EMAIL_API_PROVIDER + ':', err);
    return { ok: false, error: err?.message || 'Error desconocido al enviar por API HTTP.' };
  }
}

async function enviarConResend(p: ParametrosEnvioApi): Promise<ResultadoEnvioApi> {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + EMAIL_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_API_FROM,
      to: [p.to],
      subject: p.subject,
      text: p.text || undefined,
      html: p.html || undefined,
    }),
  });
  if (resp.ok) {
    console.log('✅ [email-http-provider] Correo enviado por Resend a ' + p.to + ' (asunto: "' + p.subject + '").');
    return { ok: true };
  }
  const cuerpo = await resp.text().catch(() => '');
  // Log COMPLETO (sin recortar) en la consola del servidor — lo que se
  // devuelve al llamador sí va recortado a 300 caracteres, para no
  // inflar innecesariamente la respuesta HTTP ni el objeto que
  // eventualmente ve el frontend, pero en los logs de Render se necesita
  // el mensaje exacto para diagnosticar (dominio no verificado, API key
  // inválida, límite diario alcanzado, etc.).
  console.error('❌ [email-http-provider] Resend respondió ' + resp.status + ' al intentar enviar a ' + p.to + ':', cuerpo);
  return { ok: false, error: 'Resend respondió ' + resp.status + ': ' + cuerpo.slice(0, 300) };
}

async function enviarConZeptoMail(p: ParametrosEnvioApi): Promise<ResultadoEnvioApi> {
  // ZeptoMail espera la cabecera Authorization con el valor COMPLETO que
  // el panel de Zoho entrega (normalmente algo como "Zoho-enczapikey
  // wSs..."), no solo el token. Un error MUY común (confirmado en
  // producción: ver CHECKLIST_DESPLIEGUE.md Ronda 8) es copiar SOLO el
  // token largo desde el panel de Zoho, sin las palabras "Zoho-enczapikey "
  // que aparecen delante de él — quedando algo como "wSs..." en vez de
  // "Zoho-enczapikey wSs...". ZeptoMail rechaza eso con 401 "Invalid API
  // Token found", un mensaje que no deja nada claro que el problema sea
  // justamente el prefijo faltante.
  //
  // En vez de solo AVISAR del problema (como se hacía antes) y obligar a
  // ir a corregirlo en Render, aquí se CORRIGE automáticamente: si el
  // valor no trae ya el prefijo esperado, se le agrega antes de usarlo.
  // Esto es seguro en los dos sentidos: si el valor YA traía el prefijo,
  // no se toca nada (la comparación es insensible a mayúsculas/minúsculas
  // pero el valor usado de ahí en adelante es siempre el original tal
  // cual); si NO lo traía, agregarlo es exactamente lo que ZeptoMail
  // necesita para poder evaluar el token — nunca puede "empeorar" un
  // token que de por sí no iba a funcionar sin el prefijo.
  let claveZepto = EMAIL_API_KEY;
  if (!/^zoho-enczapikey\s/i.test(claveZepto)) {
    console.warn(
      '⚠️  [email-http-provider] EMAIL_API_KEY no traía el prefijo esperado "Zoho-enczapikey " — ' +
      'es un error de configuración muy común (copiar solo el token, sin el prefijo, desde el panel de Zoho). ' +
      'Se agregó automáticamente para este envío, pero es más seguro corregir el valor guardado en Render: ' +
      'debe ser el "Send Mail Token" COMPLETO tal como lo muestra Zoho ZeptoMail → API/SMTP Tokens, comillas incluidas fuera, prefijo incluido dentro.'
    );
    claveZepto = 'Zoho-enczapikey ' + claveZepto;
  }
  const cuerpoEnvio = {
    from: { address: EMAIL_API_FROM },
    to: [{ email_address: { address: p.to } }],
    subject: p.subject,
    htmlbody: p.html || (p.text ? '<pre style="font-family:inherit;white-space:pre-wrap">' + _escaparHtml(p.text) + '</pre>' : undefined),
    textbody: p.text || undefined,
  };
  let resp: Response;
  try {
    resp = await fetch('https://api.zeptomail.com/v1.1/email', {
      method: 'POST',
      headers: {
        Authorization: claveZepto,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cuerpoEnvio),
    });
  } catch (err: any) {
    // Fallo de RED (no de la API en sí) — DNS, TLS, timeout del fetch, etc.
    console.error('❌ [email-http-provider] No se pudo conectar con la API de ZeptoMail (error de red, no de la API):', err);
    return { ok: false, error: 'No se pudo conectar con la API de ZeptoMail: ' + (err?.message || 'error de red desconocido') };
  }
  if (resp.ok) {
    console.log('✅ [email-http-provider] Correo enviado por ZeptoMail a ' + p.to + ' (asunto: "' + p.subject + '").');
    return { ok: true };
  }
  const cuerpo = await resp.text().catch(() => '');
  // Log COMPLETO en consola (ver nota en enviarConResend de arriba) — esto
  // es exactamente lo que pediste: el mensaje exacto de ZeptoMail queda en
  // los logs de Render, en vez de perderse en un "Error al enviar" genérico.
  console.error('❌ [email-http-provider] ZeptoMail respondió ' + resp.status + ' al intentar enviar a ' + p.to + '. Remitente usado: "' + EMAIL_API_FROM + '". Respuesta completa:', cuerpo);
  return { ok: false, error: 'ZeptoMail respondió ' + resp.status + ': ' + cuerpo.slice(0, 300) };
}

function _escaparHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

export default { enviarPorApiHttp, emailApiConfigurado };
