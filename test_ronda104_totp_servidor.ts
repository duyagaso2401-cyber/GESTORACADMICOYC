// ════════════════════════════════════════════════════════════════════════
// RONDA 104 — Pruebas del TOTP del lado del servidor (src/lib/totp.ts).
// Funciones puras, sin Express/Drizzle/red — se prueban directamente con
// `npx tsx`. Incluye los vectores de prueba OFICIALES del Apéndice B de la
// RFC 6238, para verificar que la implementación es un TOTP de verdad y no
// solo "algo que produce 6 dígitos".
//
// Cómo correr esta prueba:  npx tsx test_ronda104_totp_servidor.ts
// ════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import {
  base32Codificar,
  base32Decodificar,
  generarSecretoTOTP,
  generarCodigoTOTP,
  verificarCodigoTOTP,
  construirURIOtpAuth,
} from './src/lib/totp.ts';

let pass = 0, fail = 0;
function check(desc: string, fn: () => void) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e: any) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

// El secreto de prueba oficial de la RFC 6238 (Apéndice B) para SHA1 es la
// cadena ASCII "12345678901234567890" (20 bytes) — se codifica a Base32
// aquí mismo con nuestra propia función, exactamente como lo haría
// cualquier cliente real antes de guardarlo.
const SECRETO_RFC_ASCII = '12345678901234567890';
const SECRETO_RFC_BASE32 = base32Codificar(Buffer.from(SECRETO_RFC_ASCII, 'ascii'));

check('base32Codificar()/base32Decodificar() son inversas exactas una de la otra', () => {
  const original = Buffer.from('cualquier secreto de prueba, 20+ bytes random', 'utf-8');
  const codificado = base32Codificar(original);
  const decodificado = base32Decodificar(codificado);
  assert.equal(Buffer.compare(original, decodificado), 0);
});

check('generarSecretoTOTP() produce un secreto Base32 válido (solo el alfabeto A-Z2-7) de longitud consistente con 20 bytes', () => {
  const secreto = generarSecretoTOTP();
  assert.match(secreto, /^[A-Z2-7]+$/);
  assert.equal(secreto.length, 32); // 20 bytes * 8 bits / 5 bits por caracter = 32 caracteres
});

check('generarSecretoTOTP() nunca repite el mismo secreto dos veces seguidas (aleatoriedad real, no un valor fijo)', () => {
  const a = generarSecretoTOTP();
  const b = generarSecretoTOTP();
  assert.notEqual(a, b);
});

check('VECTOR OFICIAL RFC 6238 (Apéndice B, SHA1) — T=59 segundos produce el código 287082 (últimos 6 dígitos del 94287082 documentado en la RFC)', () => {
  assert.equal(generarCodigoTOTP(SECRETO_RFC_BASE32, 59), '287082');
});

check('VECTOR OFICIAL RFC 6238 — T=1111111109 produce 081804 (últimos 6 dígitos del 07081804 documentado en la RFC)', () => {
  assert.equal(generarCodigoTOTP(SECRETO_RFC_BASE32, 1111111109), '081804');
});

check('VECTOR OFICIAL RFC 6238 — T=1111111111 produce 050471 (últimos 6 dígitos del 14050471 documentado en la RFC)', () => {
  assert.equal(generarCodigoTOTP(SECRETO_RFC_BASE32, 1111111111), '050471');
});

check('VECTOR OFICIAL RFC 6238 — T=1234567890 produce 005924 (últimos 6 dígitos del 89005924 documentado en la RFC)', () => {
  assert.equal(generarCodigoTOTP(SECRETO_RFC_BASE32, 1234567890), '005924');
});

check('VECTOR OFICIAL RFC 6238 — T=2000000000 produce 279037 (últimos 6 dígitos del 69279037 documentado en la RFC)', () => {
  assert.equal(generarCodigoTOTP(SECRETO_RFC_BASE32, 2000000000), '279037');
});

check('verificarCodigoTOTP() acepta el código correcto del instante exacto', () => {
  assert.equal(verificarCodigoTOTP(SECRETO_RFC_BASE32, '287082', 59), true);
});

check('verificarCodigoTOTP() acepta un código generado 30s antes o 30s después (tolerancia de reloj ±1 paso)', () => {
  // T=59 cae en el paso 1 (floor(59/30)=1); el paso anterior (0) y el
  // siguiente (2) deben seguir siendo válidos para absorber relojes
  // ligeramente desincronizados entre el celular y el servidor.
  const codigoPasoAnterior = generarCodigoTOTP(SECRETO_RFC_BASE32, 29); // paso 0
  const codigoPasoSiguiente = generarCodigoTOTP(SECRETO_RFC_BASE32, 89); // paso 2
  assert.equal(verificarCodigoTOTP(SECRETO_RFC_BASE32, codigoPasoAnterior, 59), true);
  assert.equal(verificarCodigoTOTP(SECRETO_RFC_BASE32, codigoPasoSiguiente, 59), true);
});

check('verificarCodigoTOTP() RECHAZA un código de un paso más lejano (±2, fuera de la ventana de tolerancia)', () => {
  const tiempoBase = 1234567890; // uno de los instantes oficiales de la RFC, usado solo como ancla realista
  const codigoDosPasosAntes = generarCodigoTOTP(SECRETO_RFC_BASE32, tiempoBase - 60); // paso -2
  assert.equal(verificarCodigoTOTP(SECRETO_RFC_BASE32, codigoDosPasosAntes, tiempoBase), false);
});

check('verificarCodigoTOTP() RECHAZA un código incorrecto', () => {
  assert.equal(verificarCodigoTOTP(SECRETO_RFC_BASE32, '000000', 59), false);
});

check('verificarCodigoTOTP() RECHAZA entradas que no son exactamente 6 dígitos (vacío, letras, de más o de menos)', () => {
  assert.equal(verificarCodigoTOTP(SECRETO_RFC_BASE32, '', 59), false);
  assert.equal(verificarCodigoTOTP(SECRETO_RFC_BASE32, 'abcdef', 59), false);
  assert.equal(verificarCodigoTOTP(SECRETO_RFC_BASE32, '12345', 59), false);
  assert.equal(verificarCodigoTOTP(SECRETO_RFC_BASE32, '1234567', 59), false);
  assert.equal(verificarCodigoTOTP(SECRETO_RFC_BASE32, undefined as any, 59), false);
  assert.equal(verificarCodigoTOTP(SECRETO_RFC_BASE32, null as any, 59), false);
});

check('construirURIOtpAuth() arma una URI otpauth:// con el secreto, la cuenta y el emisor, en el mismo formato que ya generaba el frontend', () => {
  const uri = construirURIOtpAuth('ABCDEFGHIJKLMNOP', 'rector1', 'GestorYC');
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /secret=ABCDEFGHIJKLMNOP/);
  assert.match(uri, /issuer=GestorYC/);
  assert.match(uri, /algorithm=SHA1/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
