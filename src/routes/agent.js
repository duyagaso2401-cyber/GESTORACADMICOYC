// =====================================================================
// src/routes/agent.js
// Rutas HTTP del AGENTE AUTÓNOMO Y AUDITOR SUPREMO DEL ECOSISTEMA.
// Archivo .js plano (ESM), misma convención que src/university-lms/ — la
// lógica real vive en src/services/ecosystemAgent.js; este archivo solo
// traduce peticiones HTTP a llamadas de ese servicio.
//
// Nota sobre autenticación: igual que otras rutas exclusivas del Súper
// Admin ya existentes en este proyecto (ej. GET /api/inetis/gestordb), el
// control de acceso al panel "🤖 Auditoría IA / Agente" es del mismo tipo
// que el resto del panel del Gestor (verificado en el navegador contra
// gestorDB.superAdmin, sin un token de sesión server-side propio) — no se
// inventó aquí un mecanismo de autenticación nuevo y distinto al del resto
// del panel para no crear dos modelos de seguridad diferentes conviviendo
// en el mismo sistema. El rate-limiter general de /api/ (ya montado en
// src/index.ts antes de este router) sigue aplicando igual aquí.
//
// Montaje esperado en src/index.ts:
//   import agentRouter from './routes/agent.js';
//   app.use('/api/agent', agentRouter);
// =====================================================================
import { Router } from 'express';
import { runFullAudit, listarLogsAuditoria, processVoiceGrades, agentGeminiConfigurado, AGENT_MODEL } from '../services/ecosystemAgent.js';

const router = Router();

// Evita que dos auditorías completas corran en paralelo si alguien golpea
// el botón "Disparar Auditoría Ahora" varias veces seguidas — cada ciclo
// ya es, de por sí, poco frecuente e idempotente (la incremental no repite
// trabajo), pero esto ahorra una carrera innecesaria contra Neon.
let _auditoriaEnCurso = false;

router.post('/run-full-audit', async (_req, res) => {
  if (_auditoriaEnCurso) {
    return res.status(409).json({ ok: false, error: 'AUDITORIA_EN_CURSO', mensaje: 'Ya hay una auditoría en curso — espere a que termine antes de disparar otra.' });
  }
  _auditoriaEnCurso = true;
  try {
    const resultado = await runFullAudit({ trigger: 'manual' });
    return res.json(resultado);
  } catch (e) {
    console.error('POST /api/agent/run-full-audit', e);
    return res.status(500).json({ ok: false, error: 'Error interno al ejecutar la auditoría.' });
  } finally {
    _auditoriaEnCurso = false;
  }
});

router.get('/status', (_req, res) => {
  res.json({ ok: true, geminiConfigurado: agentGeminiConfigurado(), modelo: AGENT_MODEL, auditoriaEnCurso: _auditoriaEnCurso });
});

router.get('/logs', async (req, res) => {
  try {
    const { status, category, limit } = req.query;
    const filas = await listarLogsAuditoria({
      status: status ? String(status) : undefined,
      category: category ? String(category) : undefined,
      limit: limit ? String(limit) : undefined,
    });
    return res.json({ ok: true, logs: filas });
  } catch (e) {
    console.error('GET /api/agent/logs', e);
    return res.status(500).json({ ok: false, error: 'Error interno al leer la bitácora.' });
  }
});

router.post('/process-voice-grades', async (req, res) => {
  try {
    const { transcript, listaEstudiantes } = req.body || {};
    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ ok: false, error: 'transcript requerido' });
    }
    const resultado = await processVoiceGrades({ transcript, listaEstudiantes });
    return res.json(resultado);
  } catch (e) {
    console.error('POST /api/agent/process-voice-grades', e);
    return res.status(500).json({ ok: false, error: 'Error interno al procesar el dictado de voz.' });
  }
});

export default router;
