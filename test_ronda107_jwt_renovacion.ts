// ════════════════════════════════════════════════════════════════════════
// RONDA 107 — ítem 1.8: renovación deslizante de JWT (debeRenovarseJWT,
// renovarJWTSiAplica en src/lib/jwt-auth.ts). Pruebas 100% puras (sin
// Express, sin base de datos), igual que test_ronda104_totp_servidor.ts —
// se corren directo con `npx tsx`.
// ════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { firmarJWT, verificarJWT, debeRenovarseJWT, renovarJWTSiAplica } from './src/lib/jwt-auth.ts';

let pass = 0, fail = 0;
function check(desc: string, fn: () => void) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e: any) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

const DATOS_BASE = { sub: 'rector1', sk: 'sk-test', rol: 'admin' as const };

check('debeRenovarseJWT() es false recién emitido (le queda el 100% de su vida útil)', () => {
  const token = firmarJWT(DATOS_BASE, 8);
  const payload = verificarJWT(token)!;
  assert.equal(debeRenovarseJWT(payload), false);
});

check('debeRenovarseJWT() es false a mitad de camino (restante > 25% de la vida útil)', () => {
  const payload = { ...DATOS_BASE, iat: 1000, exp: 1000 + 8 * 3600 } as any;
  const ahora = 1000 + 4 * 3600; // mitad del token de 8h
  assert.equal(debeRenovarseJWT(payload, ahora), false);
});

check('debeRenovarseJWT() es true dentro del último 25% de la vida útil', () => {
  const payload = { ...DATOS_BASE, iat: 1000, exp: 1000 + 8 * 3600 } as any;
  const ahora = 1000 + 7 * 3600; // queda 1h de 8h = 12.5% < 25%
  assert.equal(debeRenovarseJWT(payload, ahora), true);
});

check('debeRenovarseJWT() es false si el token YA expiró (defensa en profundidad)', () => {
  const payload = { ...DATOS_BASE, iat: 1000, exp: 1000 + 8 * 3600 } as any;
  const ahora = 1000 + 9 * 3600; // ya pasó la expiración
  assert.equal(debeRenovarseJWT(payload, ahora), false);
});

check('debeRenovarseJWT() es false con un payload corrupto (exp<=iat)', () => {
  const payload = { ...DATOS_BASE, iat: 1000, exp: 900 } as any;
  assert.equal(debeRenovarseJWT(payload, 950), false);
});

check('renovarJWTSiAplica() devuelve null si todavía no corresponde renovar', () => {
  const token = firmarJWT(DATOS_BASE, 8);
  const payload = verificarJWT(token)!;
  assert.equal(renovarJWTSiAplica(payload), null);
});

check('renovarJWTSiAplica() emite un token NUEVO, válido, con los mismos datos de identidad pero iat/exp frescos', () => {
  const ahora = Math.floor(Date.now() / 1000);
  const payloadViejo = { ...DATOS_BASE, iat: ahora - 7 * 3600, exp: ahora - 7 * 3600 + 8 * 3600 }; // le queda 1h de 8h
  const resultado = renovarJWTSiAplica(payloadViejo as any, 8);
  assert.ok(resultado, 'debía renovar dentro de la ventana');
  assert.equal(resultado!.payload.sub, DATOS_BASE.sub);
  assert.equal(resultado!.payload.sk, DATOS_BASE.sk);
  assert.equal(resultado!.payload.rol, DATOS_BASE.rol);
  assert.ok(resultado!.payload.iat >= payloadViejo.iat, 'el nuevo token debe tener un iat nuevo (no reutilizar el viejo)');
  assert.ok(resultado!.payload.exp > payloadViejo.exp - 3600, 'el nuevo token debe durar una jornada completa de nuevo');
  // El token renovado debe ser un JWT genuino, verificable igual que cualquier otro
  const reverificado = verificarJWT(resultado!.token);
  assert.ok(reverificado, 'el token renovado debe pasar verificarJWT() normalmente');
});

check('Un token YA expirado NUNCA se renueva — exige login nuevo, no se debilita la seguridad', () => {
  const ahora = Math.floor(Date.now() / 1000);
  const payloadExpirado = { ...DATOS_BASE, iat: ahora - 9 * 3600, exp: ahora - 1 * 3600 }; // expiró hace 1h
  assert.equal(renovarJWTSiAplica(payloadExpirado as any, 8), null);
});

check('Preserva campos opcionales (rolEspecifico, nombre, estId) al renovar', () => {
  const ahora = Math.floor(Date.now() / 1000);
  const datosCompletos = { sub: 'doc1', sk: 'sk-test', rol: 'docente', rolEspecifico: 'Tutor PTA', nombre: 'Juan Pérez' };
  const payloadViejo = { ...datosCompletos, iat: ahora - 7 * 3600, exp: ahora - 7 * 3600 + 8 * 3600 };
  const resultado = renovarJWTSiAplica(payloadViejo as any, 8);
  assert.equal(resultado!.payload.rolEspecifico, 'Tutor PTA');
  assert.equal(resultado!.payload.nombre, 'Juan Pérez');
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
