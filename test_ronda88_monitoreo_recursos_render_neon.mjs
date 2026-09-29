// ════════════════════════════════════════════════════════════════════════
// RONDA 88 — MÓDULO DE MONITOREO DE RECURSOS Y CUOTAS (Render API & Neon API)
//
// INVESTIGACIÓN PREVIA (antes de escribir código): el pedido original
// describía este widget dentro del "Panel de Administración/Rectoría"
// (sesion.r==='admin', por-institución). Al revisar el código real se
// confirmó que Render (backend) y Neon (base de datos) son UN servicio y UN
// proyecto COMPARTIDOS por TODA la plataforma — todas las instituciones
// viven en el mismo despliegue — así que exponerlo al Rector de cada
// institución filtraría costos/infraestructura compartida entre distintos
// clientes/colegios. Se consultó esto explícitamente con el usuario
// (AskUserQuestion, 3 opciones) y eligió la recomendada: "Panel de Súper
// Administrador". Por eso el módulo cuelga del panel del Súper Admin (mismo
// mecanismo ya usado por "🖥️ Estado del Servidor" de la Ronda 49 — token de
// rescate firmado, `_tieneRescateValido`), NO de sesion.r==='admin'. Esta
// suite verifica explícitamente esa decisión (Parte C) además de la lógica
// de negocio nueva.
//
// HONESTIDAD SOBRE LAS APIs EXTERNAS: ni Render ni Neon documentan, con
// ejemplos completos y estables, la forma EXACTA del payload de sus
// endpoints de métricas — sí se confirmaron (vía su documentación pública
// vigente) los endpoints y los nombres de campo reales usados aquí
// (`/v1/metrics/bandwidth` en Render; `public_network_transfer_bytes` /
// `private_network_transfer_bytes` en Neon). El código de producción usa
// una búsqueda tolerante (`sumarCamposNumericos`) en vez de una ruta rígida
// — esta suite prueba TANTO el camino feliz (campo reconocido) COMO la
// degradación honesta cuando el proveedor cambia de forma o falla.
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
// PARTE A — src/lib/resource-quota-thresholds.ts: lógica pura, SIN
// dependencias externas (solo importa infra-thresholds.ts, también sin
// dependencias externas).
//
// NOTA TÉCNICA: resource-quota-thresholds.ts importa infra-thresholds.ts
// con la extensión ".js" (convención NodeNext de TypeScript — el compilado
// real tendría ese nombre). El runtime real del servidor usa `tsx` (ver
// package.json "start"), que resuelve ".js"→".ts" automáticamente; este
// entorno de pruebas no tiene `tsx` instalado, así que se copia el archivo
// REAL, sin tocar su lógica, a una carpeta temporal con esa única extensión
// reescrita, se importa desde ahí, y se borra al terminar — mismo criterio
// (no reinventar la lógica, solo destrabar la resolución de módulos) que ya
// usó la Ronda 84 con `_tmp_ronda84_guard.ts` para un problema análogo.
// ════════════════════════════════════════════════════════════════════════
const dirTmp = new URL('./_tmp_ronda88_libs/', import.meta.url);
fs.mkdirSync(dirTmp, { recursive: true });
function _copiarConImportsTs(nombre, reemplazos) {
  let src = fs.readFileSync(new URL(`./src/lib/${nombre}`, import.meta.url), 'utf8');
  for (const [de, aVal] of reemplazos) src = src.split(de).join(aVal);
  fs.writeFileSync(new URL(nombre, dirTmp), src);
}
_copiarConImportsTs('infra-thresholds.ts', []);
_copiarConImportsTs('resource-quota-thresholds.ts', [["from './infra-thresholds.js'", "from './infra-thresholds.ts'"]]);
_copiarConImportsTs('resource-monitor.ts', [["from './resource-quota-thresholds.js'", "from './resource-quota-thresholds.ts'"]]);

const thresholds = await import(new URL('resource-quota-thresholds.ts', dirTmp).href);

check('calcularPorcentaje(): calcula el porcentaje normal (usado/limite*100), redondeado a 1 decimal', () => {
  assert.equal(thresholds.calcularPorcentaje(50 * 1024 ** 3, 100 * 1024 ** 3), 50);
  assert.equal(thresholds.calcularPorcentaje(4.6 * 1024 ** 3, 5 * 1024 ** 3), 92);
});
check('calcularPorcentaje(): retorna null si el uso es null/undefined (dato no disponible) — nunca inventa un número', () => {
  assert.equal(thresholds.calcularPorcentaje(null, 100), null);
  assert.equal(thresholds.calcularPorcentaje(undefined, 100), null);
});
check('calcularPorcentaje(): retorna null si el límite es 0 o negativo (evita Infinity/NaN)', () => {
  assert.equal(thresholds.calcularPorcentaje(50, 0), null);
  assert.equal(thresholds.calcularPorcentaje(50, -10), null);
});
check('nivelPorPorcentaje(): 79% → ok, 80% → preventiva (ámbar), 90% → critica (rojo) — mismos umbrales que el resto del panel de Súper Admin', () => {
  assert.equal(thresholds.nivelPorPorcentaje(79), 'ok');
  assert.equal(thresholds.nivelPorPorcentaje(80), 'preventiva');
  assert.equal(thresholds.nivelPorPorcentaje(90), 'critica');
});
check('nivelPorPorcentaje(): con porcentaje null (dato no disponible) retorna "ok" — el widget lo muestra como "no disponible", no como alerta falsa', () => {
  assert.equal(thresholds.nivelPorPorcentaje(null), 'ok');
});
check('estaServicioSuspendido(): reconoce tanto el booleano true/false como el string "suspended"/"not_suspended" de la Render API', () => {
  assert.equal(thresholds.estaServicioSuspendido(true), true);
  assert.equal(thresholds.estaServicioSuspendido(false), false);
  assert.equal(thresholds.estaServicioSuspendido('suspended'), true);
  assert.equal(thresholds.estaServicioSuspendido('not_suspended'), false);
  assert.equal(thresholds.estaServicioSuspendido(undefined), false);
});
check('sumarCamposNumericos(): encuentra y suma un campo por nombre en cualquier nivel de anidamiento del JSON', () => {
  const payload = { data: [{ resource: 'srv1', totalBytes: 10 }, { resource: 'srv2', totalBytes: 20 }] };
  assert.equal(thresholds.sumarCamposNumericos(payload, /bytes/i), 30);
});
check('sumarCamposNumericos(): retorna null (no inventa 0) si el nombre de campo no aparece en ningún nivel — API cambió de forma', () => {
  const payload = { data: [{ resource: 'srv1', unidadDesconocida: 10 }] };
  assert.equal(thresholds.sumarCamposNumericos(payload, /bytes/i), null);
});
check('sumarCamposNumericos(): no revienta con referencias circulares (WeakSet de protección)', () => {
  const payload = {};
  payload.self = payload;
  payload.totalBytes = 5;
  assert.equal(thresholds.sumarCamposNumericos(payload, /bytes/i), 5);
});
check('CACHE_RECURSOS_TTL_MS: está dentro del rango de 15 a 30 minutos pedido por el usuario', () => {
  assert.ok(thresholds.CACHE_RECURSOS_TTL_MS >= 15 * 60 * 1000);
  assert.ok(thresholds.CACHE_RECURSOS_TTL_MS <= 30 * 60 * 1000);
});

// ════════════════════════════════════════════════════════════════════════
// RONDA 90 — sumarMetricasPorNombre(): búsqueda tolerante para APIs que
// exponen la métrica como PAR {nombre, valor} (forma real de Neon) en vez
// de como clave literal del objeto (lo único que sumarCamposNumericos podía
// encontrar). Ver comentario de cabecera en resource-quota-thresholds.ts.
// ════════════════════════════════════════════════════════════════════════
check('sumarMetricasPorNombre(): encuentra y suma pares {metric_name, value} anidados — forma REAL de la API de consumo de Neon', () => {
  const payload = {
    projects: [{
      project_id: 'p1',
      periods: [{
        consumption: [{
          timeframe_start: '2026-09-01T00:00:00Z',
          metrics: [
            { metric_name: 'public_network_transfer_bytes', value: 3 * 1024 ** 3 },
            { metric_name: 'private_network_transfer_bytes', value: 0 },
            { metric_name: 'compute_time_seconds', value: 999999 },
          ],
        }, {
          timeframe_start: '2026-09-02T00:00:00Z',
          metrics: [{ metric_name: 'public_network_transfer_bytes', value: 1.6 * 1024 ** 3 }],
        }],
      }],
    }],
  };
  assert.equal(thresholds.sumarMetricasPorNombre(payload, /network_transfer_bytes$/i), 4.6 * 1024 ** 3);
});
check('sumarMetricasPorNombre(): retorna null (no inventa 0) si ningún metric_name coincide — API cambió de forma', () => {
  const payload = { projects: [{ periods: [{ consumption: [{ metrics: [{ metric_name: 'otra_cosa', value: 10 }] }] }] }] };
  assert.equal(thresholds.sumarMetricasPorNombre(payload, /network_transfer_bytes$/i), null);
});
check('sumarMetricasPorNombre(): acepta los alias metricName/name y usageValue/amount, no solo metric_name/value', () => {
  const payload = { data: [{ metricName: 'public_network_transfer_bytes', usageValue: 5 }, { name: 'public_network_transfer_bytes', amount: 2 }] };
  assert.equal(thresholds.sumarMetricasPorNombre(payload, /network_transfer_bytes$/i), 7);
});
check('sumarMetricasPorNombre(): no revienta con referencias circulares (WeakSet de protección)', () => {
  const payload = { metric_name: 'network_transfer_bytes', value: 5 };
  payload.self = payload;
  assert.equal(thresholds.sumarMetricasPorNombre(payload, /network_transfer_bytes$/i), 5);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE B — src/lib/resource-monitor.ts: hace I/O (fetch a Render/Neon,
// process.env) pero NO depende de drizzle/pg/express (no toca la base de
// datos), así que se puede importar directamente y probar con `fetch`
// mockeado — solo hace falta reescribir sus imports relativos ".js" a
// ".ts" en una copia temporal, porque este entorno de pruebas no tiene
// `tsx` instalado (el runtime real del servidor sí lo usa — ver
// package.json "start" — y tsx sí resuelve esos imports ".js" hacia sus
// fuentes ".ts" automáticamente). La copia es BYTE-A-BYTE la lógica real,
// solo cambia la extensión del import.
// ════════════════════════════════════════════════════════════════════════
async function _importarResourceMonitor(env) {
  const previos = { RENDER_API_KEY: process.env.RENDER_API_KEY, RENDER_WORKSPACE_ID: process.env.RENDER_WORKSPACE_ID, NEON_API_KEY: process.env.NEON_API_KEY, NEON_PROJECT_ID: process.env.NEON_PROJECT_ID, NEON_ORG_ID: process.env.NEON_ORG_ID, RENDER_BANDWIDTH_LIMITE_GB: process.env.RENDER_BANDWIDTH_LIMITE_GB, NEON_TRANSFER_LIMITE_GB: process.env.NEON_TRANSFER_LIMITE_GB };
  delete process.env.NEON_ORG_ID; // no heredar entre pruebas: cada una declara explícitamente si la necesita
  Object.assign(process.env, env);
  try {
    // "?t=" fuerza una nueva instancia del módulo en cada llamada (variables
    // de entorno leídas al importar, y caché en memoria propia del módulo)
    // — igual truco que usan otras rondas para reimportar un módulo con
    // config distinta dentro del mismo proceso de pruebas.
    return await import(new URL('resource-monitor.ts', dirTmp).href + '?t=' + Date.now() + Math.random());
  } finally {
    Object.assign(process.env, previos);
  }
}

await checkAsync('RENDER_CONFIGURADO/NEON_CONFIGURADO: false si faltan las variables de entorno — nunca hardcodeadas', async () => {
  const original = { RENDER_API_KEY: process.env.RENDER_API_KEY, RENDER_WORKSPACE_ID: process.env.RENDER_WORKSPACE_ID, NEON_API_KEY: process.env.NEON_API_KEY, NEON_PROJECT_ID: process.env.NEON_PROJECT_ID };
  delete process.env.RENDER_API_KEY; delete process.env.RENDER_WORKSPACE_ID; delete process.env.NEON_API_KEY; delete process.env.NEON_PROJECT_ID;
  const m = await _importarResourceMonitor({});
  assert.equal(m.RENDER_CONFIGURADO, false);
  assert.equal(m.NEON_CONFIGURADO, false);
  Object.assign(process.env, original);
});

await checkAsync('obtenerEstadoRecursos(): sin configurar Render/Neon, no llama a fetch y responde "no disponible" sin lanzar', async () => {
  delete process.env.RENDER_API_KEY; delete process.env.RENDER_WORKSPACE_ID; delete process.env.NEON_API_KEY; delete process.env.NEON_PROJECT_ID;
  const fetchOriginal = global.fetch;
  let llamadas = 0;
  global.fetch = async () => { llamadas++; throw new Error('no debería llamarse'); };
  try {
    const m = await _importarResourceMonitor({});
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(llamadas, 0);
    assert.equal(estado.render.configurado, false);
    assert.equal(estado.render.bandwidth.disponible, false);
    assert.equal(estado.neon.configurado, false);
    assert.equal(estado.neon.transfer.disponible, false);
  } finally { global.fetch = fetchOriginal; }
});

await checkAsync('obtenerEstadoRecursos(): con Render/Neon configurados y respuestas reconocibles, calcula porcentaje/nivel y detecta servicio suspendido', async () => {
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [{ service: { id: 'srv1', name: 'gestor-backend', suspended: 'suspended' } }] };
    // RONDA 90: mocks corregidos a la forma REAL confirmada por investigación
    // — Render nombra el número "value" dentro de una serie temporal (no
    // "totalBytes"/"bandwidth"), y Neon lo entrega como par
    // {metric_name, value} dentro de metrics[], no como clave literal.
    if (String(url).includes('/metrics/bandwidth')) return { ok: true, status: 200, json: async () => ([{ resource: 'srv1', unit: 'bytes', values: [{ time: '2026-09-01T00:00:00Z', value: 90 * 1024 ** 3 }] }]) };
    if (String(url).includes('/consumption_history/projects')) return { ok: true, status: 200, json: async () => ({ projects: [{ project_id: 'p1', periods: [{ consumption: [{ metrics: [{ metric_name: 'public_network_transfer_bytes', value: 4.6 * 1024 ** 3 }, { metric_name: 'private_network_transfer_bytes', value: 0 }] }] }] }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ RENDER_API_KEY: 'rk', RENDER_WORKSPACE_ID: 'wk', NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk' });
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(estado.render.bandwidth.porcentajeUso, 90);
    assert.equal(estado.render.bandwidth.nivel, 'critica');
    assert.equal(estado.render.algunoSuspendido, true);
    assert.equal(estado.render.servicios[0].estado, 'Suspended');
    assert.equal(estado.neon.transfer.porcentajeUso, 92);
    assert.equal(estado.neon.transfer.nivel, 'critica');
  } finally { global.fetch = fetchOriginal; }
});

await checkAsync('obtenerEstadoRecursos(): sigue funcionando con la forma ANTIGUA de mock (clave literal totalBytes/public_network_transfer_bytes) gracias al respaldo con sumarCamposNumericos', async () => {
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [{ service: { id: 'srv1', name: 'gestor-backend', suspended: false } }] };
    if (String(url).includes('/metrics/bandwidth')) return { ok: true, status: 200, json: async () => ({ data: [{ resource: 'srv1', totalBytes: 50 * 1024 ** 3 }] }) };
    if (String(url).includes('/consumption_history/projects')) return { ok: true, status: 200, json: async () => ({ projects: [{ project_id: 'p1', periods: [{ consumption: [{ public_network_transfer_bytes: 2.5 * 1024 ** 3 }] }] }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ RENDER_API_KEY: 'rk', RENDER_WORKSPACE_ID: 'wk', NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk' });
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(estado.render.bandwidth.usadoBytes, 50 * 1024 ** 3);
    assert.equal(estado.render.bandwidth.disponible, true);
    assert.equal(estado.neon.transfer.usadoBytes, 2.5 * 1024 ** 3);
    assert.equal(estado.neon.transfer.disponible, true);
  } finally { global.fetch = fetchOriginal; }
});

// ════════════════════════════════════════════════════════════════════════
// RONDA 91 — corrección del HTTP 400 reportado en producción para Neon: el
// endpoint vigente con métricas de red explícitas es
// `/consumption_history/v2/projects` y EXIGE `org_id` + `metrics`; sin
// NEON_ORG_ID configurada, el módulo cae al endpoint legacy (que sí
// funcionaba antes para cuentas con ese acceso, pero no acepta `metrics`).
// ════════════════════════════════════════════════════════════════════════
await checkAsync('obtenerEstadoRecursos(): con NEON_ORG_ID configurada, consulta el endpoint VIGENTE /consumption_history/v2/projects con org_id y metrics', async () => {
  const fetchOriginal = global.fetch;
  const urlsLlamadas = [];
  global.fetch = async (url) => {
    urlsLlamadas.push(String(url));
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [] };
    if (String(url).includes('/consumption_history/v2/projects')) {
      return { ok: true, status: 200, json: async () => ({ projects: [{ project_id: 'p1', periods: [{ consumption: [{ metrics: [{ metric_name: 'public_network_transfer_bytes', value: 3 * 1024 ** 3 }] }] }] }] }) };
    }
    // Si llegara a llamar al endpoint legacy en vez del vigente, esta rama
    // respondería con un valor DISTINTO para que la prueba lo detecte.
    if (String(url).includes('/consumption_history/projects')) return { ok: true, status: 200, json: async () => ({ projects: [{ periods: [{ consumption: [{ metrics: [{ metric_name: 'public_network_transfer_bytes', value: 999 * 1024 ** 3 }] }] }] }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk', NEON_ORG_ID: 'org-test-123' });
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(estado.neon.transfer.usadoBytes, 3 * 1024 ** 3);
    const urlV2 = urlsLlamadas.find((u) => u.includes('/consumption_history/v2/projects'));
    assert.ok(urlV2, 'debe haber llamado al endpoint vigente v2');
    assert.ok(urlV2.includes('org_id=org-test-123'));
    assert.ok(urlV2.includes('metrics=public_network_transfer_bytes'));
    assert.ok(urlV2.includes('metrics=private_network_transfer_bytes'));
  } finally { global.fetch = fetchOriginal; }
});

await checkAsync('obtenerEstadoRecursos(): sin NEON_ORG_ID, no llama al endpoint v2 y usa directamente el legacy (compatibilidad hacia atrás)', async () => {
  const fetchOriginal = global.fetch;
  const urlsLlamadas = [];
  global.fetch = async (url) => {
    urlsLlamadas.push(String(url));
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [] };
    if (String(url).includes('/consumption_history/projects')) return { ok: true, status: 200, json: async () => ({ projects: [{ periods: [{ consumption: [{ metrics: [{ metric_name: 'public_network_transfer_bytes', value: 1 * 1024 ** 3 }] }] }] }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk' });
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(estado.neon.transfer.usadoBytes, 1 * 1024 ** 3);
    assert.ok(!urlsLlamadas.some((u) => u.includes('/consumption_history/v2/projects')));
  } finally { global.fetch = fetchOriginal; }
});

await checkAsync('obtenerEstadoRecursos(): HTTP 400 sin NEON_ORG_ID configurada produce un error que señala explícitamente esa causa', async () => {
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [] };
    if (String(url).includes('/consumption_history/projects')) return { ok: false, status: 400, json: async () => ({ message: 'Missing required parameter: org_id' }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk' });
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(estado.neon.transfer.disponible, false);
    assert.match(estado.neon.transfer.error, /NEON_ORG_ID/);
  } finally { global.fetch = fetchOriginal; }
});

await checkAsync('obtenerEstadoRecursos(): HTTP 403 de Neon (y el respaldo /projects/{id} también fallando) se traduce a un mensaje honesto y amigable sobre restricción de plan — RONDA 92: ya no expone el código HTTP crudo', async () => {
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [] };
    // RONDA 93: /projects/{id} es ahora el PRIMER intento — se mockea con
    // el mismo 403 para simular una cuenta donde ni siquiera ese endpoint
    // básico está disponible (caso límite; en la práctica casi siempre
    // responde 200 — ver la prueba dedicada del respaldo más abajo).
    if (String(url).includes('/consumption_history/v2/projects')) return { ok: false, status: 403, json: async () => ({ message: 'This endpoint is not available for your plan.' }) };
    if (String(url).includes('/consumption_history/projects')) return { ok: false, status: 403, json: async () => ({ message: 'This endpoint is not available for your plan.' }) };
    if (String(url).includes('/projects/pk')) return { ok: false, status: 403, json: async () => ({ message: 'This endpoint is not available for your plan.' }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk', NEON_ORG_ID: 'org-test-123' });
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(estado.neon.transfer.disponible, false);
    assert.match(estado.neon.transfer.error, /plan/i);
    assert.match(estado.neon.transfer.error, /console\.neon\.tech/);
    assert.doesNotMatch(estado.neon.transfer.error, /^HTTP 403/);
  } finally { global.fetch = fetchOriginal; }
});

await checkAsync('obtenerEstadoRecursos(): si el endpoint v2 falla, cae al legacy como respaldo y puede recuperar el dato igual', async () => {
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [] };
    if (String(url).includes('/consumption_history/v2/projects')) return { ok: false, status: 404, json: async () => ({ message: 'org not found' }) };
    if (String(url).includes('/consumption_history/projects')) return { ok: true, status: 200, json: async () => ({ projects: [{ periods: [{ consumption: [{ metrics: [{ metric_name: 'public_network_transfer_bytes', value: 2 * 1024 ** 3 }] }] }] }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk', NEON_ORG_ID: 'org-equivocada' });
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(estado.neon.transfer.disponible, true);
    assert.equal(estado.neon.transfer.usadoBytes, 2 * 1024 ** 3);
  } finally { global.fetch = fetchOriginal; }
});

// ════════════════════════════════════════════════════════════════════════
// RONDA 93 — CORRECCIÓN DEL BUG REPORTADO EN PRODUCCIÓN: con la v23, el
// panel mostraba "0 B usados de 5 GB" (sin error) mientras el dashboard de
// Neon mostraba 3.14 GB reales. Causa raíz: el endpoint legacy de
// consumption_history respondía 200 OK (no un error) pero con una
// estructura vacía/en ceros para esta cuenta Free — un `0` numérico
// VÁLIDO, así que el código de la Ronda 92 lo daba por bueno y nunca
// llegaba a intentar GET /projects/{id} (que sí tenía el dato real). Ahora
// /projects/{id} es el PRIMER intento — estas pruebas reproducen
// exactamente ese escenario.
// ════════════════════════════════════════════════════════════════════════
await checkAsync('obtenerEstadoRecursos(): usa el dato REAL de GET /projects/{id} en vez del "0" que devolvía consumption_history para una cuenta Free (bug reportado en producción con la v23)', async () => {
  const fetchOriginal = global.fetch;
  const urlsLlamadas = [];
  global.fetch = async (url) => {
    urlsLlamadas.push(String(url));
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [] };
    // El endpoint legacy responde 200 OK, sin error — pero con una
    // estructura vacía/en ceros para esta cuenta Free (exactamente lo que
    // se vio en producción: la ausencia de error no significaba que el
    // dato fuera correcto).
    if (String(url).includes('/consumption_history/projects')) return { ok: true, status: 200, json: async () => ({ projects: [{ periods: [{ consumption: [{ metrics: [{ metric_name: 'public_network_transfer_bytes', value: 0 }, { metric_name: 'private_network_transfer_bytes', value: 0 }] }] }] }] }) };
    // GET /projects/{id} sí tiene el dato real (3.14 GB, como reportó el usuario).
    if (String(url).includes('/projects/pk')) return { ok: true, status: 200, json: async () => ({ project: { id: 'pk', data_transfer_bytes: Math.round(3.14 * 1024 ** 3), consumption_period_start: '2026-09-01T00:00:00Z' } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk' });
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(estado.neon.transfer.usadoBytes, Math.round(3.14 * 1024 ** 3));
    assert.equal(estado.neon.transfer.disponible, true);
    // Confirma el nuevo orden de prioridad: /projects/{id} se llama PRIMERO
    // y, como ya trae un dato utilizable, /consumption_history/projects NI
    // SIQUIERA se llega a invocar (a diferencia del bug de la v23, donde
    // ese endpoint legacy se consultaba primero y su "0" ganaba).
    const idxProyecto = urlsLlamadas.findIndex((u) => u.includes('/projects/pk'));
    assert.ok(idxProyecto !== -1, 'debe haber llamado a /projects/{id}');
    assert.ok(!urlsLlamadas.some((u) => u.includes('/consumption_history/projects')), '/consumption_history/projects NO debe llamarse si /projects/{id} ya dio un dato utilizable');
  } finally { global.fetch = fetchOriginal; }
});
await checkAsync('obtenerEstadoRecursos(): imprime en consola el objeto completo de GET /projects/{id} (pedido explícito del usuario para diagnóstico)', async () => {
  const fetchOriginal = global.fetch;
  const consoleLogOriginal = console.log;
  const logs = [];
  console.log = (...args) => { logs.push(args.join(' ')); };
  global.fetch = async (url) => {
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [] };
    if (String(url).includes('/projects/pk')) return { ok: true, status: 200, json: async () => ({ project: { id: 'pk', data_transfer_bytes: 12345 } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk' });
    await m.obtenerEstadoRecursos(true);
    assert.ok(logs.some((l) => l.includes('/projects/{id}') && l.includes('12345')), 'debe loguear el cuerpo completo de la respuesta de /projects/{id}');
  } finally { global.fetch = fetchOriginal; console.log = consoleLogOriginal; }
});

// ════════════════════════════════════════════════════════════════════════
// RONDA 92 — respaldo final para cuentas de Neon en plan Free: ni el
// endpoint vigente (v2) ni el legacy de consumption_history están
// disponibles en ese plan (ambos exigen Launch/Scale/Agent/Business/
// Enterprise) — antes de rendirse, se intenta GET /projects/{project_id},
// que SÍ está disponible en cualquier plan y expone `data_transfer_bytes`.
// Si ni siquiera eso funciona, se muestra un mensaje honesto y amigable en
// vez de un código HTTP crudo.
// ════════════════════════════════════════════════════════════════════════
await checkAsync('obtenerEstadoRecursos(): si consumption_history falla por restricción de plan, recupera el dato con GET /projects/{id} (data_transfer_bytes) — funciona en plan Free', async () => {
  const fetchOriginal = global.fetch;
  const urlsLlamadas = [];
  global.fetch = async (url) => {
    urlsLlamadas.push(String(url));
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [] };
    if (String(url).includes('/consumption_history/projects')) return { ok: false, status: 403, json: async () => ({ message: 'This endpoint is not available for your plan.' }) };
    if (String(url).includes('/projects/pk')) return { ok: true, status: 200, json: async () => ({ project: { id: 'pk', data_transfer_bytes: 1.2 * 1024 ** 3, consumption_period_start: '2026-09-01T00:00:00Z' } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk' });
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(estado.neon.transfer.disponible, true);
    assert.equal(estado.neon.transfer.usadoBytes, 1.2 * 1024 ** 3);
    assert.equal(estado.neon.transfer.error, null);
    assert.ok(urlsLlamadas.some((u) => u.includes('/projects/pk')), 'debe haber intentado GET /projects/{id} como respaldo');
  } finally { global.fetch = fetchOriginal; }
});

await checkAsync('obtenerEstadoRecursos(): si TODOS los intentos fallan por restricción de plan, el mensaje es honesto/amigable en vez de un HTTP crudo', async () => {
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [] };
    if (String(url).includes('/consumption_history/projects')) return { ok: false, status: 403, json: async () => ({ message: 'This endpoint is not available for your plan.' }) };
    if (String(url).includes('/projects/pk')) return { ok: false, status: 403, json: async () => ({ message: 'Plan restriction' }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk' });
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(estado.neon.transfer.disponible, false);
    assert.doesNotMatch(estado.neon.transfer.error, /^HTTP 403/);
    assert.match(estado.neon.transfer.error, /plan Free|plan actual/i);
    assert.match(estado.neon.transfer.error, /console\.neon\.tech/);
  } finally { global.fetch = fetchOriginal; }
});

await checkAsync('obtenerEstadoRecursos(): si la API responde con un esquema no reconocido, se degrada a "no disponible" con un error legible, sin lanzar', async () => {
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [{ service: { id: 'srv1', name: 'web', suspended: false } }] };
    if (String(url).includes('/metrics/bandwidth')) return { ok: true, status: 200, json: async () => ({ campoQueRenderYaNoUsa: 123 }) };
    if (String(url).includes('/consumption_history/projects')) return { ok: true, status: 200, json: async () => ({ otroFormato: true }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ RENDER_API_KEY: 'rk', RENDER_WORKSPACE_ID: 'wk', NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk' });
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(estado.render.bandwidth.disponible, false);
    assert.ok(estado.render.bandwidth.error);
    assert.equal(estado.neon.transfer.disponible, false);
    assert.ok(estado.neon.transfer.error);
  } finally { global.fetch = fetchOriginal; }
});

await checkAsync('obtenerEstadoRecursos(): si la API de Render/Neon devuelve un error HTTP o el fetch lanza, se degrada sin romper el endpoint', async () => {
  const fetchOriginal = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/services')) return { ok: false, status: 500, json: async () => ({}) };
    if (String(url).includes('/consumption_history/projects')) throw new Error('ECONNRESET simulado');
    return { ok: false, status: 500, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ RENDER_API_KEY: 'rk', RENDER_WORKSPACE_ID: 'wk', NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk' });
    const estado = await m.obtenerEstadoRecursos(true);
    assert.equal(estado.render.bandwidth.disponible, false);
    assert.ok(estado.render.erroresApi);
    assert.equal(estado.neon.transfer.disponible, false);
    assert.ok(estado.neon.transfer.error);
  } finally { global.fetch = fetchOriginal; }
});

await checkAsync('obtenerEstadoRecursos(): reutiliza la caché (no vuelve a llamar a fetch) salvo que se pida forzar=true', async () => {
  const fetchOriginal = global.fetch;
  let llamadas = 0;
  global.fetch = async (url) => {
    llamadas++;
    if (String(url).includes('/services')) return { ok: true, status: 200, json: async () => [] };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    const m = await _importarResourceMonitor({ RENDER_API_KEY: 'rk', RENDER_WORKSPACE_ID: 'wk', NEON_API_KEY: 'nk', NEON_PROJECT_ID: 'pk' });
    await m.obtenerEstadoRecursos(true);
    const llamadasTrasLaPrimera = llamadas;
    await m.obtenerEstadoRecursos(false); // debe usar caché
    assert.equal(llamadas, llamadasTrasLaPrimera);
    await m.obtenerEstadoRecursos(true); // forzar=true debe saltarse la caché
    assert.ok(llamadas > llamadasTrasLaPrimera);
  } finally { global.fetch = fetchOriginal; }
});

await checkAsync('invalidarCacheRecursos(): limpia la caché aunque no haya pasado el TTL', async () => {
  const fetchOriginal = global.fetch;
  let llamadas = 0;
  global.fetch = async () => { llamadas++; return { ok: true, status: 200, json: async () => [] }; };
  try {
    const m = await _importarResourceMonitor({ RENDER_API_KEY: 'rk', RENDER_WORKSPACE_ID: 'wk' });
    await m.obtenerEstadoRecursos(true);
    const trasLaPrimera = llamadas;
    m.invalidarCacheRecursos();
    await m.obtenerEstadoRecursos(false);
    assert.ok(llamadas > trasLaPrimera);
  } finally { global.fetch = fetchOriginal; }
});

fs.rmSync(dirTmp, { recursive: true, force: true });

// ════════════════════════════════════════════════════════════════════════
// PARTE C — src/index.ts: el nuevo endpoint GET /api/admin/resource-quotas-status
// existe, está protegido por el MISMO mecanismo de Súper Admin que
// /api/admin/infrastructure-status (_tieneRescateValido), soporta
// ?forzar=1, y — verificación explícita de la decisión de alcance tomada
// con el usuario — NO depende de sesion.r==='admin' (rol por-institución).
// ════════════════════════════════════════════════════════════════════════
const srcIndex = fs.readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8');

function _extraerBloqueRuta(src, marcador) {
  const idxInicio = src.indexOf(marcador);
  if (idxInicio === -1) return null;
  // Recorta desde el "app.get(" que contiene el marcador hasta el "});" que cierra el handler.
  const idxAppGet = src.lastIndexOf('app.get(', idxInicio);
  const idxCierre = src.indexOf('\n});', idxInicio);
  return src.slice(idxAppGet, idxCierre + 4);
}
const bloqueEndpoint = _extraerBloqueRuta(srcIndex, "/api/admin/resource-quotas-status");

check('src/index.ts: existe GET /api/admin/resource-quotas-status', () => {
  assert.ok(bloqueEndpoint);
  assert.match(bloqueEndpoint, /app\.get\('\/api\/admin\/resource-quotas-status'/);
});
check('GET /api/admin/resource-quotas-status: exige _tieneRescateValido(req) (sesión de Súper Admin) antes de responder', () => {
  assert.match(bloqueEndpoint, /if\s*\(\s*!_tieneRescateValido\(req\)\s*\)/);
  assert.match(bloqueEndpoint, /res\.status\(401\)/);
});
check('GET /api/admin/resource-quotas-status: soporta ?forzar=1 para saltar la caché (botón "Recargar" del panel)', () => {
  assert.match(bloqueEndpoint, /forzar/);
  assert.match(bloqueEndpoint, /obtenerEstadoRecursos\(forzar\)/);
});
check('GET /api/admin/resource-quotas-status: NO se condiciona a sesion.r===\'admin\' (rol por-institución) — decisión explícita de alcance: solo Súper Admin', () => {
  assert.doesNotMatch(bloqueEndpoint, /sesion\.r\s*===\s*'admin'/);
  assert.doesNotMatch(bloqueEndpoint, /actorRol\s*===\s*'admin'/);
});
check('src/index.ts: importa obtenerEstadoRecursos desde src/lib/resource-monitor.js', () => {
  assert.match(srcIndex, /import\s*\{\s*obtenerEstadoRecursos\s*\}\s*from\s*'\.\/lib\/resource-monitor\.js'/);
});

// ════════════════════════════════════════════════════════════════════════
// PARTE D — Frontend (03-app-core.js): el widget "📡 Recursos y Cuotas"
// cuelga del panel del Súper Admin (mismo _gestorPag que ya usa
// "🖥️ Estado del Servidor"), el token de rescate viaja automáticamente
// hacia la nueva URL, y el botón "Recargar" fuerza el refresco.
// ════════════════════════════════════════════════════════════════════════
const srcFront = fs.readFileSync(new URL('./gestor-academico/dist/modules/03-app-core.js', import.meta.url), 'utf8');

check('03-app-core.js: existe la pestaña "📡 Recursos y Cuotas" dentro del panel del Súper Admin (_gestorPag)', () => {
  assert.match(srcFront, /_gestorPag='recursoscuotas'/);
  assert.match(srcFront, /else if\(_gestorPag==='recursoscuotas'\) contenido=htmlGestorRecursosCuotas\(\)/);
});
check('03-app-core.js: al entrar a la pestaña se dispara _refrescarRecursosCuotas() automáticamente (igual patrón que Infraestructura)', () => {
  // Regex tolerante a que la Ronda 89 haya agregado una segunda llamada
  // (setTimeout(_refrescarDispositivosSuperAdmin,150)) dentro del mismo
  // bloque "if" — lo único que esta prueba de la Ronda 88 debe garantizar
  // es que _refrescarRecursosCuotas() se siga disparando al entrar.
  assert.match(srcFront, /if\(_gestorPag==='recursoscuotas'\)\{[^}]*setTimeout\(_refrescarRecursosCuotas,150\)/);
});
check('03-app-core.js: _envolverFetchParaRescate() agrega el token de rescate también a /api/admin/resource-quotas-status', () => {
  const idxEnvoltura = srcFront.indexOf('function _envolverFetchParaRescate');
  const bloque = srcFront.slice(idxEnvoltura, idxEnvoltura + 1200);
  assert.match(bloque, /\/api\/admin\/resource-quotas-status/);
});
check('htmlGestorRecursosCuotas()/_refrescarRecursosCuotas(): usan _htmlBarraKpi (misma barra de progreso ya usada por Infraestructura) para Render y Neon', () => {
  const idxFn = srcFront.indexOf('async function _refrescarRecursosCuotas');
  const idxFin = srcFront.indexOf('\n}\n', idxFn);
  const bloque = srcFront.slice(idxFn, idxFin);
  assert.match(bloque, /_htmlBarraKpi\('☁️ Render/);
  assert.match(bloque, /_htmlBarraKpi\('🐘 Neon/);
});
check('_refrescarRecursosCuotas(): el botón "Recargar" pide ?forzar=1 (salta la caché), la carga automática de la pestaña no', () => {
  const idxFn = srcFront.indexOf('async function _refrescarRecursosCuotas');
  const idxFin = srcFront.indexOf('\n}\n', idxFn);
  const bloque = srcFront.slice(idxFn, idxFin);
  assert.match(bloque, /forzar\?'\?forzar=1':''/);
  // La carga automática al entrar a la pestaña llama sin argumento (ver setTimeout(_refrescarRecursosCuotas,150) arriba), así que "forzar" es undefined→falsy.
});
check('_refrescarRecursosCuotas(): muestra 401 como "requiere sesión válida de Súper Admin" (igual mensaje que Infraestructura, no un genérico)', () => {
  const idxFn = srcFront.indexOf('async function _refrescarRecursosCuotas');
  const idxFin = srcFront.indexOf('\n}\n', idxFn);
  const bloque = srcFront.slice(idxFn, idxFin);
  assert.match(bloque, /sesión válida de Súper Admin/);
});
check('htmlGestorRecursosCuotas(): NO aparece en ninguna ruta del panel del docente/admin de institución — solo se referencia desde el dispatcher del Gestor (_gestorPag)', () => {
  // Todas las apariciones de la función deben estar dentro del bloque de
  // funciones del Gestor (mismo archivo, pero solo se invoca desde el
  // dispatcher renderGestorAdmin() ya probado arriba) — se confirma que no
  // hay una segunda ruta de acceso (por ejemplo, algo como "sesion.r==='admin'&&htmlGestorRecursosCuotas").
  const ocurrencias = srcFront.split('htmlGestorRecursosCuotas').length - 1;
  assert.equal(ocurrencias, 2); // la definición de la función + su única invocación en el dispatcher
});

// ════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail === 0) console.log('✅ 100% de la suite en verde.');
else console.log('❌ Hay pruebas fallidas — ver detalle arriba.');
process.exit(fail === 0 ? 0 : 1);
