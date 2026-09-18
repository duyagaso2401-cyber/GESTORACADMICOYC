// ════════════════════════════════════════════════════════════════════════════
// PROVEEDOR DE NOTIFICACIONES PUSH (Web Push) — extraído de src/index.ts en
// la Ronda 33 para que también pueda usarlo src/routes/etc.ts (notificación
// flotante al docente cuando se evalúa un permiso/contrato) sin crear una
// dependencia circular entre ese router e index.ts (el mismo motivo por el
// que ya existe src/lib/sync-bus.ts para broadcastChange/sseClients).
//
// Es EXACTAMENTE el mismo mecanismo que ya existía (misma librería
// 'web-push', misma configuración VAPID leída de las mismas variables de
// entorno, mismo comportamiento de "nunca lanza, nunca bloquea, limpia
// suscripciones vencidas en 404/410") — solo movido a su propio archivo.
// index.ts lo sigue usando igual que antes, importándolo desde aquí.
// ════════════════════════════════════════════════════════════════════════════
import webpush from 'web-push';
import { eq } from 'drizzle-orm';
import { db, kvStore, pushSubscriptions } from '../db/index.js';

// Generar un par nuevo con: npx web-push generate-vapid-keys
export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:soporte@gestoracademicoyc.com';
export const PUSH_HABILITADO = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (PUSH_HABILITADO) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('⚠️ VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no configuradas: las notificaciones push están desactivadas.');
}

// Envía una notificación push a los dispositivos suscritos que correspondan
// a la institución (y, si aplica, al grado) del evento que la origina.
// Nunca lanza: un fallo aquí no debe afectar la respuesta HTTP normal.
export async function enviarPushParaNotificacion(sk: string, kind: string, message: string, meta: any) {
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

// ════════════════════════════════════════════════════════════════════════════
// Ronda 33 — Push flotante dirigido a UN docente específico (por cédula/
// usuario), no a toda una institución/grado. Reutiliza la misma tabla
// pushSubscriptions (columnas "userU"/"rol" YA EXISTÍAN desde antes de esta
// ronda — ver 03-app-core.js activarNotificacionesPush(), que ya envía
// userU=sesion.u y rol=sesion.r al suscribirse) y el mismo webpush ya
// configurado arriba — NO se reinventa VAPID ni se agrega ninguna columna
// nueva a la tabla.
//
// Se usa desde src/routes/etc.ts cuando el Rector/Admin ETC evalúa un
// permiso/contrato de ese docente (Aprobado/Rechazado/Con_Observaciones):
// el docente auto-provisionado en el Lote 2 queda con "u" = su cédula (ver
// POST /api/etc/contratos/:id/evaluar), así que buscar por userU=cedula
// encuentra su suscripción sin importar en qué institución/"sk" la haya
// activado. Si se pasa "sk", además se restringe a esa institución
// (más preciso, pero opcional).
//
// GARANTÍAS DE RESILIENCIA (idénticas a enviarPushParaNotificacion):
//   - Si VAPID no está configurado (PUSH_HABILITADO=false): no hace nada.
//   - Si el docente nunca activó notificaciones push en su navegador (no
//     hay fila en pushSubscriptions para su usuario): no hace nada.
//   - Si el envío falla (suscripción revocada, sin red, etc.): se captura,
//     nunca se relanza — JAMÁS puede tumbar ni demorar el endpoint que la
//     llama, ni traducirse en un 500/501 hacia el cliente HTTP.
// ════════════════════════════════════════════════════════════════════════════
export async function enviarPushADocente(cedula: string, titulo: string, mensaje: string, sk?: string | null): Promise<void> {
  if (!PUSH_HABILITADO) return;
  const cedulaLimpia = String(cedula || '').trim();
  if (!cedulaLimpia) return;
  try {
    let subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userU, cedulaLimpia));
    if (!subs.length) return;
    if (sk) subs = subs.filter(s => s.sk === sk);
    if (!subs.length) return;
    const payload = JSON.stringify({
      title: String(titulo || 'Gestor Académico YC').slice(0, 80),
      body: String(mensaje || '').slice(0, 200),
      kind: 'etc_evaluacion',
    });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription as any, payload);
      } catch (err: any) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        }
      }
    }));
  } catch (e) {
    console.error('enviarPushADocente', e);
  }
}
