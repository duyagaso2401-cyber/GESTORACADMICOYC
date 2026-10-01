// ════════════════════════════════════════════════════════════════════════
// RONDA 106 — Pruebas puras de src/lib/totp-backup-codes.ts (códigos de
// respaldo de 2FA). Mismo patrón que test_ronda104_totp_servidor.ts: cero
// dependencias de Drizzle/Express, se corre directo con `npx tsx`.
// ════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import {
  generarCodigosRespaldo,
  normalizarCodigoRespaldo,
  esFormatoCodigoRespaldo,
  hashCodigoRespaldo,
} from './src/lib/totp-backup-codes.ts';

let pass = 0, fail = 0;
function check(desc: string, fn: () => void) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e: any) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

check('generarCodigosRespaldo() por defecto genera 8 códigos', () => {
  const codigos = generarCodigosRespaldo();
  assert.equal(codigos.length, 8);
});

check('generarCodigosRespaldo(n) respeta la cantidad pedida', () => {
  assert.equal(generarCodigosRespaldo(3).length, 3);
  assert.equal(generarCodigosRespaldo(12).length, 12);
});

check('Cada código generado tiene el formato XXXX-XXXX usando solo el alfabeto sin ambigüedades', () => {
  const codigos = generarCodigosRespaldo(50);
  for (const c of codigos) {
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    assert.ok(!/[01OIL]/.test(c), `código ${c} contiene un carácter ambiguo`);
  }
});

check('Un lote de códigos generados no tiene duplicados (probabilísticamente, con 32^8 combinaciones)', () => {
  const codigos = generarCodigosRespaldo(200);
  const unicos = new Set(codigos);
  assert.equal(unicos.size, codigos.length);
});

check('normalizarCodigoRespaldo() unifica mayúsculas/minúsculas, espacios y el guion', () => {
  assert.equal(normalizarCodigoRespaldo('ab12-cd34'), 'AB12CD34');
  assert.equal(normalizarCodigoRespaldo('AB12CD34'), 'AB12CD34');
  assert.equal(normalizarCodigoRespaldo('  AB12-CD34  '), 'AB12CD34');
  assert.equal(normalizarCodigoRespaldo('AB12 CD34'), 'AB12CD34');
});

check('normalizarCodigoRespaldo() es resistente a entradas vacías/no-string', () => {
  assert.equal(normalizarCodigoRespaldo(''), '');
  // @ts-expect-error prueba deliberada de entrada inválida
  assert.equal(normalizarCodigoRespaldo(undefined), '');
  // @ts-expect-error prueba deliberada de entrada inválida
  assert.equal(normalizarCodigoRespaldo(null), '');
});

check('esFormatoCodigoRespaldo() reconoce un código de respaldo válido, con o sin guion', () => {
  // Nota: el alfabeto de códigos de respaldo EXCLUYE 0/O/1/I/L, así que un
  // código válido real nunca contiene esos caracteres (por eso se usa "A2"
  // en vez de "A1" en este caso de prueba).
  assert.equal(esFormatoCodigoRespaldo('AB23-CD34'), true);
  assert.equal(esFormatoCodigoRespaldo('ab23cd34'), true);
});

check('esFormatoCodigoRespaldo() rechaza un código TOTP normal de 6 dígitos', () => {
  assert.equal(esFormatoCodigoRespaldo('123456'), false);
  assert.equal(esFormatoCodigoRespaldo(' 123456 '), false);
});

check('esFormatoCodigoRespaldo() rechaza longitudes incorrectas o caracteres fuera del alfabeto', () => {
  assert.equal(esFormatoCodigoRespaldo('AB12-CD3'), false);
  assert.equal(esFormatoCodigoRespaldo('AB12-CD345'), false);
  assert.equal(esFormatoCodigoRespaldo('AB1O-CD34'), false); // contiene "O" ambigua, fuera del alfabeto
  assert.equal(esFormatoCodigoRespaldo(''), false);
});

check('hashCodigoRespaldo() es determinístico y normaliza antes de hashear (equivalentes dan el mismo hash)', () => {
  const h1 = hashCodigoRespaldo('AB12-CD34');
  const h2 = hashCodigoRespaldo('ab12cd34');
  const h3 = hashCodigoRespaldo('  AB12-CD34  ');
  assert.equal(h1, h2);
  assert.equal(h1, h3);
  assert.equal(h1.length, 64); // sha256 hex
});

check('hashCodigoRespaldo() produce hashes distintos para códigos distintos', () => {
  const h1 = hashCodigoRespaldo('AB12-CD34');
  const h2 = hashCodigoRespaldo('AB12-CD35');
  assert.notEqual(h1, h2);
});

check('Un código generado por generarCodigosRespaldo() siempre pasa esFormatoCodigoRespaldo()', () => {
  const codigos = generarCodigosRespaldo(20);
  for (const c of codigos) assert.equal(esFormatoCodigoRespaldo(c), true, `código ${c} no pasó el detector de formato`);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
