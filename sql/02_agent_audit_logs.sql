-- ════════════════════════════════════════════════════════════════════════════
-- AGENTE AUTÓNOMO Y AUDITOR SUPREMO DEL ECOSISTEMA — bitácora de auditorías
-- ------------------------------------------------------------------------------
-- EJECUCIÓN MANUAL OPCIONAL: src/db/index.ts (función initDb(), que corre
-- automáticamente cada vez que arranca el servidor) YA crea esta misma tabla
-- con "CREATE TABLE IF NOT EXISTS" — no hace falta ejecutar este archivo a
-- mano para que el sistema funcione. Se deja aquí, igual que
-- sql/01_univ_lms_schema.sql, como referencia legible del esquema y por si
-- prefiere crearla usted mismo desde psql/Neon antes del primer despliegue.
--
-- Una fila por hallazgo/acción del agente (no una fila por ciclo de auditoría
-- completo). "details" (JSONB) es el único lugar donde el agente puede
-- guardar metadatos adicionales — tiene prohibido ejecutar ALTER TABLE o
-- CREATE TABLE en tiempo de ejecución (ver la regla de "Control de Esquema de
-- BD" en src/services/ecosystemAgent.js).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_audit_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  category TEXT NOT NULL,             -- 'Academico' | 'Tecnico' | 'Sincronizacion'
  issue_detected TEXT NOT NULL,
  action_taken TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Informativo', -- 'Corregido' | 'Alerta' | 'Informativo'
  details JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS agent_audit_logs_timestamp_idx ON agent_audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS agent_audit_logs_category_idx ON agent_audit_logs(category);
CREATE INDEX IF NOT EXISTS agent_audit_logs_status_idx ON agent_audit_logs(status);
