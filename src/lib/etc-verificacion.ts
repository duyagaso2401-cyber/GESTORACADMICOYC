// ════════════════════════════════════════════════════════════════════════════
// LOTE 2 — VERIFICACIÓN DE PERTENENCIA DOCENTE + UTILIDADES DE ACCESO HÍBRIDO
// ------------------------------------------------------------------------------
// Punto 2 de la especificación: "verificación automática de vinculación
// docente por cédula — si no se encuentra como docente activo en la
// institución seleccionada, la solicitud pasa a 'Pendiente de Validación
// Institucional' para que el Rector confirme".
//
// Los docentes viven en el mismo blob JSON de cada institución
// (kv_store.value.users, filtrados por r==='docente' — igual que TODOS los
// roles del sistema K-12, ver db.users en 03-app-core.js). A diferencia de
// los estudiantes (personaCedula es obligatoria y única), el campo
// "cedula" de un docente NO es obligatorio ni único hoy (guardarDocente()
// en el frontend no lo valida) — por eso esta verificación:
//   1) Solo compara contra registros con cédula NO vacía (nunca hace match
//      contra dos docentes sin cédula solo porque ambos la tienen en
//      blanco).
//   2) Si hay más de una coincidencia, no "adivina" cuál es la correcta:
//      lo reporta como no confirmado automáticamente (ambiguo=true), y
//      también termina en validación manual del Rector, igual que si no
//      se hubiera encontrado ninguna.
// ════════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { kvStore, etcInstituciones } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface ResultadoVerificacionDocente {
  institucionEncontrada: boolean;
  institucionUsaYc: boolean;
  encontrado: boolean;
  ambiguo?: boolean;
  docente?: { u: string; n: string; correo: string; cargo?: string } | null;
  motivo: string;
}

export async function verificarPertenenciaDocente(institucionEtcId: number, cedula: string): Promise<ResultadoVerificacionDocente> {
  const cedulaLimpia = String(cedula || '').trim();
  const filas = await db.select().from(etcInstituciones).where(eq(etcInstituciones.id, institucionEtcId));
  const institucion = filas[0];
  if (!institucion) {
    return { institucionEncontrada: false, institucionUsaYc: false, encontrado: false, motivo: 'La institución destino no está registrada en el módulo ETC.' };
  }
  if (!institucion.usaPlataformaYc || !institucion.skPlataformaYc) {
    return { institucionEncontrada: true, institucionUsaYc: false, encontrado: false, motivo: 'La institución no usa la plataforma YC — el expediente queda solo en el archivo digital de la entidad territorial, sin verificación automática.' };
  }
  if (!cedulaLimpia) {
    return { institucionEncontrada: true, institucionUsaYc: true, encontrado: false, motivo: 'No se indicó una cédula para verificar.' };
  }
  const blobFilas = await db.select().from(kvStore).where(eq(kvStore.key, institucion.skPlataformaYc));
  const blob: any = blobFilas[0]?.value;
  if (!blob || !Array.isArray(blob.users)) {
    return { institucionEncontrada: true, institucionUsaYc: true, encontrado: false, motivo: 'No fue posible leer la base de datos de la institución en la plataforma YC.' };
  }
  const coincidencias = blob.users.filter((u: any) => u && u.r === 'docente' && String(u.cedula || '').trim() && String(u.cedula).trim() === cedulaLimpia);
  if (!coincidencias.length) {
    return { institucionEncontrada: true, institucionUsaYc: true, encontrado: false, motivo: 'No se encontró ningún docente activo con esa cédula en la institución seleccionada.' };
  }
  if (coincidencias.length > 1) {
    return { institucionEncontrada: true, institucionUsaYc: true, encontrado: false, ambiguo: true, motivo: 'Se encontró más de un docente registrado con esa misma cédula en la institución — requiere validación manual del Rector.' };
  }
  const u = coincidencias[0];
  return {
    institucionEncontrada: true,
    institucionUsaYc: true,
    encontrado: true,
    docente: { u: String(u.u || ''), n: String(u.n || ''), correo: String(u.correo || u.email || ''), cargo: u.cargo ? String(u.cargo) : undefined },
    motivo: 'Docente activo confirmado en la institución.',
  };
}

// Token largo, aleatorio e imposible de adivinar para el Flujo B ("Link
// Único/Token Seguro") — 24 bytes en hexadecimal (48 caracteres).
export function generarTokenAcceso(): string {
  return crypto.randomBytes(24).toString('hex');
}

// Código numérico de 6 dígitos para el Flujo B alternativo ("Cédula +
// Código OTP") — crypto.randomInt es criptográficamente seguro, a
// diferencia de Math.random().
export function generarCodigoOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}
