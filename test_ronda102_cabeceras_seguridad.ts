// ════════════════════════════════════════════════════════════════════════
// RONDA 102 — Pruebas de las cabeceras de seguridad HTTP
// (src/lib/security-headers.ts). Funciones puras, sin Express ni red — se
// prueban directamente con `npx tsx`.
//
// Cómo correr esta prueba:  npx tsx test_ronda102_cabeceras_seguridad.ts
// ════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { construirCabecerasSeguridad, construirPoliticaCSP } from './src/lib/security-headers.ts';

let pass = 0, fail = 0;
function check(desc: string, fn: () => void) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e: any) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

check('X-Content-Type-Options siempre es "nosniff"', () => {
  const h = construirCabecerasSeguridad();
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
});

check('X-Frame-Options siempre es "DENY" (nadie puede embeber el sitio en un iframe ajeno)', () => {
  const h = construirCabecerasSeguridad();
  assert.equal(h['X-Frame-Options'], 'DENY');
});

check('Referrer-Policy restringe la fuga de URLs completas hacia otros orígenes', () => {
  const h = construirCabecerasSeguridad();
  assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
});

check('Permissions-Policy bloquea geolocalización y micrófono, pero deja la cámara disponible para el propio sitio (se usa para escanear QR y tomar fotos)', () => {
  const h = construirCabecerasSeguridad();
  assert.match(h['Permissions-Policy'], /geolocation=\(\)/);
  assert.match(h['Permissions-Policy'], /microphone=\(\)/);
  assert.match(h['Permissions-Policy'], /camera=\(self\)/);
});

check('Strict-Transport-Security (HSTS) tiene max-age largo e includeSubDomains', () => {
  const h = construirCabecerasSeguridad();
  assert.match(h['Strict-Transport-Security'], /max-age=\d{6,}/);
  assert.match(h['Strict-Transport-Security'], /includeSubDomains/);
});

check('SEGURO POR DEFECTO — sin cspEnforce (o con false), la política viaja como Content-Security-Policy-Report-Only, NO como la cabecera que bloquea', () => {
  const h1 = construirCabecerasSeguridad();
  const h2 = construirCabecerasSeguridad({ cspEnforce: false });
  assert.ok(h1['Content-Security-Policy-Report-Only'], 'debe existir la cabecera Report-Only');
  assert.ok(!('Content-Security-Policy' in h1), 'NO debe existir la cabecera que bloquea de verdad');
  assert.ok(h2['Content-Security-Policy-Report-Only']);
  assert.ok(!('Content-Security-Policy' in h2));
});

check('CON cspEnforce:true, la política viaja como Content-Security-Policy (la que sí bloquea), y deja de mandarse en modo Report-Only', () => {
  const h = construirCabecerasSeguridad({ cspEnforce: true });
  assert.ok(h['Content-Security-Policy'], 'debe existir la cabecera que bloquea');
  assert.ok(!('Content-Security-Policy-Report-Only' in h), 'no debe mandarse también en modo Report-Only');
});

check('La política CSP permite los CDNs reales que carga el frontend (jsPDF/Chart.js/SheetJS/Sentry/unpkg)', () => {
  const pol = construirPoliticaCSP();
  for (const host of ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://browser.sentry-cdn.com', 'https://cdn.sheetjs.com', 'https://unpkg.com']) {
    assert.ok(pol.includes(host), `falta permitir ${host} en script-src`);
  }
});

check('La política CSP permite las imágenes reales del sistema (Cloudinary, generador de QR, Unsplash)', () => {
  const pol = construirPoliticaCSP();
  for (const host of ['https://res.cloudinary.com', 'https://api.qrserver.com', 'https://images.unsplash.com']) {
    assert.ok(pol.includes(host), `falta permitir ${host} en img-src`);
  }
});

check('La política CSP bloquea objetos/plugins (object-src none) y fija base-uri y frame-ancestors a self/none', () => {
  const pol = construirPoliticaCSP();
  assert.match(pol, /object-src 'none'/);
  assert.match(pol, /base-uri 'self'/);
  assert.match(pol, /frame-ancestors 'none'/);
});

check('La política CSP incluye upgrade-insecure-requests', () => {
  const pol = construirPoliticaCSP();
  assert.match(pol, /upgrade-insecure-requests/);
});

check('construirCabecerasSeguridad() es una función pura: dos llamadas con los mismos argumentos devuelven el mismo contenido', () => {
  const a = construirCabecerasSeguridad({ cspEnforce: true });
  const b = construirCabecerasSeguridad({ cspEnforce: true });
  assert.deepEqual(a, b);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
