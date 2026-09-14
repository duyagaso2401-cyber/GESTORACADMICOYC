// ============================================================
// UTILIDAD DE CARGA DE ARCHIVOS — Multer + Cloudinary
// ============================================================
// - Multer recibe el archivo del formulario (multipart/form-data) y lo
//   deja en memoria (buffer), sin tocar el disco ni la base de datos.
// - subirBufferACloudinary() sube ESE buffer a Cloudinary con
//   uploader.upload_stream (streaming, no hay que guardar el archivo
//   completo en un archivo temporal) y devuelve únicamente el
//   secure_url — el texto corto que sí se guarda en PostgreSQL.
// ============================================================
import multer from 'multer';
import cloudinary, { cloudinaryConfigurado } from './cloudinary.js';

// Límite generoso pero no ilimitado: evita que alguien intente subir un
// archivo gigante que se quede atascado en memoria. 15 MB cubre con holgura
// fotos de perfil, logos, escudos, firmas escaneadas y la mayoría de PDFs
// de boletines/documentos.
const LIMITE_BYTES = 15 * 1024 * 1024;

export const uploadMemoria = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITE_BYTES },
});

export interface ResultadoSubida {
  url: string;          // secure_url — lo único que se debe guardar en la BD
  publicId: string;
  bytes: number;
  format?: string;
  resourceType: string;
}

export interface OpcionesSubida {
  folder?: string;       // carpeta dentro de Cloudinary (ej. 'gestor-yc/fotos-perfil')
  publicId?: string;     // nombre de archivo explícito (opcional)
  resourceType?: 'image' | 'raw' | 'auto'; // 'raw' para PDFs/documentos que no son imagen
}

// Extrae el "public_id" y el tipo de recurso a partir de una URL de
// Cloudinary ya guardada (la que quedó en la base de datos) — es lo que
// pide uploader.destroy() para poder borrar el archivo. Si la URL no es
// de Cloudinary (ej. quedó vacía, o es un Base64 de antes de la
// migración), devuelve null sin lanzar error — así el llamador puede
// simplemente no hacer nada en ese caso, en vez de tener que detectar
// esto por su cuenta cada vez.
export function extraerInfoCloudinaryDeUrl(url: string | null | undefined): { resourceType: string; publicId: string } | null {
  const m = String(url || '').match(/\/([a-z]+)\/upload\/(?:v\d+\/)?(.+)$/);
  if (!m) return null;
  const resourceType = m[1];
  let publicId = m[2];
  // Los recursos "image"/"video" no incluyen la extensión en su public_id
  // (Cloudinary la maneja aparte); los "raw" (PDFs, documentos) sí la
  // incluyen completa, como parte del nombre.
  if (resourceType === 'image' || resourceType === 'video') {
    publicId = publicId.replace(/\.[a-zA-Z0-9]+$/, '');
  }
  return { resourceType, publicId };
}

/**
 * Borra un archivo de Cloudinary a partir de su URL guardada — se usa
 * cuando el usuario reemplaza una foto/documento por uno nuevo, o lo
 * elimina explícitamente, para que la cuenta de Cloudinary no se vaya
 * llenando de archivos "huérfanos" que ya nadie usa. Nunca lanza error
 * hacia quien la llama: si la URL no es de Cloudinary, o el archivo ya
 * no existe allá, o falla la conexión, simplemente no hace nada — borrar
 * el archivo viejo es una limpieza de fondo, nunca debe bloquear ni
 * romper la acción principal del usuario (guardar la foto nueva, etc.).
 */
export async function eliminarDeCloudinarySiAplica(url: string | null | undefined): Promise<void> {
  if (!cloudinaryConfigurado) return;
  const info = extraerInfoCloudinaryDeUrl(url);
  if (!info) return;
  try {
    await cloudinary.uploader.destroy(info.publicId, { resource_type: info.resourceType });
  } catch (err) {
    console.warn('⚠️  No se pudo borrar de Cloudinary (' + info.publicId + '):', err);
  }
}

/**
 * Sube un buffer (el archivo ya recibido por Multer en memoria) a
 * Cloudinary usando upload_stream, y devuelve una promesa con el
 * resultado. No escribe nada a disco ni a la base de datos — eso lo
 * hace quien llama a esta función, guardando solo `resultado.url`.
 */
export function subirBufferACloudinary(
  buffer: Buffer,
  opciones: OpcionesSubida = {}
): Promise<ResultadoSubida> {
  return new Promise((resolve, reject) => {
    if (!cloudinaryConfigurado) {
      reject(new Error('Cloudinary no está configurado en el servidor (faltan variables de entorno).'));
      return;
    }
    if (!buffer || !buffer.length) {
      reject(new Error('Archivo vacío.'));
      return;
    }
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opciones.folder || 'gestor-yc/general',
        public_id: opciones.publicId,
        resource_type: opciones.resourceType || 'auto',
        overwrite: true,
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error('Cloudinary no devolvió resultado.'));
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          bytes: result.bytes,
          format: result.format,
          resourceType: result.resource_type,
        });
      }
    );
    stream.end(buffer);
  });
}

/**
 * Sube un data URI Base64 (ej. "data:image/png;base64,....") directamente
 * a Cloudinary. Útil para el script de migración, donde los datos ya
 * existen como Base64 dentro de la base de datos actual, en vez de venir
 * de un formulario con Multer.
 */
export function subirBase64ACloudinary(
  dataUri: string,
  opciones: OpcionesSubida = {}
): Promise<ResultadoSubida> {
  return new Promise((resolve, reject) => {
    if (!cloudinaryConfigurado) {
      reject(new Error('Cloudinary no está configurado en el servidor (faltan variables de entorno).'));
      return;
    }
    cloudinary.uploader.upload(
      dataUri,
      {
        folder: opciones.folder || 'gestor-yc/general',
        public_id: opciones.publicId,
        resource_type: opciones.resourceType || 'auto',
        overwrite: true,
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error('Cloudinary no devolvió resultado.'));
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          bytes: result.bytes,
          format: result.format,
          resourceType: result.resource_type,
        });
      }
    );
  });
}

/** Detecta si un texto es un data URI Base64 (el formato que producía
 * el navegador con FileReader.readAsDataURL antes de este cambio). */
export function esDataUriBase64(texto: unknown): texto is string {
  return typeof texto === 'string' && /^data:[-\w.]+\/[-\w.+]+;base64,/.test(texto);
}
