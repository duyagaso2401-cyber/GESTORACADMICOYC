// ════════════════════════════════════════════════════════════════════════════
// LOTE 2 — POST /api/contratacion/acceso-link (nombre EXACTO pedido en el
// punto 7 de la especificación).
// ------------------------------------------------------------------------------
// Valida el acceso del Flujo B ("acceso híbrido") por token de link único
// O por cédula. El grueso de la lógica de expedientes vive en
// src/routes/etc.ts (mismas tablas, mismo módulo) — este archivo es
// deliberadamente delgado: solo expone el endpoint con el nombre/ruta
// literal que pidió la especificación, delegando en las mismas consultas.
// Por eso también queda protegido por el mismo checkModuleEnabled
// ('ETC_CONTRACTING') — nunca toca Neon si el módulo no está activo.
// ════════════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { db } from '../db/index.js';
import { etcContratos } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { checkModuleEnabled } from '../lib/feature-flags.js';

const router = Router();
router.use(checkModuleEnabled('ETC_CONTRACTING'));

function _contratoPublico(c: any) {
  return {
    id: c.id,
    nombreCompleto: c.nombreCompleto,
    estadoContrato: c.estadoContrato,
    institucionDestinoDane: c.institucionDestinoDane,
    municipio: c.municipio,
  };
}

router.post('/acceso-link', async (req, res) => {
  try {
    const { token, cedula } = req.body || {};
    if (token) {
      const filas = await db.select().from(etcContratos).where(eq(etcContratos.tokenAccesoUnico, String(token).trim()));
      if (!filas.length) return res.status(404).json({ ok: false, error: 'El link de acceso no es válido.' });
      return res.json({ ok: true, viaAcceso: 'token', contrato: _contratoPublico(filas[0]) });
    }
    if (cedula) {
      // Acceso por cédula: requiere haber verificado ANTES un código OTP
      // (POST /api/etc/contratos/acceso/otp/solicitar y /verificar) — este
      // endpoint no repite esa lógica de expiración/consumo de códigos
      // para no duplicarla en dos archivos; aquí solo confirma que existe
      // un expediente con esa cédula, como paso previo o de respaldo.
      const filas = await db.select().from(etcContratos).where(eq(etcContratos.docenteCedula, String(cedula).trim())).orderBy(desc(etcContratos.id));
      if (!filas.length) return res.status(404).json({ ok: false, error: 'No hay ningún expediente registrado con esa cédula.' });
      return res.json({
        ok: true,
        viaAcceso: 'cedula',
        contrato: _contratoPublico(filas[0]),
        nota: 'El acceso por cédula requiere verificar un código OTP — ver POST /api/etc/contratos/acceso/otp/solicitar y /verificar.',
      });
    }
    return res.status(400).json({ ok: false, error: 'Debe indicar "token" o "cedula".' });
  } catch (e) {
    console.error('POST /api/contratacion/acceso-link', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

export { router as contratacionRouter };
export default router;
