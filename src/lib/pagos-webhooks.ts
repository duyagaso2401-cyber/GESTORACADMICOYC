// ════════════════════════════════════════════════════════════════════════════
// VERIFICACIÓN DE FIRMA DE WEBHOOKS DE PASARELAS DE PAGO
// ------------------------------------------------------------------------------
// "4 pilares de autonomía" — Pilar 2 (Módulo Financiero + Pasarela de Pago
// Multi-propósito vía Webhooks). Un webhook de pagos SIN verificación de
// firma es una puerta abierta: cualquiera podría llamar a la URL y fingir
// que un pago se aprobó. Cada proveedor firma sus eventos de forma
// distinta; aquí se implementa la verificación de cada uno a mano, con
// el módulo nativo "crypto" de Node únicamente — sin agregar el SDK oficial
// de ningún proveedor como dependencia nueva — siguiendo el mismo criterio
// de "sin dependencias nuevas si el nativo alcanza" ya usado en el resto
// del proyecto (ver db-cache.ts y reset-tokens.ts). Stripe es el único de
// los tres cuyo SDK oficial de Node incluye un helper para esto
// (stripe.webhooks.constructEvent); Wompi no tiene SDK oficial para esto y
// el SDK oficial de Mercado Pago para Node tampoco lo trae (solo el de Go
// lo trae) — para los tres, implementar a mano es, de hecho, el camino
// normal/documentado por el propio proveedor, no un atajo.
//
// Fuente de cada algoritmo: documentación oficial de cada proveedor
// (docs.wompi.co, mercadopago.com.co/developers, docs.stripe.com),
// consultada al momento de escribir este código.
// ════════════════════════════════════════════════════════════════════════════
import crypto from 'crypto';

function compararHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(String(a || ''), 'hex');
    const bufB = Buffer.from(String(b || ''), 'hex');
    if (bufA.length !== bufB.length || !bufA.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ── Acceso a un valor anidado por ruta con puntos, ej. "transaction.id" ────
function leerRutaAnidada(obj: any, ruta: string): unknown {
  return ruta.split('.').reduce((acc: any, clave: string) => (acc == null ? undefined : acc[clave]), obj);
}

/**
 * Wompi (Colombia): el evento trae `signature.properties` (rutas dentro de
 * "data" a concatenar, en ese orden, sin separador), se le agrega el
 * `timestamp` del evento y el "Secreto de eventos" de la cuenta (Dashboard
 * → Integraciones técnicas — NO es la misma llave que la API key pública),
 * y se hashea todo junto con SHA-256 (hash simple con secreto al final, NO
 * es HMAC — así lo documenta Wompi). Se compara contra `signature.checksum`.
 */
export function verificarFirmaWompi(cuerpo: any, secretoEventos: string): boolean {
  try {
    const props: string[] = cuerpo?.signature?.properties;
    const checksumRecibido: string = cuerpo?.signature?.checksum;
    const timestamp = cuerpo?.timestamp;
    if (!Array.isArray(props) || !props.length || !checksumRecibido || timestamp === undefined) return false;
    const valores = props.map((ruta) => {
      const v = leerRutaAnidada(cuerpo?.data, ruta);
      return v === undefined || v === null ? '' : String(v);
    });
    const cadena = valores.join('') + String(timestamp) + secretoEventos;
    const checksumCalculado = crypto.createHash('sha256').update(cadena).digest('hex');
    return compararHex(checksumCalculado, checksumRecibido);
  } catch {
    return false;
  }
}

/**
 * Mercado Pago: cabecera "x-signature" con formato "ts=<...>,v1=<hex>", y
 * cabecera "x-request-id". El "manifiesto" firmado es exactamente:
 *   id:{dataId};request-id:{x-request-id};ts:{ts};
 * (con los ";" incluidos, dataId en minúsculas si trae letras), firmado con
 * HMAC-SHA256 usando el "secret key" del webhook (Dashboard → Tus
 * integraciones → Webhooks).
 */
export function verificarFirmaMercadoPago(dataId: string, xRequestId: string, xSignatureHeader: string, secreto: string): boolean {
  try {
    if (!dataId || !xRequestId || !xSignatureHeader || !secreto) return false;
    const partes: Record<string, string> = {};
    for (const trozo of String(xSignatureHeader).split(',')) {
      const [clave, valor] = trozo.split('=');
      if (clave && valor !== undefined) partes[clave.trim()] = valor.trim();
    }
    const ts = partes['ts'];
    const v1Recibido = partes['v1'];
    if (!ts || !v1Recibido) return false;
    const idNormalizado = String(dataId).toLowerCase();
    const manifiesto = `id:${idNormalizado};request-id:${xRequestId};ts:${ts};`;
    const v1Calculado = crypto.createHmac('sha256', secreto).update(manifiesto).digest('hex');
    return compararHex(v1Calculado, v1Recibido);
  } catch {
    return false;
  }
}

/**
 * Stripe: cabecera "Stripe-Signature" con formato "t=<unix>,v1=<hex>[,v1=<hex>...]".
 * El payload firmado es EXACTAMENTE "{t}.{cuerpo crudo sin re-serializar}",
 * firmado con HMAC-SHA256 usando el "signing secret" del endpoint
 * (whsec_...). Se compara contra CUALQUIERA de los valores "v1" presentes
 * (puede haber varios durante una rotación de secreto) — se ignoran los
 * "v0" (solo para compatibilidad histórica; aceptar "v0" permitiría un
 * ataque de downgrade). Además se exige que el evento no sea demasiado
 * viejo (tolerancia de 5 minutos, igual que el valor por defecto de Stripe)
 * para frenar ataques de repetición.
 */
export function verificarFirmaStripe(cuerpoCrudo: Buffer, stripeSignatureHeader: string, secreto: string, toleranciaSeg = 300): boolean {
  try {
    if (!cuerpoCrudo || !stripeSignatureHeader || !secreto) return false;
    let t = '';
    const v1s: string[] = [];
    for (const trozo of String(stripeSignatureHeader).split(',')) {
      const [clave, valor] = trozo.split('=');
      if (clave === 't' && valor) t = valor.trim();
      else if (clave === 'v1' && valor) v1s.push(valor.trim());
    }
    if (!t || !v1s.length) return false;
    const ahoraSeg = Math.floor(Date.now() / 1000);
    if (Math.abs(ahoraSeg - Number(t)) > toleranciaSeg) return false; // evento demasiado viejo (o reloj desincronizado) — se rechaza por seguridad
    const payloadFirmado = Buffer.concat([Buffer.from(`${t}.`, 'utf8'), cuerpoCrudo]);
    const calculado = crypto.createHmac('sha256', secreto).update(payloadFirmado).digest('hex');
    return v1s.some((v1) => compararHex(calculado, v1));
  } catch {
    return false;
  }
}

/**
 * Normaliza los distintos nombres de estado "aprobado" que usa cada
 * proveedor a un único vocabulario interno consistente con fin_transacciones.estado.
 */
export function normalizarEstadoPago(proveedor: string, estadoBruto: string): 'pendiente' | 'aprobado' | 'rechazado' | 'reembolsado' {
  const e = String(estadoBruto || '').toUpperCase();
  if (['APPROVED', 'APPROVED_PAYMENT', 'ACCREDITED', 'SUCCEEDED', 'PAID', 'COMPLETED'].includes(e)) return 'aprobado';
  if (['DECLINED', 'REJECTED', 'FAILED', 'CANCELED', 'CANCELLED'].includes(e)) return 'rechazado';
  // Ronda 13: por instrucción explícita del usuario, una disputa/contracargo
  // ("DISPUTED"/"CHARGEBACK", nombrados distinto según el proveedor y el
  // caso) se trata igual que un reembolso confirmado — dispara la misma
  // reversión de mensualidad/revocación de certificado en
  // _registrarTransaccionPago(). Es una simplificación consciente: una
  // disputa "abierta" no siempre termina fallando a favor del comprador,
  // pero el usuario pidió explícitamente reaccionar de una vez por
  // seguridad, en vez de esperar la resolución final del proveedor.
  if (['REFUNDED', 'REFUND', 'CHARGED_BACK', 'CHARGEBACK', 'DISPUTED', 'DISPUTE', 'IN_DISPUTE'].includes(e)) return 'reembolsado';
  return 'pendiente';
}

/**
 * Convención de "reference"/"external_reference" que el propio sistema debe
 * usar al CREAR el enlace/preferencia de pago con el proveedor (fuera del
 * alcance de este andamiaje — es responsabilidad del frontend/admin al
 * generar el cobro), para que el webhook sepa a qué institución/estudiante/
 * concepto corresponde el pago cuando llega la notificación:
 *   "<tipo>:<sk>:<estudianteId-o-vacio>:<conceptoCorto>"
 *   ej: "mensualidad:INST123:est456:Mensualidad-Sept-2026"
 *       "tramite:INST123:est456:Certificado-Notas"
 *       "suscripcion_saas:INST123::Plan-Institucional-Mensual"
 */
export interface ReferenciaPago {
  tipo: 'suscripcion_saas' | 'mensualidad' | 'tramite';
  sk: string;
  estudianteId: string;
  concepto: string;
}
export function parsearReferenciaPago(referencia: string): ReferenciaPago | null {
  if (!referencia || typeof referencia !== 'string') return null;
  const partes = referencia.split(':');
  if (partes.length < 4) return null;
  const [tipoBruto, sk, estudianteId, ...resto] = partes;
  const tipo = tipoBruto as ReferenciaPago['tipo'];
  if (!['suscripcion_saas', 'mensualidad', 'tramite'].includes(tipo) || !sk) return null;
  return { tipo, sk, estudianteId: estudianteId || '', concepto: resto.join(':') || '' };
}
