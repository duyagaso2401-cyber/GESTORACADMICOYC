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
