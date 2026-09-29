// ════════════════════════════════════════════════════════════════════════
// RONDA 89 — SISTEMA DE ALERTAS AUTOMÁTICAS PROACTIVAS (Push Multidispositivo
// + WhatsApp) para el Módulo de Monitoreo de Recursos y Cuotas (Ronda 88).
//
// DISEÑO (construido sobre lo ya existente, no reinventado):
//  - Las suscripciones Push del Súper Admin viven en la MISMA tabla
//    push_subscriptions que ya usan docentes/acudientes (columna nueva
//    is_superadmin), pero se registran por un endpoint COMPLETAMENTE
//    APARTE (/api/admin/push/subscribe-superadmin) protegido por el mismo
//    token de rescate que ya usa "🖥️ Estado del Servidor" (Ronda 49) y
//    "📡 Recursos y Cuotas" (Ronda 88) — esto es lo que garantiza el
//    requerimiento #4 (ningún admin/docente/estudiante de institución
//    puede suscribirse: nunca pueden obtener ese token).
//  - WhatsApp es un canal NUEVO e independiente (src/lib/whatsapp-alert.ts),
//    con el MISMO patrón de despacho a Twilio ya probado en
//    src/lib/sms-provider.ts (Basic Auth + form-urlencoded a
//    Messages.json), solo que dirigido siempre al mismo número fijo del
//    Súper Admin (variables de entorno, no multi-tenant).
//  - El job (src/lib/infrastructure-alert-job.ts) reutiliza
//    obtenerEstadoRecursos() de la Ronda 88 (misma caché de 20 min) y
//    persiste el cooldown de 24h en una tabla nueva (infra_alert_cooldown)
//    para que sobreviva un reinicio del proceso Node.
//
// ESTRATEGIA DE PRUEBAS: infrastructure-alert-job.ts depende de
// drizzle-orm/pg (vía src/db/index.ts) y push-provider.ts depende de
// web-push — ninguno instalado en este entorno de pruebas (no hay
// node_modules). Para poder ejecutar de VERDAD la lógica real de
// orquestación (no solo inspeccionarla por texto), se copia el archivo
// REAL infrastructure-alert-job.ts a una carpeta temporal reescribiendo
// ÚNICAMENTE sus rutas de import hacia unos módulos STUB (mismo criterio ya
// usado en Ronda 88 para resource-monitor.ts, extendido aquí a que los
// propios stubs reemplacen drizzle/webpush/whatsapp) — la lógica de negocio
// que se ejecuta es la real, palabra por palabra.
// ════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function check(desc, fn) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}
async function checkAsync(desc, fn) {
  try { await fn(); pass++; console.log('✅ ' + desc); }
  catch (e) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

// ════════════════════════════════════════════════════════════════════════
// PARTE A — src/lib/infra-alert-thresholds.ts: lógica pura, sin
// dependencias externas — se importa directamente el archivo real.
// ════════════════════════════════════════════════════════════════════════
const thresholds = await import('./src/lib/infra-alert-thresholds.ts');

check('UMBRAL_ADVERTENCIA_PCT=85 / UMBRAL_CRITICO_ALERTA_PCT=90 — exactamente los umbrales pedidos (distintos de los 80/90 visuales del panel)', () => {
  assert.equal(thresholds.UMBRAL_ADVERTENCIA_PCT, 85);
  assert.equal(thresholds.UMBRAL_CRITICO_ALERTA_PCT, 90);
});
check('COOLDOWN_ALERTA_MS = 24 horas exactas', () => {
  assert.equal(thresholds.COOLDOWN_ALERTA_MS, 24 * 60 * 60 * 1000);
});
check('INTERVALO_JOB_ALERTAS_MS = 2 horas exactas', () => {
  assert.equal(thresholds.INTERVALO_JOB_ALERTAS_MS, 2 * 60 * 60 * 1000);
});
check('nivelAlertaDisparado(): 84% no dispara nada, 85% dispara "advertencia", 90% dispara "critica"', () => {
  assert.equal(thresholds.nivelAlertaDisparado(84), null);
  assert.equal(thresholds.nivelAlertaDisparado(85), 'advertencia');
  assert.equal(thresholds.nivelAlertaDisparado(89.9), 'advertencia');
  assert.equal(thresholds.nivelAlertaDisparado(90), 'critica');
  assert.equal(thresholds.nivelAlertaDisparado(150), 'critica');
});
check('nivelAlertaDisparado(): con dato no disponible (null/undefined) nunca dispara — no hay alerta falsa por falta de dato', () => {
  assert.equal(thresholds.nivelAlertaDisparado(null), null);
  assert.equal(thresholds.nivelAlertaDisparado(undefined), null);
});
check('claveCooldown(): distingue advertencia de crítica para el MISMO servicio (subir de nivel es una alerta nueva)', () => {
  assert.equal(thresholds.claveCooldown('render', 'advertencia'), 'render:advertencia');
  assert.equal(thresholds.claveCooldown('render', 'critica'), 'render:critica');
  assert.notEqual(thresholds.claveCooldown('render', 'advertencia'), thresholds.claveCooldown('neon', 'advertencia'));
});
check('debeEnviarAlerta(): true si nunca se ha enviado (ultimoEnvioMs=null)', () => {
  assert.equal(thresholds.debeEnviarAlerta(null, Date.now()), true);
});
check('debeEnviarAlerta(): false si el último envío fue hace menos de 24h; true si ya pasaron 24h', () => {
  const ahora = Date.now();
  assert.equal(thresholds.debeEnviarAlerta(ahora - 23 * 60 * 60 * 1000, ahora), false);
  assert.equal(thresholds.debeEnviarAlerta(ahora - 24 * 60 * 60 * 1000, ahora), true);
  assert.equal(thresholds.debeEnviarAlerta(ahora - 25 * 60 * 60 * 1000, ahora), true);
});
check('construirMensajeAlerta(): redacta título/cuerpo distintos para "advertencia" (🟠) y "critica" (🔴), mencionando el servicio y el porcentaje', () => {
  const adv = thresholds.construirMensajeAlerta('render', 'advertencia', 87);
  assert.match(adv.titulo, /🟠/);
  assert.match(adv.titulo, /87%/);
  assert.match(adv.titulo, /Render/);
  const crit = thresholds.construirMensajeAlerta('neon', 'critica', 93);
  assert.match(crit.titulo, /🔴/);
  assert.match(crit.titulo, /93%/);
  assert.match(crit.titulo, /Neon/);
  assert.notEqual(adv.titulo, crit.titulo);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B — src/lib/whatsapp-alert.ts: NO depende de drizzle/pg (solo de
// fetch/Buffer/process.env, nativos) — se importa directamente el archivo
// real y se mockea `global.fetch`.
// ════════════════════════════════════════════════════════════════════════
async function _importarWhatsapp(env) {
  const previos = { WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED, WHATSAPP_ADMIN_PHONE: process.env.WHATSAPP_ADMIN_PHONE, TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER: process.env.TWILIO_WHATSAPP_NUMBER };
  delete process.env.WHATSAPP_ENABLED; delete process.env.WHATSAPP_ADMIN_PHONE; delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_WHATSAPP_NUMBER;
  Object.assign(process.env, env);
  try {
    return await import('./src/lib/whatsapp-alert.ts?t=' + Date.now() + Math.random());
  } finally {
    Object.assign(process.env, previos);
  }
}

await checkAsync('WHATSAPP_CONFIGURADO: false si WHATSAPP_ENABLED no es "true" (aunque las demás variables sí estén puestas)', async () => {
  const m = await _importarWhatsapp({ WHATSAPP_ENABLED: 'false', WHATSAPP_ADMIN_PHONE: '+573000000000', TWILIO_ACCOUNT_SID: 'ACx', TWILIO_AUTH_TOKEN: 'tok', TWILIO_WHATSAPP_NUMBER: '+14155238886' });
  assert.equal(m.WHATSAPP_CONFIGURADO, false);
});
await checkAsync('enviarAlertaWhatsapp(): con WHATSAPP_ENABLED=false, no llama a fetch y responde ok:false de inmediato', async () => {
  const fetchOriginal = global.fetch;
  let llamadas = 0;
  global.fetch = async () => { llamadas++; throw new Error('no debería llamarse'); };
  try {
    const m = await _importarWhatsapp({ WHATSAPP_ENABLED: 'false' });
    const r = await m.enviarAlertaWhatsapp('mensaje de prueba');
    assert.equal(r.ok, false);
    assert.equal(llamadas, 0);
  } finally { global.fetch = fetchOriginal; }
});
await checkAsync('enviarAlertaWhatsapp(): habilitado pero sin TWILIO_ACCOUNT_SID/AUTH_TOKEN configurados, no llama a fetch y responde ok:false', async () => {
  const fetchOriginal = global.fetch;
  let llamadas = 0;
  global.fetch = async () => { llamadas++; return { ok: true, status: 200 }; };
  try {
    const m = await _importarWhatsapp({ WHATSAPP_ENABLED: 'true', WHATSAPP_ADMIN_PHONE: '+573000000000' });
    const r = await m.enviarAlertaWhatsapp('mensaje de prueba');
    assert.equal(r.ok, false);
    assert.equal(llamadas, 0);
  } finally { global.fetch = fetchOriginal; }
});
await checkAsync('enviarAlertaWhatsapp(): completamente configurado, despacha a la API de Twilio con Basic Auth y los números en formato "whatsapp:+..."', async () => {
  const fetchOriginal = global.fetch;
  let capturada = null;
  global.fetch = async (url, opts) => {
    capturada = { url: String(url), opts };
    return { ok: true, status: 201 };
  };
  try {
    const m = await _importarWhatsapp({ WHATSAPP_ENABLED: 'true', WHATSAPP_ADMIN_PHONE: '+573001112233', TWILIO_ACCOUNT_SID: 'ACabc', TWILIO_AUTH_TOKEN: 'tok123', TWILIO_WHATSAPP_NUMBER: '+14155238886' });
    const r = await m.enviarAlertaWhatsapp('🔴 CRÍTICO: Render al 92%');
    assert.equal(r.ok, true);
    assert.match(capturada.url, /api\.twilio\.com\/2010-04-01\/Accounts\/ACabc\/Messages\.json/);
    assert.match(capturada.opts.headers.Authorization, /^Basic /);
    const cuerpo = String(capturada.opts.body);
    assert.match(cuerpo, /To=whatsapp%3A%2B573001112233/);
    assert.match(cuerpo, /From=whatsapp%3A%2B14155238886/);
  } finally { global.fetch = fetchOriginal; }
});
await checkAsync('enviarAlertaWhatsapp(): si fetch lanza (red caída), se degrada a ok:false sin propagar la excepción', async () => {
  const fetchOriginal = global.fetch;
  global.fetch = async () => { throw new Error('ENOTFOUND simulado'); };
  try {
    const m = await _importarWhatsapp({ WHATSAPP_ENABLED: 'true', WHATSAPP_ADMIN_PHONE: '+573000000000', TWILIO_ACCOUNT_SID: 'ACx', TWILIO_AUTH_TOKEN: 'tok', TWILIO_WHATSAPP_NUMBER: '+14155238886' });
    const r = await m.enviarAlertaWhatsapp('x');
    assert.equal(r.ok, false);
  } finally { global.fetch = fetchOriginal; }
});

// ════════════════════════════════════════════════════════════════════════
// PARTE C — src/lib/infrastructure-alert-job.ts: orquestación real, con
// stubs de drizzle/db, resource-monitor, push-provider y whatsapp-alert
// (ver comentario de cabecera). Esto ejecuta la lógica REAL de cooldown +
// disparo de umbrales + doble canal, no solo la inspecciona.
// ════════════════════════════════════════════════════════════════════════
const dirTmp = new URL('./_tmp_ronda89_libs/', import.meta.url);
fs.mkdirSync(dirTmp, { recursive: true });

fs.writeFileSync(new URL('infra-alert-thresholds.ts', dirTmp), fs.readFileSync(new URL('./src/lib/infra-alert-thresholds.ts', import.meta.url)));

fs.writeFileSync(new URL('db-index-stub.ts', dirTmp), `
// Stub de src/db/index.ts — reemplaza drizzle-orm/pg por un backend en
// memoria, para poder ejecutar la lógica REAL de infrastructure-alert-job.ts
// sin necesitar una base de datos ni node_modules instalados.
export function eq(col, value) { return { field: col.field, value }; }
export const infraAlertCooldown = { __name: 'infraAlertCooldown', clave: { field: 'clave' }, ultimoEnvioEn: { field: 'ultimoEnvioEn' } };
export const agentAuditLogs = { __name: 'agentAuditLogs' };
export const _cooldownStore = new Map();
export const _auditLog = [];
export function _resetDbStub() { _cooldownStore.clear(); _auditLog.length = 0; }
function _valuesResult(table, data) {
  return {
    then(res, rej) {
      if (table.__name === 'agentAuditLogs') _auditLog.push(data);
      return Promise.resolve({ ok: true }).then(res, rej);
    },
    onConflictDoUpdate(_opts) {
      if (table.__name === 'infraAlertCooldown') _cooldownStore.set(data.clave, data.ultimoEnvioEn);
      return Promise.resolve({ ok: true });
    },
  };
}
export const db = {
  select() {
    return { from(table) { return { where(cond) {
      if (table.__name === 'infraAlertCooldown') {
        const fecha = _cooldownStore.get(cond.value);
        return Promise.resolve(fecha ? [{ clave: cond.value, ultimoEnvioEn: fecha }] : []);
      }
      return Promise.resolve([]);
    } }; } };
  },
  insert(table) { return { values: (data) => _valuesResult(table, data) }; },
};
`);

fs.writeFileSync(new URL('resource-monitor-stub.ts', dirTmp), `
let _fn = async () => ({ render: { bandwidth: { porcentajeUso: null } }, neon: { transfer: { porcentajeUso: null } } });
export function _configurarEstado(fn) { _fn = fn; }
export async function obtenerEstadoRecursos(forzar) { return _fn(forzar); }
`);

fs.writeFileSync(new URL('push-provider-stub.ts', dirTmp), `
export const _llamadasPush = [];
let _resultado = { enviados: 1, total: 1 };
let _lanzar = false;
export function _configurarPush(r) { _resultado = r; }
export function _configurarPushLanza(v) { _lanzar = v; }
export function _resetPushStub() { _llamadasPush.length = 0; _resultado = { enviados: 1, total: 1 }; _lanzar = false; }
export async function enviarPushATodosLosSuperAdmins(titulo, mensaje, kind) {
  _llamadasPush.push({ titulo, mensaje, kind });
  if (_lanzar) throw new Error('fallo simulado de Push');
  return _resultado;
}
`);

fs.writeFileSync(new URL('whatsapp-alert-stub.ts', dirTmp), `
export const _llamadasWhatsapp = [];
let _resultado = { ok: true, detalle: 'ok' };
let _lanzar = false;
export function _configurarWhatsapp(r) { _resultado = r; }
export function _configurarWhatsappLanza(v) { _lanzar = v; }
export function _resetWhatsappStub() { _llamadasWhatsapp.length = 0; _resultado = { ok: true, detalle: 'ok' }; _lanzar = false; }
export async function enviarAlertaWhatsapp(mensaje) {
  _llamadasWhatsapp.push(mensaje);
  if (_lanzar) throw new Error('fallo simulado de WhatsApp');
  return _resultado;
}
`);

let jobSrc = fs.readFileSync(new URL('./src/lib/infrastructure-alert-job.ts', import.meta.url), 'utf8');
jobSrc = jobSrc
  .replace("import { eq } from 'drizzle-orm';\nimport { db, infraAlertCooldown, agentAuditLogs } from '../db/index.js';", "import { eq, db, infraAlertCooldown, agentAuditLogs } from './db-index-stub.ts';")
  .replace("from './resource-monitor.js'", "from './resource-monitor-stub.ts'")
  .replace("from './push-provider.js'", "from './push-provider-stub.ts'")
  .replace("from './whatsapp-alert.js'", "from './whatsapp-alert-stub.ts'")
  .replace("from './infra-alert-thresholds.js'", "from './infra-alert-thresholds.ts'");
// Verificación de que las 5 reescrituras de import realmente encontraron su
// texto (si el archivo real cambia de forma y esto deja de aplicar, mejor
// que la prueba lo diga claramente en vez de fallar de forma confusa más
// abajo con un error de módulo no encontrado).
check('(preparación) las 5 reescrituras de imports de infrastructure-alert-job.ts hacia los stubs se aplicaron', () => {
  assert.doesNotMatch(jobSrc, /from '\.\.\/db\/index\.js'/);
  assert.doesNotMatch(jobSrc, /from 'drizzle-orm'/);
  assert.doesNotMatch(jobSrc, /from '\.\/resource-monitor\.js'/);
  assert.doesNotMatch(jobSrc, /from '\.\/push-provider\.js'/);
  assert.doesNotMatch(jobSrc, /from '\.\/whatsapp-alert\.js'/);
});
fs.writeFileSync(new URL('infrastructure-alert-job.ts', dirTmp), jobSrc);

const dbStub = await import(new URL('db-index-stub.ts', dirTmp).href);
const resourceStub = await import(new URL('resource-monitor-stub.ts', dirTmp).href);
const pushStub = await import(new URL('push-provider-stub.ts', dirTmp).href);
const whatsappStub = await import(new URL('whatsapp-alert-stub.ts', dirTmp).href);
const job = await import(new URL('infrastructure-alert-job.ts', dirTmp).href);

function _resetTodosLosStubs() {
  dbStub._resetDbStub();
  pushStub._resetPushStub();
  whatsappStub._resetWhatsappStub();
}

await checkAsync('verificarYNotificarCuotas(): con ambos servicios por debajo de 85%, no dispara nada (ni Push ni WhatsApp ni cooldown)', async () => {
  _resetTodosLosStubs();
  resourceStub._configurarEstado(async () => ({ render: { bandwidth: { porcentajeUso: 40 } }, neon: { transfer: { porcentajeUso: 60 } } }));
  const resultados = await job.verificarYNotificarCuotas();
  assert.equal(resultados.length, 0);
  assert.equal(pushStub._llamadasPush.length, 0);
  assert.equal(whatsappStub._llamadasWhatsapp.length, 0);
  assert.equal(dbStub._cooldownStore.size, 0);
});

await checkAsync('verificarYNotificarCuotas(): Render al 87% (advertencia) dispara Push a TODOS los dispositivos Y WhatsApp, y registra el cooldown', async () => {
  _resetTodosLosStubs();
  resourceStub._configurarEstado(async () => ({ render: { bandwidth: { porcentajeUso: 87 } }, neon: { transfer: { porcentajeUso: 10 } } }));
  pushStub._configurarPush({ enviados: 3, total: 3 }); // simula 3 dispositivos: Laptop, Celular 1, Celular 2
  const resultados = await job.verificarYNotificarCuotas();
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].servicio, 'render');
  assert.equal(resultados[0].nivel, 'advertencia');
  assert.equal(resultados[0].omitidaPorCooldown, false);
  assert.equal(pushStub._llamadasPush.length, 1);
  assert.match(pushStub._llamadasPush[0].titulo, /87%/);
  assert.equal(whatsappStub._llamadasWhatsapp.length, 1);
  assert.match(whatsappStub._llamadasWhatsapp[0], /87%/);
  assert.ok(dbStub._cooldownStore.has('render:advertencia'));
  assert.ok(dbStub._auditLog.some((a) => a.category === 'AlertasInfraestructura'));
});

await checkAsync('verificarYNotificarCuotas(): Neon al 95% (crítico) dispara ambos canales; Render normal no dispara nada', async () => {
  _resetTodosLosStubs();
  resourceStub._configurarEstado(async () => ({ render: { bandwidth: { porcentajeUso: 20 } }, neon: { transfer: { porcentajeUso: 95 } } }));
  const resultados = await job.verificarYNotificarCuotas();
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].servicio, 'neon');
  assert.equal(resultados[0].nivel, 'critica');
  assert.match(pushStub._llamadasPush[0].titulo, /🔴/);
});

await checkAsync('verificarYNotificarCuotas(): COOLDOWN — una segunda llamada dentro de las 24h para la MISMA alerta NO reenvía Push/WhatsApp', async () => {
  _resetTodosLosStubs();
  resourceStub._configurarEstado(async () => ({ render: { bandwidth: { porcentajeUso: 91 } }, neon: { transfer: { porcentajeUso: 10 } } }));
  const primera = await job.verificarYNotificarCuotas();
  assert.equal(primera[0].omitidaPorCooldown, false);
  assert.equal(pushStub._llamadasPush.length, 1);
  assert.equal(whatsappStub._llamadasWhatsapp.length, 1);

  const segunda = await job.verificarYNotificarCuotas();
  assert.equal(segunda[0].omitidaPorCooldown, true);
  // Sin reenvío: sigue en 1, no en 2.
  assert.equal(pushStub._llamadasPush.length, 1);
  assert.equal(whatsappStub._llamadasWhatsapp.length, 1);
});

await checkAsync('verificarYNotificarCuotas(): pasadas las 24h del cooldown, SÍ vuelve a enviar la misma alerta', async () => {
  _resetTodosLosStubs();
  resourceStub._configurarEstado(async () => ({ render: { bandwidth: { porcentajeUso: 91 } }, neon: { transfer: { porcentajeUso: 10 } } }));
  await job.verificarYNotificarCuotas();
  assert.equal(pushStub._llamadasPush.length, 1);
  // Simula que ya pasaron 25 horas retrocediendo manualmente la fecha guardada.
  dbStub._cooldownStore.set('render:critica', new Date(Date.now() - 25 * 60 * 60 * 1000));
  const resultados = await job.verificarYNotificarCuotas();
  assert.equal(resultados[0].omitidaPorCooldown, false);
  assert.equal(pushStub._llamadasPush.length, 2);
});

await checkAsync('verificarYNotificarCuotas(): subir de "advertencia" (85%) a "crítica" (90%) para el MISMO servicio se trata como alerta nueva (no la bloquea el cooldown de la advertencia)', async () => {
  _resetTodosLosStubs();
  resourceStub._configurarEstado(async () => ({ render: { bandwidth: { porcentajeUso: 86 } }, neon: { transfer: { porcentajeUso: 10 } } }));
  await job.verificarYNotificarCuotas();
  assert.equal(pushStub._llamadasPush.length, 1);
  resourceStub._configurarEstado(async () => ({ render: { bandwidth: { porcentajeUso: 92 } }, neon: { transfer: { porcentajeUso: 10 } } }));
  const resultados = await job.verificarYNotificarCuotas();
  assert.equal(resultados[0].nivel, 'critica');
  assert.equal(resultados[0].omitidaPorCooldown, false);
  assert.equal(pushStub._llamadasPush.length, 2);
});

await checkAsync('verificarYNotificarCuotas(): si el Push falla (lanza), igual intenta WhatsApp — un canal caído no bloquea al otro', async () => {
  _resetTodosLosStubs();
  pushStub._configurarPushLanza(true);
  resourceStub._configurarEstado(async () => ({ render: { bandwidth: { porcentajeUso: 90 } }, neon: { transfer: { porcentajeUso: 10 } } }));
  const resultados = await job.verificarYNotificarCuotas();
  assert.equal(resultados[0].canalesOk.length, 1);
  assert.match(resultados[0].canalesOk[0], /WhatsApp/);
  assert.equal(whatsappStub._llamadasWhatsapp.length, 1);
});

await checkAsync('verificarYNotificarCuotas(): si WhatsApp falla (lanza), igual se intentó Push — se registra igual el resultado sin lanzar', async () => {
  _resetTodosLosStubs();
  whatsappStub._configurarWhatsappLanza(true);
  resourceStub._configurarEstado(async () => ({ render: { bandwidth: { porcentajeUso: 90 } }, neon: { transfer: { porcentajeUso: 10 } } }));
  const resultados = await job.verificarYNotificarCuotas();
  assert.equal(resultados[0].canalesOk.length, 1);
  assert.match(resultados[0].canalesOk[0], /Push/);
});

await checkAsync('verificarYNotificarCuotas(): si obtenerEstadoRecursos() lanza (Render/Neon caídos), no rompe el job — retorna lista vacía', async () => {
  _resetTodosLosStubs();
  resourceStub._configurarEstado(async () => { throw new Error('timeout simulado'); });
  const resultados = await job.verificarYNotificarCuotas();
  assert.deepEqual(resultados, []);
});

await checkAsync('verificarYNotificarCuotas(): con porcentaje null (API no disponible) en un servicio, no dispara nada para ese servicio pero sí evalúa el otro', async () => {
  _resetTodosLosStubs();
  resourceStub._configurarEstado(async () => ({ render: { bandwidth: { porcentajeUso: null } }, neon: { transfer: { porcentajeUso: 92 } } }));
  const resultados = await job.verificarYNotificarCuotas();
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].servicio, 'neon');
});

fs.rmSync(dirTmp, { recursive: true, force: true });

// ════════════════════════════════════════════════════════════════════════
// PARTE D — src/index.ts: los 3 endpoints de suscripción/lista/baja de
// dispositivos Push del Súper Admin (+ el disparo manual de prueba) existen
// y exigen el token de rescate — MISMO mecanismo que ya exige
// /api/admin/resource-quotas-status (Ronda 88), NO sesion.r==='admin'
// (verificación explícita del requerimiento de seguridad #4).
// ════════════════════════════════════════════════════════════════════════
const srcIndex = fs.readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8');

function _extraerBloqueRuta(src, marcador) {
  const idxInicio = src.indexOf(marcador);
  if (idxInicio === -1) return null;
  const idxDeclaracion = Math.max(src.lastIndexOf('app.get(', idxInicio), src.lastIndexOf('app.post(', idxInicio));
  const idxCierre = src.indexOf('\n});', idxInicio);
  return src.slice(idxDeclaracion, idxCierre + 4);
}

for (const [marcador, verboEsperado] of [
  ["/api/admin/push/subscribe-superadmin", 'post'],
  ["/api/admin/push/superadmin-devices", 'get'],
  ["/api/admin/push/unsubscribe-superadmin", 'post'],
  ["/api/admin/push/probar-alertas-cuotas", 'post'],
]) {
  const bloque = _extraerBloqueRuta(srcIndex, marcador);
  check(`src/index.ts: existe app.${verboEsperado}('${marcador}', ...)`, () => {
    assert.ok(bloque, 'no se encontró el endpoint');
    assert.match(bloque, new RegExp(`app\\.${verboEsperado}\\('${marcador.replace(/\//g, '\\/')}'`));
  });
  check(`${marcador}: exige _tieneRescateValido(req) (sesión de Súper Admin) — igual mecanismo que resource-quotas-status`, () => {
    assert.match(bloque, /if\s*\(\s*!_tieneRescateValido\(req\)\s*\)/);
    assert.match(bloque, /res\.status\(401\)/);
  });
  check(`${marcador}: NO se condiciona a sesion.r==='admin' ni a actorRol==='admin' (rol por-institución) — requerimiento #4`, () => {
    assert.doesNotMatch(bloque, /sesion\.r\s*===\s*'admin'/);
    assert.doesNotMatch(bloque, /actorRol\s*===\s*'admin'/);
  });
}

check('POST /api/admin/push/subscribe-superadmin: guarda la suscripción con isSuperadmin:true (nunca sin marcar)', () => {
  const bloque = _extraerBloqueRuta(srcIndex, "/api/admin/push/subscribe-superadmin");
  assert.match(bloque, /isSuperadmin:\s*true/);
});
check('POST /api/admin/push/unsubscribe-superadmin: el DELETE está restringido con isSuperadmin=true (defensa en profundidad: no puede borrar la suscripción de un docente por id)', () => {
  const bloque = _extraerBloqueRuta(srcIndex, "/api/admin/push/unsubscribe-superadmin");
  assert.match(bloque, /eq\(pushSubscriptions\.isSuperadmin,\s*true\)/);
});
check('GET /api/admin/push/superadmin-devices: filtra por isSuperadmin=true (nunca lista suscripciones de instituciones)', () => {
  const bloque = _extraerBloqueRuta(srcIndex, "/api/admin/push/superadmin-devices");
  assert.match(bloque, /eq\(pushSubscriptions\.isSuperadmin,\s*true\)/);
});
check('src/index.ts: llama a iniciarJobAlertasInfraestructura() al arrancar el servidor', () => {
  assert.match(srcIndex, /iniciarJobAlertasInfraestructura\(\);/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE E — src/db/schema.ts + src/db/index.ts: columnas/tabla nuevas
// existen con los defaults correctos (is_superadmin default false — nunca
// una suscripción nace marcada como Súper Admin por accidente).
// ════════════════════════════════════════════════════════════════════════
const srcSchema = fs.readFileSync(new URL('./src/db/schema.ts', import.meta.url), 'utf8');
const srcDbIndex = fs.readFileSync(new URL('./src/db/index.ts', import.meta.url), 'utf8');

check('schema.ts: pushSubscriptions.isSuperadmin existe con default(false)', () => {
  assert.match(srcSchema, /isSuperadmin:\s*boolean\('is_superadmin'\)\.notNull\(\)\.default\(false\)/);
});
check('schema.ts: pushSubscriptions.deviceLabel existe (nombre del dispositivo elegido por el Súper Admin)', () => {
  assert.match(srcSchema, /deviceLabel:\s*text\('device_label'\)/);
});
check('schema.ts: existe la tabla infraAlertCooldown (persistencia del cooldown de 24h, sobrevive reinicios)', () => {
  assert.match(srcSchema, /export const infraAlertCooldown = pgTable\('infra_alert_cooldown'/);
});
check('db/index.ts: initDb() agrega is_superadmin/device_label con ALTER TABLE ... IF NOT EXISTS (seguro de re-ejecutar sobre una base ya existente)', () => {
  assert.match(srcDbIndex, /ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(srcDbIndex, /ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS device_label TEXT/);
});
check('db/index.ts: initDb() crea infra_alert_cooldown con CREATE TABLE IF NOT EXISTS', () => {
  assert.match(srcDbIndex, /CREATE TABLE IF NOT EXISTS infra_alert_cooldown/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE F — src/lib/push-provider.ts: enviarPushATodosLosSuperAdmins()
// filtra por isSuperadmin=true (nunca por sk de institución), manda a
// TODOS los dispositivos con Promise.all, y aísla el fallo de un
// dispositivo (borra solo esa fila en 404/410) sin afectar a los demás —
// no se puede ejecutar de verdad sin web-push/drizzle instalados, así que
// se verifica por inspección estructural del código real.
// ════════════════════════════════════════════════════════════════════════
const srcPushProvider = fs.readFileSync(new URL('./src/lib/push-provider.ts', import.meta.url), 'utf8');
const idxFnSuper = srcPushProvider.indexOf('export async function enviarPushATodosLosSuperAdmins');
const idxFinSuper = srcPushProvider.indexOf('\n}\n', idxFnSuper);
const bloqueSuper = srcPushProvider.slice(idxFnSuper, idxFinSuper);

check('enviarPushATodosLosSuperAdmins(): filtra pushSubscriptions por isSuperadmin=true (nunca por "sk" de institución)', () => {
  assert.match(bloqueSuper, /eq\(pushSubscriptions\.isSuperadmin,\s*true\)/);
});
check('enviarPushATodosLosSuperAdmins(): envía a todos los dispositivos con Promise.all (no se detiene en el primero)', () => {
  assert.match(bloqueSuper, /Promise\.all\(subs\.map/);
});
check('enviarPushATodosLosSuperAdmins(): borra SOLO la fila cuyo envío falló con 404/410 — cada dispositivo tiene su propio try/catch dentro del map', () => {
  assert.match(bloqueSuper, /statusCode === 404 \|\| err\.statusCode === 410/);
  assert.match(bloqueSuper, /db\.delete\(pushSubscriptions\)\.where\(eq\(pushSubscriptions\.id, s\.id\)\)/);
});
check('enviarPushATodosLosSuperAdmins(): si PUSH_HABILITADO es false, no hace nada (mismo guard que el resto de push-provider.ts)', () => {
  assert.match(bloqueSuper, /if \(!PUSH_HABILITADO\) return/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE G — Frontend (03-app-core.js): sección "🔔 Notificaciones de
// Emergencia" dentro del panel del Súper Admin, botón de activación
// multidispositivo, y el token de rescate viaja hacia los 4 endpoints
// nuevos.
// ════════════════════════════════════════════════════════════════════════
const srcFront = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');

check('03-app-core.js: htmlGestorRecursosCuotas() incluye la sección "🔔 Notificaciones de Emergencia"', () => {
  assert.match(srcFront, /htmlNotificacionesEmergenciaCuotas\(\)/);
  assert.match(srcFront, /🔔 Notificaciones de Emergencia/);
});
check('03-app-core.js: existe el botón "Activar Alertas Push en este dispositivo" llamando a _activarAlertasPushSuperAdmin()', () => {
  assert.match(srcFront, /onclick="_activarAlertasPushSuperAdmin\(\)"/);
  assert.match(srcFront, /Activar Alertas Push en este dispositivo/);
});
check('_activarAlertasPushSuperAdmin(): pide una etiqueta de dispositivo (Laptop/Celular 1/etc.) antes de suscribir, y postea a /api/admin/push/subscribe-superadmin', () => {
  const idxFn = srcFront.indexOf('async function _activarAlertasPushSuperAdmin');
  const idxFin = srcFront.indexOf('\n}\n', idxFn);
  const bloque = srcFront.slice(idxFn, idxFin);
  assert.match(bloque, /customPrompt\(/);
  assert.match(bloque, /\/api\/admin\/push\/subscribe-superadmin/);
  assert.match(bloque, /label:etiqueta/);
});
check('_quitarDispositivoSuperAdmin(): pide confirmación y postea a /api/admin/push/unsubscribe-superadmin', () => {
  const idxFn = srcFront.indexOf('async function _quitarDispositivoSuperAdmin');
  const idxFin = srcFront.indexOf('\n}\n', idxFn);
  const bloque = srcFront.slice(idxFn, idxFin);
  assert.match(bloque, /customConfirm\(/);
  assert.match(bloque, /\/api\/admin\/push\/unsubscribe-superadmin/);
});
check('_envolverFetchParaRescate(): el token de rescate viaja también hacia los 4 endpoints nuevos de alertas de cuotas', () => {
  const idxEnvoltura = srcFront.indexOf('function _envolverFetchParaRescate');
  const bloque = srcFront.slice(idxEnvoltura, idxEnvoltura + 1600);
  assert.match(bloque, /\/api\/admin\/push\/subscribe-superadmin/);
  assert.match(bloque, /\/api\/admin\/push\/superadmin-devices/);
  assert.match(bloque, /\/api\/admin\/push\/unsubscribe-superadmin/);
  assert.match(bloque, /\/api\/admin\/push\/probar-alertas-cuotas/);
});
check('htmlNotificacionesEmergenciaCuotas()/_activarAlertasPushSuperAdmin(): solo se referencian desde el panel del Gestor/Súper Admin, ninguna otra ruta del sistema las invoca', () => {
  assert.equal(srcFront.split('htmlNotificacionesEmergenciaCuotas').length - 1, 2); // definición + única invocación
  assert.equal(srcFront.split('_activarAlertasPushSuperAdmin').length - 1, 2); // definición + único onclick
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail === 0) console.log('✅ 100% de la suite en verde.');
else console.log('❌ Hay pruebas fallidas — ver detalle arriba.');
process.exit(fail === 0 ? 0 : 1);
