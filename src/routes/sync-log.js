// =====================================================================
// src/routes/sync-log.js
// Ronda 20 — "bitácora de conflictos" (propuesta en el checklist de la
// Ronda 19, ahora implementada a pedido explícito del usuario).
//
// Qué resuelve: en la Ronda 19 se auditó el algoritmo de fusión de 3 vías
// (_combinarValorMerge/_merge3way, en gestor-academico/dist/modules/03-app-
// core.js) y no se encontró un defecto concreto que borre notas de un
// compañero, pero tampoco se pudo descartar por completo un caso no
// reproducido — el aviso "Se combinaron automáticamente cambios guardados
// por otra persona" no traía evidencia de QUÉ se combinó. Este endpoint
// recibe esa evidencia (campo exacto, valor de cada lado, cuál ganó) cada
// vez que el frontend detecta un conflicto REAL (no cada sincronización:
// solo cuando de verdad hubo un valor tocado por ambos lados) y la deja en
// agent_audit_logs con categoría "Sincronizacion", para que la próxima vez
// que un docente reporte una nota "desaparecida" se pueda revisar el panel
// "🤖 Auditoría IA / Agente" del Súper Admin y confirmar (o descartar) con
// datos concretos si un conflicto de sincronización fue la causa.
//
// Diseño deliberado: archivo NUEVO y separado de src/routes/agent.js (y no
// se tocó src/services/ecosystemAgent.js) — ambos son artefactos de la
// Ronda 17 que las Rondas 18/19/20 vienen dejando intactos a propósito,
// para no arriesgar el EcosystemAgent ya probado. Aquí solo se REUTILIZA la
// tabla "agent_audit_logs" que esos archivos ya definieron — la inserción
// usa la misma tabla/conexión Drizzle (import desde src/db/index.js), así
// que las filas nuevas aparecen automáticamente en el panel existente sin
// tocar ese panel ni su endpoint GET /api/agent/logs.
//
// Nunca debe poder bloquear ni retrasar el guardado real de una nota: si
// esta ruta falla o no hay conexión, el frontend la llama con
// "fire-and-forget" (fetch(...).catch(()=>{})) — ver _registrarConflictoBitacora
// en 03-app-core.js. Es pura evidencia/auditoría, no una condición para
// poder guardar.
//
// Montaje esperado en src/index.ts:
//   import syncLogRouter from './routes/sync-log.js';
//   app.use('/api/sync-log', syncLogRouter);
// =====================================================================
import { Router } from 'express';
import { db, agentAuditLogs } from '../db/index.js';

const router = Router();

// Tope de detalles por evento — un merge inusualmente grande (ej. una
// reconciliación masiva tras una migración) no debe producir una fila de
// varios MB en la base de datos; con los primeros conflictos ya alcanza
// como evidencia. El frontend ya recorta a 50 antes de enviar (ver
// _registrarConflictoBitacora), esto es una segunda salvaguarda del lado
// del servidor por si algún día cambia el frontend sin recordar ese límite.
const MAX_DETALLES = 50;

router.post('/conflicto', async (req, res) => {
  try {
    const { sk, docente, rol, origen, conflictos, detalles } = req.body || {};
    if (!sk || typeof sk !== 'string') {
      return res.status(400).json({ ok: false, error: 'sk requerido' });
    }
    if (!Array.isArray(detalles) || !detalles.length) {
      // Nada real que registrar (el frontend solo debería llamar aquí
      // cuando conflictos>0, pero se valida igual del lado del servidor).
      return res.status(400).json({ ok: false, error: 'Se requiere al menos un detalle de conflicto' });
    }
    const detallesAcotados = detalles.slice(0, MAX_DETALLES);
    const rutas = detallesAcotados.slice(0, 3).map((d) => (d && d.path) || '?').join(', ');
    const totalConflictos = Number(conflictos) || detallesAcotados.length;
    await db.insert(agentAuditLogs).values({
      category: 'Sincronizacion',
      issueDetected: `Conflicto de sincronización combinado automáticamente en la institución "${sk}"` +
        (docente ? ` (docente: ${docente})` : '') +
        ` — ${totalConflictos} valor(es): ${rutas}${detallesAcotados.length > 3 ? '…' : ''}`,
      actionTaken: 'Se combinó automáticamente con fusión de 3 vías (_merge3way); ver "details" para el campo exacto, el valor de cada lado y cuál ganó.',
      status: 'Informativo',
      details: {
        sk,
        docente: docente || '',
        rol: rol || '',
        origen: origen || '',
        conflictos: totalConflictos,
        detalles: detallesAcotados,
      },
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/sync-log/conflicto', e);
    return res.status(500).json({ ok: false, error: 'Error interno al registrar el conflicto.' });
  }
});

export default router;
