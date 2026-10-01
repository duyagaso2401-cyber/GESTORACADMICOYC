// ════════════════════════════════════════════════════════════════════════
// RONDA 101 — Pruebas de la lista blanca de orígenes CORS
// (src/lib/cors-allowlist.ts). Funciones puras, sin Express ni red — se
// prueban directamente con `npx tsx`.
//
// Cómo correr esta prueba:  npx tsx test_ronda101_cors_allowlist.ts
// ════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { construirOrigenesPermitidos, esOrigenPermitido } from './src/lib/cors-allowlist.ts';

let pass = 0, fail = 0;
function check(desc: string, fn: () => void) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e: any) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

check('construirOrigenesPermitidos(undefined/null/"") devuelve una lista vacía', () => {
  assert.deepEqual(construirOrigenesPermitidos(undefined), []);
  assert.deepEqual(construirOrigenesPermitidos(null), []);
  assert.deepEqual(construirOrigenesPermitidos(''), []);
});
check('construirOrigenesPermitidos() separa por coma y recorta espacios', () => {
  assert.deepEqual(
    construirOrigenesPermitidos('https://a.com, https://b.com , https://c.com'),
    ['https://a.com', 'https://b.com', 'https://c.com']
  );
});
check('construirOrigenesPermitidos() descarta entradas vacías (comas de más, ej. al final)', () => {
  assert.deepEqual(construirOrigenesPermitidos('https://a.com,,https://b.com,'), ['https://a.com', 'https://b.com']);
});
check('REGRESIÓN DE SEGURIDAD — esOrigenPermitido() con ALLOWED_ORIGINS vacía (sin configurar) permite CUALQUIER origen, igual que el origin:"*" anterior (comportamiento de transición, no rompe despliegues existentes)', () => {
  assert.equal(esOrigenPermitido('https://cualquier-sitio-del-mundo.com', []), true);
  assert.equal(esOrigenPermitido(undefined, []), true);
});
check('CON lista configurada, un origen que SÍ está en ALLOWED_ORIGINS se permite', () => {
  const permitidos = ['https://miapp.onrender.com', 'https://miapp.com'];
  assert.equal(esOrigenPermitido('https://miapp.onrender.com', permitidos), true);
  assert.equal(esOrigenPermitido('https://miapp.com', permitidos), true);
});
check('CORRECCIÓN DE RAÍZ — con lista configurada, un origen que NO está en la lista se RECHAZA (antes, origin:"*" lo hubiera aceptado sin más)', () => {
  const permitidos = ['https://miapp.onrender.com'];
  assert.equal(esOrigenPermitido('https://sitio-malicioso.com', permitidos), false);
  assert.equal(esOrigenPermitido('http://miapp.onrender.com', permitidos), false, 'http (sin "s") es un origen DISTINTO a https — no debe colarse por coincidencia parcial');
});
check('Una petición SIN cabecera Origin (apps nativas, curl, Postman, llamadas same-origin del propio servidor) siempre se permite, incluso con la lista configurada', () => {
  const permitidos = ['https://miapp.onrender.com'];
  assert.equal(esOrigenPermitido(undefined, permitidos), true);
  assert.equal(esOrigenPermitido(null as any, permitidos), true);
  assert.equal(esOrigenPermitido('', permitidos), true);
});
check('No hay coincidencia parcial/por subcadena — un origen que solo CONTIENE un origen permitido como subcadena no debe colarse', () => {
  const permitidos = ['https://miapp.com'];
  assert.equal(esOrigenPermitido('https://miapp.com.sitio-malicioso.com', permitidos), false);
  assert.equal(esOrigenPermitido('https://no-es-miapp.com', permitidos), false);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
