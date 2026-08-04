// Datos iniciales de prueba para el Gestor Académico
// Permite visualizar y probar todas las vistas operativas de inmediato
const SEED_DATA = {
  nombre: 'INSTITUCIÓN EDUCATIVA TÉCNICA EN INFORMÁTICA DE SINCELEJITO',
  rectora: 'Adán Yesid Jiménez Cabrales',
  secretario: 'María José Pérez Mendoza',
  municipio: 'SINCELEJITO',
  corregimiento: 'Cabecera Municipal',
  depto: 'Córdoba',
  dane: '223001001',
  nit: '900123456-7',
  emailInst: 'rectoria@inetis.edu.co',
  telInst: '3205292337',
  resolucion: 'Resolución No. 1234 de 2026',
  jornada: 'Mañana',
  modalidad: 'Técnica en Informática',
  anio: '2026',

  grados: [
    { id: '6-1', nombre: 'Sexto - 1', nivel: 'Sexto' },
    { id: '7-1', nombre: 'Séptimo - 1', nivel: 'Séptimo' },
    { id: '8-1', nombre: 'Octavo - 1', nivel: 'Octavo' },
    { id: '9-1', nombre: 'Noveno - 1', nivel: 'Noveno' },
    { id: '10-1', nombre: 'Décimo - 1', nivel: 'Décimo' },
    { id: '11-1', nombre: 'Once - 1', nivel: 'Once' }
  ],

  users: [
    { u: 'admin', p: '1234', r: 'admin', n: 'ADMINISTRADOR GENERAL' },
    { u: 'adan', p: 'adan2026', r: 'docente', n: 'Adán Yesid Jiménez Cabrales', g: ['6-1','7-1','8-1'] },
    { u: 'maria', p: 'maria2026', r: 'docente', n: 'María José Pérez Mendoza', g: ['9-1','10-1','11-1'] },
    { u: 'carlos', p: 'carlos2026', r: 'docente', n: 'Carlos Andrés Ruiz López', g: ['6-1','10-1'] },
    { u: 'elecciones', p: 'elecciones2026', r: 'elecciones', n: 'MÓDULO ELECCIONES' }
  ],

  carga: [
    // Adán — grados 6-1, 7-1, 8-1
    { id: 1, g: '6-1', m: 'Matemáticas', d: 'adan', h: 4 },
    { id: 2, g: '6-1', m: 'Ciencias Naturales', d: 'adan', h: 3 },
    { id: 3, g: '7-1', m: 'Matemáticas', d: 'adan', h: 4 },
    { id: 4, g: '7-1', m: 'Ciencias Naturales', d: 'adan', h: 3 },
    { id: 5, g: '8-1', m: 'Matemáticas', d: 'adan', h: 4 },
    { id: 6, g: '8-1', m: 'Física', d: 'adan', h: 2 },
    // María — grados 9-1, 10-1, 11-1
    { id: 7, g: '9-1', m: 'Lengua Castellana', d: 'maria', h: 4 },
    { id: 8, g: '9-1', m: 'Sociales', d: 'maria', h: 3 },
    { id: 9, g: '10-1', m: 'Lengua Castellana', d: 'maria', h: 4 },
    { id: 10, g: '11-1', m: 'Lengua Castellana', d: 'maria', h: 4 },
    { id: 11, g: '11-1', m: 'Filosofía', d: 'maria', h: 2 },
    // Carlos — grados 6-1, 10-1
    { id: 12, g: '6-1', m: 'Informática', d: 'carlos', h: 3 },
    { id: 13, g: '10-1', m: 'Informática', d: 'carlos', h: 3 },
    { id: 14, g: '10-1', m: 'Sociales', d: 'carlos', h: 3 },
    { id: 15, g: '6-1', m: 'Educación Física', d: 'carlos', h: 2 }
  ],

  ests: [
    // Sexto-1 (10 estudiantes)
    { id: '1', n: 'GÓMEZ MARTÍNEZ JUAN DAVID', g: '6-1', apellido1:'GÓMEZ', apellido2:'MARTÍNEZ', nombre1:'JUAN', nombre2:'DAVID', doc:'1001234567', acudiente:'Pedro Gómez', telAcud:'3201111111' },
    { id: '2', n: 'PÉREZ RIVERA LUISA FERNANDA', g: '6-1', apellido1:'PÉREZ', apellido2:'RIVERA', nombre1:'LUISA', nombre2:'FERNANDA', doc:'1001234568', acudiente:'Ana Pérez', telAcud:'3202222222' },
    { id: '3', n: 'ROJAS LÓPEZ CARLOS ANDRÉS', g: '6-1', apellido1:'ROJAS', apellido2:'LÓPEZ', nombre1:'CARLOS', nombre2:'ANDRÉS', doc:'1001234569', acudiente:'Luis Rojas', telAcud:'3203333333' },
    { id: '4', n: 'MARTÍNEZ TORO MARÍA CAMILA', g: '6-1', apellido1:'MARTÍNEZ', apellido2:'TORO', nombre1:'MARÍA', nombre2:'CAMILA', doc:'1001234570', acudiente:'Elena Martínez', telAcud:'3204444444' },
    { id: '5', n: 'SÁNCHEZ DÍAZ DIEGO FERNANDO', g: '6-1', apellido1:'SÁNCHEZ', apellido2:'DÍAZ', nombre1:'DIEGO', nombre2:'FERNANDO', doc:'1001234571', acudiente:'Jorge Sánchez', telAcud:'3205555555' },
    { id: '6', n: 'CASTRO NÚÑEZ VALENTINA', g: '6-1', apellido1:'CASTRO', apellido2:'NÚÑEZ', nombre1:'VALENTINA', nombre2:'', doc:'1001234572', acudiente:'Rosa Castro', telAcud:'3206666666' },
    { id: '7', n: 'RAMÍREZ FLORES SEBASTIÁN', g: '6-1', apellido1:'RAMÍREZ', apellido2:'FLORES', nombre1:'SEBASTIÁN', nombre2:'', doc:'1001234573', acudiente:'Manuel Ramírez', telAcud:'3207777777' },
    { id: '8', n: 'VARGAS ORTIZ ISABELA MARÍA', g: '6-1', apellido1:'VARGAS', apellido2:'ORTIZ', nombre1:'ISABELA', nombre2:'MARÍA', doc:'1001234574', acudiente:'Carmen Vargas', telAcud:'3208888888' },
    { id: '9', n: 'HERRERA MORA SANTIAGO', g: '6-1', apellido1:'HERRERA', apellido2:'MORA', nombre1:'SANTIAGO', nombre2:'', doc:'1001234575', acudiente:'David Herrera', telAcud:'3209999999' },
    { id: '10', n: 'JIMÉNEZ RUÍZ DANIELA SOFÍA', g: '6-1', apellido1:'JIMÉNEZ', apellido2:'RUÍZ', nombre1:'DANIELA', nombre2:'SOFÍA', doc:'1001234576', acudiente:'Patricia Jiménez', telAcud:'3201010101' },
    // Séptimo-1 (8 estudiantes)
    { id: '11', n: 'AGUDELO PÉREZ MATEO', g: '7-1', apellido1:'AGUDELO', apellido2:'PÉREZ', nombre1:'MATEO', nombre2:'', doc:'1002234567', acudiente:'Roberto Agudelo', telAcud:'3201212121' },
    { id: '12', n: 'CÁRDENAS LÓPEZ SARAH', g: '7-1', apellido1:'CÁRDENAS', apellido2:'LÓPEZ', nombre1:'SARAH', nombre2:'', doc:'1002234568', acudiente:'Lucía Cárdenas', telAcud:'3201313131' },
    { id: '13', n: 'DUARTE GÓMEZ JUAN JOSÉ', g: '7-1', apellido1:'DUARTE', apellido2:'GÓMEZ', nombre1:'JUAN', nombre2:'JOSÉ', doc:'1002234569', acudiente:'Fernando Duarte', telAcud:'3201414141' },
    { id: '14', n: 'ESCOBAR RESTREPO LAURA', g: '7-1', apellido1:'ESCOBAR', apellido2:'RESTREPO', nombre1:'LAURA', nombre2:'', doc:'1002234570', acudiente:'Sandra Escobar', telAcud:'3201515151' },
    { id: '15', n: 'FIGUEROA SALAZAR ANDRÉS', g: '7-1', apellido1:'FIGUEROA', apellido2:'SALAZAR', nombre1:'ANDRÉS', nombre2:'', doc:'1002234571', acudiente:'Óscar Figueroa', telAcud:'3201616161' },
    { id: '16', n: 'GALINDO MESA CATALINA', g: '7-1', apellido1:'GALINDO', apellido2:'MESA', nombre1:'CATALINA', nombre2:'', doc:'1002234572', acudiente:'Marta Galindo', telAcud:'3201717171' },
    { id: '17', n: 'HENAO VÉLEZ NICOLÁS', g: '7-1', apellido1:'HENAO', apellido2:'VÉLEZ', nombre1:'NICOLÁS', nombre2:'', doc:'1002234573', acudiente:'Ricardo Henao', telAcud:'3201818181' },
    { id: '18', n: 'IBÁÑEZ CASTRO VALENTINA', g: '7-1', apellido1:'IBÁÑEZ', apellido2:'CASTRO', nombre1:'VALENTINA', nombre2:'', doc:'1002234574', acudiente:'Gloria Ibáñez', telAcud:'3201919191' },
    // Octavo-1 (8 estudiantes)
    { id: '19', n: 'LOPERA JIMÉNEZ JUAN ESTEBAN', g: '8-1', apellido1:'LOPERA', apellido2:'JIMÉNEZ', nombre1:'JUAN', nombre2:'ESTEBAN', doc:'1003234567', acudiente:'Alfonso Lopera', telAcud:'3202020202' },
    { id: '20', n: 'MESA OCHOA MARIANA', g: '8-1', apellido1:'MESA', apellido2:'OCHOA', nombre1:'MARIANA', nombre2:'', doc:'1003234568', acudiente:'Teresa Mesa', telAcud:'3202121212' },
    { id: '21', n: 'NARVÁEZ QUINTERO DAVID', g: '8-1', apellido1:'NARVÁEZ', apellido2:'QUINTERO', nombre1:'DAVID', nombre2:'', doc:'1003234569', acudiente:'Javier Narváez', telAcud:'3202223232' },
    { id: '22', n: 'OSPINA RENDÓN SOFÍA', g: '8-1', apellido1:'OSPINA', apellido2:'RENDÓN', nombre1:'SOFÍA', nombre2:'', doc:'1003234570', acudiente:'Mónica Ospina', telAcud:'3202324252' },
    { id: '23', n: 'PARRA AGUDELO JUAN MANUEL', g: '8-1', apellido1:'PARRA', apellido2:'AGUDELO', nombre1:'JUAN', nombre2:'MANUEL', doc:'1003234571', acudiente:'Esteban Parra', telAcud:'3202425262' },
    { id: '24', n: 'QUINTERO MARÍN LAURA', g: '8-1', apellido1:'QUINTERO', apellido2:'MARÍN', nombre1:'LAURA', nombre2:'', doc:'1003234572', acudiente:'Beatriz Quintero', telAcud:'3202526272' },
    { id: '25', n: 'RESTREPO OROZCO SAMUEL', g: '8-1', apellido1:'RESTREPO', apellido2:'OROZCO', nombre1:'SAMUEL', nombre2:'', doc:'1003234573', acudiente:'Andrés Restrepo', telAcud:'3202627282' },
    { id: '26', n: 'SIERRA BEDOYA DANIELA', g: '8-1', apellido1:'SIERRA', apellido2:'BEDOYA', nombre1:'DANIELA', nombre2:'', doc:'1003234574', acudiente:'Pilar Sierra', telAcud:'3202728292' },
    // Noveno-1 (6 estudiantes)
    { id: '27', n: 'TORO VÁSQUEZ ANDRÉS FELIPE', g: '9-1', apellido1:'TORO', apellido2:'VÁSQUEZ', nombre1:'ANDRÉS', nombre2:'FELIPE', doc:'1004234567', acudiente:'Gustavo Toro', telAcud:'3202829302' },
    { id: '28', n: 'URIBE MONTOYA CAMILA', g: '9-1', apellido1:'URIBE', apellido2:'MONTOYA', nombre1:'CAMILA', nombre2:'', doc:'1004234568', acudiente:'Diana Uribe', telAcud:'3202930312' },
    { id: '29', n: 'VALLEJO SOTO JUAN DIEGO', g: '9-1', apellido1:'VALLEJO', apellido2:'SOTO', nombre1:'JUAN', nombre2:'DIEGO', doc:'1004234569', acudiente:'Hernán Vallejo', telAcud:'3203031322' },
    { id: '30', n: 'ZAPATA CORREA MARIANA', g: '9-1', apellido1:'ZAPATA', apellido2:'CORREA', nombre1:'MARIANA', nombre2:'', doc:'1004234570', acudiente:'Silvia Zapata', telAcud:'3203132332' },
    { id: '31', n: 'ARBELÁEZ LONDOÑO SEBASTIÁN', g: '9-1', apellido1:'ARBELÁEZ', apellido2:'LONDOÑO', nombre1:'SEBASTIÁN', nombre2:'', doc:'1004234571', acudiente:'Eduardo Arbeláez', telAcud:'3203233342' },
    { id: '32', n: 'BEDOYA MURILLO ISABELA', g: '9-1', apellido1:'BEDOYA', apellido2:'MURILLO', nombre1:'ISABELA', nombre2:'', doc:'1004234572', acudiente:'Claudia Bedoya', telAcud:'3203334352' },
    // Décimo-1 (6 estudiantes)
    { id: '33', n: 'CADENA HIGUITA JUAN PABLO', g: '10-1', apellido1:'CADENA', apellido2:'HIGUITA', nombre1:'JUAN', nombre2:'PABLO', doc:'1005234567', acudiente:'Néstor Cadenas', telAcud:'3203435362' },
    { id: '34', n: 'DUQUE AGUIRRE VALENTINA', g: '10-1', apellido1:'DUQUE', apellido2:'AGUIRRE', nombre1:'VALENTINA', nombre2:'', doc:'1005234568', acudiente:'Rosa Duque', telAcud:'3203536372' },
    { id: '35', n: 'ECHEVERRI LONDOÑO MATEO', g: '10-1', apellido1:'ECHEVERRI', apellido2:'LONDOÑO', nombre1:'MATEO', nombre2:'', doc:'1005234569', acudiente:'Alberto Echeverri', telAcud:'3203637382' },
    { id: '36', n: 'FRANCO OSPINA SARAH', g: '10-1', apellido1:'FRANCO', apellido2:'OSPINA', nombre1:'SARAH', nombre2:'', doc:'1005234570', acudiente:'Julia Franco', telAcud:'3203738392' },
    { id: '37', n: 'GAVIRIA RESTREPO SANTIAGO', g: '10-1', apellido1:'GAVIRIA', apellido2:'RESTREPO', nombre1:'SANTIAGO', nombre2:'', doc:'1005234571', acudiente:'Camilo Gaviria', telAcud:'3203839402' },
    { id: '38', n: 'HINCAPIÉ MORALES LAURA', g: '10-1', apellido1:'HINCAPIÉ', apellido2:'MORALES', nombre1:'LAURA', nombre2:'', doc:'1005234572', acudiente:'Sara Hincapié', telAcud:'3203940412' },
    // Once-1 (6 estudiantes)
    { id: '39', n: 'JARAMILLO VÉLEZ ANDRÉS', g: '11-1', apellido1:'JARAMILLO', apellido2:'VÉLEZ', nombre1:'ANDRÉS', nombre2:'', doc:'1006234567', acudiente:'Tomás Jaramillo', telAcud:'3204041422' },
    { id: '40', n: 'LONDOÑO QUINTERO CATALINA', g: '11-1', apellido1:'LONDOÑO', apellido2:'QUINTERO', nombre1:'CATALINA', nombre2:'', doc:'1006234568', acudiente:'Marcela Londoño', telAcud:'3204142432' },
    { id: '41', n: 'MARÍN ESCOBAR JUAN FELIPE', g: '11-1', apellido1:'MARÍN', apellido2:'ESCOBAR', nombre1:'JUAN', nombre2:'FELIPE', doc:'1006234569', acudiente:'Darío Marín', telAcud:'3204243442' },
    { id: '42', n: 'NOREÑA AGUDELO MARIANA', g: '11-1', apellido1:'NOREÑA', apellido2:'AGUDELO', nombre1:'MARIANA', nombre2:'', doc:'1006234570', acudiente:'Adriana Noreña', telAcud:'3204344452' },
    { id: '43', n: 'OSSA VÁSQUEZ SEBASTIÁN', g: '11-1', apellido1:'OSSA', apellido2:'VÁSQUEZ', nombre1:'SEBASTIÁN', nombre2:'', doc:'1006234571', acudiente:'Felipe Ossa', telAcud:'3204445462' },
    { id: '44', n: 'PALACIO RESTREPO ISABELA', g: '11-1', apellido1:'PALACIO', apellido2:'RESTREPO', nombre1:'ISABELA', nombre2:'', doc:'1006234572', acudiente:'Gloria Palacio', telAcud:'3204546472' }
  ],

  // Notas de ejemplo (período 1) para algunos estudiantes de 6-1
  // Estructura: { cargaId, estId, n1, n2, n3, n4 (notas por período) }
  notasSeed: [
    // 6-1 Matemáticas (carga 1) — 10 estudiantes
    { cId: 1, eId: '1', p1: 4.5, p2: 3.8, p3: 0, p4: 0 },
    { cId: 1, eId: '2', p1: 4.8, p2: 4.2, p3: 0, p4: 0 },
    { cId: 1, eId: '3', p1: 2.8, p2: 3.1, p3: 0, p4: 0 },
    { cId: 1, eId: '4', p1: 4.2, p2: 4.5, p3: 0, p4: 0 },
    { cId: 1, eId: '5', p1: 3.5, p2: 2.9, p3: 0, p4: 0 },
    { cId: 1, eId: '6', p1: 4.9, p2: 4.7, p3: 0, p4: 0 },
    { cId: 1, eId: '7', p1: 3.2, p2: 3.8, p3: 0, p4: 0 },
    { cId: 1, eId: '8', p1: 2.5, p2: 2.8, p3: 0, p4: 0 },
    { cId: 1, eId: '9', p1: 4.0, p2: 3.6, p3: 0, p4: 0 },
    { cId: 1, eId: '10', p1: 4.6, p2: 4.3, p3: 0, p4: 0 },
    // 6-1 Ciencias Naturales (carga 2)
    { cId: 2, eId: '1', p1: 4.0, p2: 3.5, p3: 0, p4: 0 },
    { cId: 2, eId: '2', p1: 4.5, p2: 4.1, p3: 0, p4: 0 },
    { cId: 2, eId: '3', p1: 3.0, p2: 2.5, p3: 0, p4: 0 },
    { cId: 2, eId: '4', p1: 4.8, p2: 4.6, p3: 0, p4: 0 },
    { cId: 2, eId: '5', p1: 3.5, p2: 3.2, p3: 0, p4: 0 },
    // 7-1 Matemáticas (carga 3)
    { cId: 3, eId: '11', p1: 4.2, p2: 3.8, p3: 0, p4: 0 },
    { cId: 3, eId: '12', p1: 4.6, p2: 4.4, p3: 0, p4: 0 },
    { cId: 3, eId: '13', p1: 2.9, p2: 3.0, p3: 0, p4: 0 },
    { cId: 3, eId: '14', p1: 4.0, p2: 3.7, p3: 0, p4: 0 },
    { cId: 3, eId: '15', p1: 3.5, p2: 4.1, p3: 0, p4: 0 },
    { cId: 3, eId: '16', p1: 4.7, p2: 4.5, p3: 0, p4: 0 },
    { cId: 3, eId: '17', p1: 3.2, p2: 2.8, p3: 0, p4: 0 },
    { cId: 3, eId: '18', p1: 4.3, p2: 4.0, p3: 0, p4: 0 },
    // 8-1 Matemáticas (carga 5)
    { cId: 5, eId: '19', p1: 3.8, p2: 4.0, p3: 0, p4: 0 },
    { cId: 5, eId: '20', p1: 4.5, p2: 4.2, p3: 0, p4: 0 },
    { cId: 5, eId: '21', p1: 2.7, p2: 3.1, p3: 0, p4: 0 },
    { cId: 5, eId: '22', p1: 4.4, p2: 4.6, p3: 0, p4: 0 },
    { cId: 5, eId: '23', p1: 3.5, p2: 3.3, p3: 0, p4: 0 },
    { cId: 5, eId: '24', p1: 4.8, p2: 4.7, p3: 0, p4: 0 },
    { cId: 5, eId: '25', p1: 3.0, p2: 2.6, p3: 0, p4: 0 },
    { cId: 5, eId: '26', p1: 4.1, p2: 3.9, p3: 0, p4: 0 },
    // 9-1 Lengua Castellana (carga 7)
    { cId: 7, eId: '27', p1: 4.0, p2: 3.5, p3: 0, p4: 0 },
    { cId: 7, eId: '28', p1: 4.6, p2: 4.3, p3: 0, p4: 0 },
    { cId: 7, eId: '29', p1: 3.2, p2: 2.9, p3: 0, p4: 0 },
    { cId: 7, eId: '30', p1: 4.4, p2: 4.1, p3: 0, p4: 0 },
    { cId: 7, eId: '31', p1: 3.7, p2: 3.9, p3: 0, p4: 0 },
    { cId: 7, eId: '32', p1: 4.8, p2: 4.5, p3: 0, p4: 0 },
    // 10-1 Lengua Castellana (carga 9)
    { cId: 9, eId: '33', p1: 3.5, p2: 3.8, p3: 0, p4: 0 },
    { cId: 9, eId: '34', p1: 4.2, p2: 4.0, p3: 0, p4: 0 },
    { cId: 9, eId: '35', p1: 2.8, p2: 3.0, p3: 0, p4: 0 },
    { cId: 9, eId: '36', p1: 4.5, p2: 4.3, p3: 0, p4: 0 },
    { cId: 9, eId: '37', p1: 3.9, p2: 4.1, p3: 0, p4: 0 },
    { cId: 9, eId: '38', p1: 4.7, p2: 4.4, p3: 0, p4: 0 },
    // 11-1 Lengua Castellana (carga 10)
    { cId: 10, eId: '39', p1: 4.1, p2: 3.7, p3: 0, p4: 0 },
    { cId: 10, eId: '40', p1: 4.5, p2: 4.2, p3: 0, p4: 0 },
    { cId: 10, eId: '41', p1: 3.0, p2: 2.7, p3: 0, p4: 0 },
    { cId: 10, eId: '42', p1: 4.3, p2: 4.0, p3: 0, p4: 0 },
    { cId: 10, eId: '43', p1: 3.8, p2: 4.0, p3: 0, p4: 0 },
    { cId: 10, eId: '44', p1: 4.6, p2: 4.4, p3: 0, p4: 0 },
    // 6-1 Informática (carga 12)
    { cId: 12, eId: '1', p1: 4.5, p2: 4.2, p3: 0, p4: 0 },
    { cId: 12, eId: '2', p1: 4.7, p2: 4.4, p3: 0, p4: 0 },
    { cId: 12, eId: '3', p1: 3.2, p2: 3.5, p3: 0, p4: 0 },
    { cId: 12, eId: '4', p1: 4.3, p2: 4.1, p3: 0, p4: 0 },
    { cId: 12, eId: '5', p1: 3.8, p2: 3.6, p3: 0, p4: 0 },
    { cId: 12, eId: '6', p1: 4.9, p2: 4.6, p3: 0, p4: 0 },
    { cId: 12, eId: '7', p1: 3.4, p2: 3.7, p3: 0, p4: 0 },
    { cId: 12, eId: '8', p1: 2.9, p2: 3.0, p3: 0, p4: 0 },
    { cId: 12, eId: '9', p1: 4.0, p2: 3.8, p3: 0, p4: 0 },
    { cId: 12, eId: '10', p1: 4.5, p2: 4.3, p3: 0, p4: 0 }
  ],

  // Observaciones de aula de ejemplo
  observacionesAula: [
    { estId: '3', per: '1', tipo: 'Comportamental', txt: 'El estudiante distrae a sus compañeros durante la clase, habla constantemente y no sigue instrucciones.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-15' },
    { estId: '3', per: '1', tipo: 'Académica', txt: 'Presenta dificultades en la resolución de problemas matemáticos básicos. Requiere refuerzo en operaciones fraccionarias.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-20' },
    { estId: '3', per: '2', tipo: 'Comportamental', txt: 'Mejoría en su comportamiento, aunque sigue necesitando recordatorios para mantener el silencio durante explicaciones.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-04-10' },
    { estId: '8', per: '1', tipo: 'Académica', txt: 'Estudiante con bajo rendimiento en matemáticas. Se recomienda acompañamiento personalizado y revisión de hábitos de estudio.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-18' },
    { estId: '8', per: '1', tipo: 'Asistencia', txt: 'Ha acumulado 3 inasistencias injustificadas en el mes. Se solicita entrevista con acudiente.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-25' },
    { estId: '2', per: '1', tipo: 'Logro', txt: 'Excelente desempeño en evaluación de fracciones. Obtuvo la calificación más alta del grupo.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-03-01' },
    { estId: '6', per: '1', tipo: 'Logro', txt: 'Participación destacada en clase de ciencias. Demuestra gran curiosidad y habilidad para el análisis.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-03-05' },
    { estId: '13', per: '1', tipo: 'Comportamental', txt: 'Llega tarde a clase con frecuencia. Se le ha llamado la atención en tres ocasiones.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-12' },
    { estId: '21', per: '1', tipo: 'Académica', txt: 'No entrega actividades a tiempo. Se recomienda seguimiento más cercano y comunicación con la familia.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-22' },
    { estId: '25', per: '2', tipo: 'Comportamental', txt: 'Presenta actitud desafiante ante correcciones. Se sugiere intervención de psicoorientación.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-04-15' }
  ],

  // Registros del observador disciplinario
  observadores: [
    { id: 'obs1', estId: '3', per: '1', causa: 'Indisciplina', desc: 'El estudiante interrumpió la clase en múltiples ocasiones, lanzó objetos y faltó al respeto a un compañero.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-15', tipo: 'Indisciplina' },
    { id: 'obs2', estId: '3', per: '1', causa: 'Falta de atención', desc: 'No presta atención durante explicaciones, juega con objetos en el escritorio.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-20', tipo: 'Falta de atención' },
    { id: 'obs3', estId: '8', per: '1', causa: 'Inasistencias', desc: 'Acumula 3 inasistencias injustificadas en el mes de febrero.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-25', tipo: 'Inasistencias' },
    { id: 'obs4', estId: '13', per: '1', causa: 'Incumplimiento en la entrega de compromisos', desc: 'No entrega trabajos asignados en tres oportunidades consecutivas.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-12', tipo: 'Incumplimiento en la entrega de compromisos' },
    { id: 'obs5', estId: '25', per: '2', causa: 'Comportamiento agresivo', desc: 'Presenta actitud desafiante y agresiva hacia docentes y compañeros.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-04-15', tipo: 'Comportamiento agresivo' }
  ],

  // Registros de asistencia
  asistencia: [
    { id: 'a1', fecha: '2026-02-03', hora: '07:00', grado: '6-1', cargaId: 1, docente: 'adan', actividad: 'Clase de fracciones — suma y resta', presentes: ['1','2','3','4','5','6','7','9','10'], ausentes: ['8'], justificados: [], periodo: '1' },
    { id: 'a2', fecha: '2026-02-05', hora: '07:00', grado: '6-1', cargaId: 1, docente: 'adan', actividad: 'Fracciones — multiplicación', presentes: ['1','2','3','4','5','6','7','8','9','10'], ausentes: [], justificados: [], periodo: '1' },
    { id: 'a3', fecha: '2026-02-10', hora: '07:00', grado: '6-1', cargaId: 1, docente: 'adan', actividad: 'Repaso general de fracciones', presentes: ['1','2','4','5','6','7','8','9','10'], ausentes: ['3'], justificados: [], periodo: '1' },
    { id: 'a4', fecha: '2026-02-12', hora: '07:00', grado: '6-1', cargaId: 2, docente: 'adan', actividad: 'Sistema solar — planetas', presentes: ['1','2','3','4','5','6','7','8','10'], ausentes: ['9'], justificados: [], periodo: '1' },
    { id: 'a5', fecha: '2026-02-17', hora: '07:00', grado: '7-1', cargaId: 3, docente: 'adan', actividad: 'Álgebra básica — ecuaciones lineales', presentes: ['11','12','13','14','15','16','17','18'], ausentes: [], justificados: [], periodo: '1' },
    { id: 'a6', fecha: '2026-02-19', hora: '07:00', grado: '7-1', cargaId: 3, docente: 'adan', actividad: 'Ecuaciones con una incógnita', presentes: ['11','12','14','15','16','17','18'], ausentes: ['13'], justificados: [], periodo: '1' },
    { id: 'a7', fecha: '2026-02-24', hora: '07:00', grado: '8-1', cargaId: 5, docente: 'adan', actividad: 'Geometría — teorema de Pitágoras', presentes: ['19','20','21','22','23','24','26'], ausentes: ['25'], justificados: [], periodo: '1' },
    { id: 'a8', fecha: '2026-03-03', hora: '07:00', grado: '6-1', cargaId: 1, docente: 'adan', actividad: 'Evaluación de fracciones', presentes: ['1','2','3','4','5','6','7','8','9','10'], ausentes: [], justificados: [], periodo: '1' },
    { id: 'a9', fecha: '2026-04-07', hora: '07:00', grado: '6-1', cargaId: 1, docente: 'adan', actividad: 'Inicio P2 — Números decimales', presentes: ['1','2','3','4','5','6','7','8','10'], ausentes: ['9'], justificados: [], periodo: '2' },
    { id: 'a10', fecha: '2026-04-09', hora: '07:00', grado: '8-1', cargaId: 5, docente: 'adan', actividad: 'Áreas y perímetros — figuras compuestas', presentes: ['19','20','21','22','23','24','25','26'], ausentes: [], justificados: [], periodo: '2' }
  ],

  // Descriptores de ejemplo
  descriptores: [
    { id: 'd1', g: '6-1', per: '1', cargaId: 1, txt: 'Resuelve operaciones básicas con fracciones: suma, resta, multiplicación y división.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-01' },
    { id: 'd2', g: '6-1', per: '1', cargaId: 1, txt: 'Identifica y clasifica números naturales, enteros y racionales.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-01' },
    { id: 'd3', g: '6-1', per: '1', cargaId: 2, txt: 'Describe el sistema solar e identifica las características de cada planeta.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-01' },
    { id: 'd4', g: '7-1', per: '1', cargaId: 3, txt: 'Resuelve ecuaciones lineales con una incógnita utilizando propiedades de igualdad.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-01' },
    { id: 'd5', g: '8-1', per: '1', cargaId: 5, txt: 'Aplica el teorema de Pitágoras en la resolución de problemas geométricos.', doc: 'Adán Yesid Jiménez Cabrales', fecha: '2026-02-01' },
    { id: 'd6', g: '9-1', per: '1', cargaId: 7, txt: 'Produce textos argumentativos con coherencia y cohesión, respetando reglas ortográficas.', doc: 'María José Pérez Mendoza', fecha: '2026-02-01' },
    { id: 'd7', g: '10-1', per: '1', cargaId: 9, txt: 'Analiza obras literarias identificando figuras retóricas y contexto histórico.', doc: 'María José Pérez Mendoza', fecha: '2026-02-01' },
    { id: 'd8', g: '11-1', per: '1', cargaId: 10, txt: 'Argumenta filosóficamente sobre problemas éticos contemporáneos.', doc: 'María José Pérez Mendoza', fecha: '2026-02-01' },
    { id: 'd9', g: '6-1', per: '1', cargaId: 12, txt: 'Identifica los componentes básicos de un computador y sus funciones.', doc: 'Carlos Andrés Ruiz López', fecha: '2026-02-01' },
    { id: 'd10', g: '10-1', per: '1', cargaId: 12, txt: 'Desarrolla algoritmos básicos utilizando estructuras secuenciales y condicionales.', doc: 'Carlos Andrés Ruiz López', fecha: '2026-02-01' }
  ]
};

// Función que integra los datos de prueba en la BD si está vacía
function _seedDBIfEmpty(data){
  if(!data) return data;
  // Solo sembrar si la BD está vacía (sin estudiantes ni nombre)
  if(data.ests&&data.ests.length>0) return data;
  if(data.nombre&&data.nombre.length>5) return data;

  // Copiar campos de SEED_DATA
  var seed=SEED_DATA;
  data.nombre=seed.nombre;
  data.rectora=seed.rectora;
  data.secretario=seed.secretario;
  data.municipio=seed.municipio;
  data.corregimiento=seed.corregimiento;
  data.depto=seed.depto;
  data.dane=seed.dane;
  data.nit=seed.nit;
  data.emailInst=seed.emailInst;
  data.telInst=seed.telInst;
  data.resolucion=seed.resolucion;
  data.jornada=seed.jornada;
  data.modalidad=seed.modalidad;
  data.anio=seed.anio;
  data.grados=JSON.parse(JSON.stringify(seed.grados));
  data.users=JSON.parse(JSON.stringify(seed.users));
  data.carga=JSON.parse(JSON.stringify(seed.carga));
  data.ests=JSON.parse(JSON.stringify(seed.ests));
  data.descriptores=JSON.parse(JSON.stringify(seed.descriptores));
  data.observadores=JSON.parse(JSON.stringify(seed.observadores));
  data.asistencia=JSON.parse(JSON.stringify(seed.asistencia));

  // Insertar observaciones de aula en cada estudiante
  if(seed.observacionesAula){
    seed.observacionesAula.forEach(function(o){
      var est=data.ests.find(function(e){return String(e.id)===String(o.estId);});
      if(est){
        if(!est.observaciones) est.observaciones=[];
        est.observaciones.push({per:o.per,tipo:o.tipo,txt:o.txt,doc:o.doc,fecha:o.fecha,anio:data.anio});
      }
    });
  }

  // Insertar notas
  if(seed.notasSeed){
    seed.notasSeed.forEach(function(n){
      var key='n_'+n.cId+'_'+n.eId;
      data[key]={p1:n.p1,p2:n.p2,p3:n.p3,p4:n.p4};
    });
  }

  return data;
}
