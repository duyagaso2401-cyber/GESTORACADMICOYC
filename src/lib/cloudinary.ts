// ============================================================
// CLOUDINARY — configuración del cliente
// ============================================================
// Todos los archivos (fotos de perfil, logos, escudos, firmas,
// documentos del repositorio, etc.) se suben aquí en vez de guardarse
// como texto Base64 dentro de PostgreSQL/Neon. Guardar archivos
// grandes como Base64 en una columna JSONB hace que CADA sincronización
// o guardado tenga que transferir esos mismos bytes una y otra vez —
// eso es lo que dispara el consumo de "Network Transfer" en Neon.
// Con Cloudinary, la base de datos solo guarda un texto corto (la URL),
// y el archivo en sí se sirve directamente desde Cloudinary.
//
// Variables de entorno requeridas (ver .env):
//   CLOUDINARY_CLOUD_NAME
//   CLOUDINARY_API_KEY
//   CLOUDINARY_API_SECRET
// ============================================================
import { v2 as cloudinary } from 'cloudinary';

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';

export const cloudinaryConfigurado = Boolean(
  CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET
);

if (cloudinaryConfigurado) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  console.log('✅ Cloudinary configurado (cloud_name: ' + CLOUDINARY_CLOUD_NAME + ')');
} else {
  console.warn(
    '⚠️  Cloudinary NO está configurado — faltan CLOUDINARY_CLOUD_NAME, ' +
    'CLOUDINARY_API_KEY o CLOUDINARY_API_SECRET en las variables de entorno. ' +
    'Las subidas de archivos (fotos, logos, documentos) fallarán hasta que se configuren.'
  );
}

export default cloudinary;
