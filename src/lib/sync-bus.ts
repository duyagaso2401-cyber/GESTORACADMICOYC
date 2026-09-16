// ════════════════════════════════════════════════════════════════════════════
// BUS DE SINCRONIZACIÓN EN TIEMPO REAL (Server-Sent Events) — extraído de
// src/index.ts para que también pueda usarlo el AGENTE AUTÓNOMO Y AUDITOR
// SUPREMO DEL ECOSISTEMA (src/services/ecosystemAgent.js), sin crear una
// dependencia circular entre ese servicio e index.ts.
//
// Es exactamente el mismo mecanismo que ya existía (mismo Map de clientes,
// mismo formato de mensaje "type:'change'"), solo movido a su propio
// archivo — index.ts lo sigue usando igual que antes, importándolo desde
// aquí en vez de declararlo localmente.
//
// El agente lo usa para su herramienta `triggerSystemSync({nodeId})`:
// como este proyecto no tiene una cola de sincronización propia en el
// servidor (la sincronización offline-first vive en el navegador de cada
// dispositivo — ver 07-sync-engine.js / _notasPendientes en
// 03-app-core.js), "destrabar" una sincronización pendiente en el servidor
// significa, en la práctica, forzar un nuevo aviso "change" por este mismo
// canal para que todos los dispositivos conectados de esa institución
// vuelvan a sincronizar de inmediato — el mismo aviso que ya se dispara
// automáticamente después de cada guardado exitoso.
// ════════════════════════════════════════════════════════════════════════════

import type express from 'express';

export const sseClients = new Map<string, Set<express.Response>>();

export function broadcastChange(sk: string, extra?: Record<string, unknown>) {
  const clients = sseClients.get(sk);
  if (!clients || clients.size === 0) return;
  const msg = `data: ${JSON.stringify({ type: 'change', sk, ts: Date.now(), ...extra })}\n\n`;
  clients.forEach(res => {
    try { res.write(msg); } catch {}
  });
}

/** Cuántos dispositivos de una institución están conectados ahora mismo por SSE — usado por triggerSystemSync para informar si de verdad había alguien a quien "destrabar". */
export function contarClientesSse(sk: string): number {
  return sseClients.get(sk)?.size || 0;
}
