// ════════════════════════════════════════════════════════════════════════════
// LOTE 4 — MEMBRETES DINÁMICOS (punto 4 de la especificación, cierre)
// ------------------------------------------------------------------------------
// "Todos los documentos/constancias/reportes y correos que emita el módulo
// adoptan automáticamente el membrete/identidad legal de la Entidad
// Territorial" — el perfil legal completo ya vive en `etc_entidades` desde
// el Lote 1 (Nombre Oficial, Tipo, NIT, Dirección, Teléfono, Correo
// Oficial, Logo/Escudo, Firma Digital); lo que faltaba era APLICARLO. Este
// archivo centraliza esa aplicación en un solo lugar — igual filosofía que
// checkModuleEnabled()/verificarPertenenciaDocente(): un único punto que
// ningún correo/documento nuevo del módulo puede "olvidar" usar.
// ════════════════════════════════════════════════════════════════════════════
import { db } from '../db/index.js';
import { etcEntidades } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface MembreteEntidad {
  nombreEntidad: string;
  tipoEntidad: string;
  nit: string;
  direccion: string;
  telefono: string;
  emailContacto: string;
  logoUrl: string;
  firmaRepresentanteUrl: string;
}

export async function obtenerMembreteEntidad(entidadId: number | null | undefined): Promise<MembreteEntidad | null> {
  if (!entidadId) return null;
  try {
    const filas = await db.select().from(etcEntidades).where(eq(etcEntidades.id, entidadId));
    const e = filas[0];
    if (!e || !e.activo) return null;
    return {
      nombreEntidad: e.nombreEntidad,
      tipoEntidad: e.tipoEntidad,
      nit: e.nit || '',
      direccion: e.direccion || '',
      telefono: e.telefono || '',
      emailContacto: e.emailContacto || '',
      logoUrl: e.logoUrl || '',
      firmaRepresentanteUrl: e.firmaRepresentanteUrl || '',
    };
  } catch {
    return null;
  }
}

// Envuelve un cuerpo de correo (HTML ya armado por el llamador) con un
// encabezado de marca de la Entidad Territorial — logo (si tiene URL) +
// nombre oficial + tipo — y un pie con NIT/dirección/teléfono cuando
// existan. Si no hay membrete (entidad no encontrada/inactiva, o
// entidadId ausente porque el permiso/contrato no está bajo ninguna ETC),
// devuelve el HTML original SIN modificar — el correo "genérico" de
// Gestor Académico YC sigue funcionando exactamente igual que siempre.
export function aplicarMembreteHtml(htmlOriginal: string, membrete: MembreteEntidad | null): string {
  if (!membrete) return htmlOriginal;
  const logo = membrete.logoUrl
    ? `<img src="${membrete.logoUrl}" alt="${_escapar(membrete.nombreEntidad)}" style="max-height:56px;max-width:160px;display:block;margin:0 auto 8px" />`
    : '';
  const tipoLegible = String(membrete.tipoEntidad || '').replace(/_/g, ' ');
  const encabezado = `<div style="text-align:center;padding:14px 10px;border-bottom:2px solid #003366;margin-bottom:16px">
    ${logo}
    <div style="font-weight:bold;color:#003366;font-size:1rem">${_escapar(membrete.nombreEntidad)}</div>
    <div style="font-size:0.75rem;color:#666">${_escapar(tipoLegible)}</div>
  </div>`;
  const piePartes = [membrete.nit ? `NIT: ${_escapar(membrete.nit)}` : '', membrete.direccion ? _escapar(membrete.direccion) : '', membrete.telefono ? `Tel: ${_escapar(membrete.telefono)}` : '', membrete.emailContacto ? _escapar(membrete.emailContacto) : ''].filter(Boolean);
  const pie = piePartes.length
    ? `<div style="text-align:center;padding:10px;margin-top:16px;border-top:1px solid #ddd;font-size:0.7rem;color:#888">${piePartes.join(' &nbsp;·&nbsp; ')}</div>`
    : '';
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">${encabezado}<div style="padding:0 12px">${htmlOriginal}</div>${pie}</div>`;
}

function _escapar(texto: string): string {
  return String(texto || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
