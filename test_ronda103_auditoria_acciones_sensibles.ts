// ════════════════════════════════════════════════════════════════════════
// RONDA 103 — Pruebas de detectarAccionesSensibles()
// (src/lib/auditoria-acciones.ts). Función pura, sin Express/Drizzle/red —
// se prueba directamente con `npx tsx`.
//
// Cómo correr esta prueba:  npx tsx test_ronda103_auditoria_acciones_sensibles.ts
// ════════════════════════════════════════════════════════════════════════
import assert from 'node:assert/strict';
import { detectarAccionesSensibles } from './src/lib/auditoria-acciones.ts';

let pass = 0, fail = 0;
function check(desc: string, fn: () => void) {
  try { fn(); pass++; console.log('✅ ' + desc); }
  catch (e: any) { fail++; console.log('❌ ' + desc + '  →  ' + (e && e.message ? e.message : e)); }
}

check('Sin "antes" (primer guardado de una institución nueva) no genera NINGÚN evento, aunque "después" tenga mucho contenido', () => {
  const despues = { ests: [{ id: 1, nom: 'Ana' }], users: [{ u: 'doc1' }], config: { numPeriodos: 4 }, puestoOverrides: { '1_5°': { puesto: 1 } } };
  assert.deepEqual(detectarAccionesSensibles(null, despues), []);
  assert.deepEqual(detectarAccionesSensibles(undefined, despues), []);
});

check('Sin "después" (dato corrupto/inesperado) tampoco genera eventos, por seguridad', () => {
  const antes = { ests: [{ id: 1, nom: 'Ana' }] };
  assert.deepEqual(detectarAccionesSensibles(antes, null), []);
});

check('Dos blobs IDÉNTICOS no generan ningún evento', () => {
  const blob = { ests: [{ id: 1, nom: 'Ana' }], users: [{ u: 'doc1', r: 'docente' }], config: { numPeriodos: 4 }, puestoOverrides: { '1_5°': { puesto: 1, fecha: 'x' } } };
  const copia = JSON.parse(JSON.stringify(blob));
  assert.deepEqual(detectarAccionesSensibles(blob, copia), []);
});

check('AJUSTE DE PUESTO — agregar una entrada nueva en puestoOverrides genera un evento "ajuste_puesto_manual"', () => {
  const antes = { puestoOverrides: {} };
  const despues = { puestoOverrides: { '10_5°': { puesto: 2, fecha: '2026-01-01' } } };
  const eventos = detectarAccionesSensibles(antes, despues);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].accion, 'ajuste_puesto_manual');
  assert.equal(eventos[0].detalle.clave, '10_5°');
  assert.equal(eventos[0].detalle.puestoAnterior, null);
  assert.deepEqual(eventos[0].detalle.puestoNuevo, { puesto: 2, fecha: '2026-01-01' });
});

check('AJUSTE DE PUESTO — cambiar el valor de una entrada existente también genera el evento, con el valor anterior correcto', () => {
  const antes = { puestoOverrides: { '10_5°': { puesto: 2, fecha: 'a' } } };
  const despues = { puestoOverrides: { '10_5°': { puesto: 3, fecha: 'b' } } };
  const eventos = detectarAccionesSensibles(antes, despues);
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0].detalle.puestoAnterior, { puesto: 2, fecha: 'a' });
  assert.deepEqual(eventos[0].detalle.puestoNuevo, { puesto: 3, fecha: 'b' });
});

check('AJUSTE DE PUESTO — borrar una entrada (volver a dejarlo automático) genera el evento con puestoNuevo:null', () => {
  const antes = { puestoOverrides: { '10_5°': { puesto: 2 } } };
  const despues = { puestoOverrides: {} };
  const eventos = detectarAccionesSensibles(antes, despues);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].detalle.puestoNuevo, null);
});

check('ESTUDIANTE ELIMINADO — un estudiante que estaba en "ests" y ya no está genera "estudiante_eliminado" con su id/nombre', () => {
  const antes = { ests: [{ id: 1, nom: 'Ana' }, { id: 2, nom: 'Luis' }] };
  const despues = { ests: [{ id: 1, nom: 'Ana' }] };
  const eventos = detectarAccionesSensibles(antes, despues);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].accion, 'estudiante_eliminado');
  assert.equal(eventos[0].detalle.id, 2);
  assert.equal(eventos[0].detalle.nombre, 'Luis');
});

check('Un estudiante que sigue existiendo (aunque le cambien otros campos, como notas) NO se reporta como eliminado', () => {
  const antes = { ests: [{ id: 1, nom: 'Ana', notaFinal: 3.5 }] };
  const despues = { ests: [{ id: 1, nom: 'Ana', notaFinal: 4.2 }] };
  assert.deepEqual(detectarAccionesSensibles(antes, despues), []);
});

check('USUARIO ELIMINADO — un usuario/docente que estaba en "users" y ya no está genera "usuario_eliminado" con su rol', () => {
  const antes = { users: [{ u: 'doc1', n: 'Carla', r: 'docente' }, { u: 'rector1', n: 'Pedro', r: 'admin' }] };
  const despues = { users: [{ u: 'rector1', n: 'Pedro', r: 'admin' }] };
  const eventos = detectarAccionesSensibles(antes, despues);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].accion, 'usuario_eliminado');
  assert.equal(eventos[0].detalle.usuario, 'doc1');
  assert.equal(eventos[0].detalle.rol, 'docente');
});

check('CONFIGURACIÓN — cambiar un campo de primer nivel en db.config genera "configuracion_institucional_modificada" con antes/después', () => {
  const antes = { config: { numPeriodos: 4, nombreColegio: 'Colegio A' } };
  const despues = { config: { numPeriodos: 6, nombreColegio: 'Colegio A' } };
  const eventos = detectarAccionesSensibles(antes, despues);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].accion, 'configuracion_institucional_modificada');
  assert.equal(eventos[0].detalle.campo, 'numPeriodos');
  assert.equal(eventos[0].detalle.valorAnterior, 4);
  assert.equal(eventos[0].detalle.valorNuevo, 6);
});

check('Agregar un campo nuevo a config (que antes no existía) también se reporta, con valorAnterior:null', () => {
  const antes = { config: {} };
  const despues = { config: { modoEstrictoAsistencia: true } };
  const eventos = detectarAccionesSensibles(antes, despues);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].detalle.valorAnterior, null);
  assert.equal(eventos[0].detalle.valorNuevo, true);
});

check('UN SOLO GUARDADO con varios cambios distintos a la vez genera un evento por cada uno, sin mezclarlos', () => {
  const antes = {
    ests: [{ id: 1, nom: 'Ana' }, { id: 2, nom: 'Luis' }],
    users: [{ u: 'doc1', r: 'docente' }],
    config: { numPeriodos: 4 },
    puestoOverrides: {},
  };
  const despues = {
    ests: [{ id: 1, nom: 'Ana' }],
    users: [],
    config: { numPeriodos: 4 },
    puestoOverrides: { '1_5°': { puesto: 1 } },
  };
  const eventos = detectarAccionesSensibles(antes, despues);
  const acciones = eventos.map((e) => e.accion).sort();
  assert.deepEqual(acciones, ['ajuste_puesto_manual', 'estudiante_eliminado', 'usuario_eliminado']);
});

check('Un guardado normal de rutina (ej. solo cambia una nota, nada sensible) no genera NINGÚN evento', () => {
  const antes = { ests: [{ id: 1, nom: 'Ana' }], config: { numPeriodos: 4 }, planilla: { notaX: 3.0 } };
  const despues = { ests: [{ id: 1, nom: 'Ana' }], config: { numPeriodos: 4 }, planilla: { notaX: 4.5 } };
  assert.deepEqual(detectarAccionesSensibles(antes, despues), []);
});

console.log('\n' + '═'.repeat(70));
console.log(`${pass} prueba(s) en verde, ${fail} fallida(s).`);
if (fail > 0) { console.log('❌ Hay pruebas fallidas — ver detalle arriba.'); process.exit(1); }
console.log('✅ 100% de la suite en verde.');
