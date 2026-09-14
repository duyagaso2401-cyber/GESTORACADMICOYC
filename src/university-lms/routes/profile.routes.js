// =====================================================================
// server/routes/profile.routes.js
// Sección 3 — Auto-gestión de perfil (TODOS los roles): datos básicos,
// cambio de contraseña (bcrypt) y foto de perfil vía Cloudinary (URL).
// Se monta en: /api/university/profile
//
// Dependencia nueva: bcryptjs (puro JS, sin binarios nativos — evita
// problemas de compilación en Render). Agregar a package.json:
//   "bcryptjs": "^2.4.3"
// =====================================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../lib/db.js';
import { asyncHandler, enviarConEtag } from '../utils/http.js';
import { registrarEvento } from '../utils/logger.js';
import { subirBufferACloudinary, uploadMemoria } from '../../lib/upload.js';
// Integrado directamente con src/lib/upload.ts (Cloudinary real del proyecto) — sin duplicados.

const router = Router();
const SALT_ROUNDS = 12;

// ── Ver mi propio perfil ─────────────────────────────────────────────
router.get('/me', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, rol, nombres, apellidos, correo, telefono, documento_identidad, biografia, foto_url, ultimo_ingreso_at
       FROM univ_usuarios_perfil WHERE institucion_sk = $1 AND usuario_u = $2`,
    [req.sesionUniv.sk, req.sesionUniv.userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Perfil no encontrado.' });
  enviarConEtag(req, res, rows[0], { cacheControl: 'private, max-age=30, must-revalidate' });
}));

// ── Actualizar datos personales básicos ─────────────────────────────
// Optimista por diseño: el cliente ya actualizó su UI localmente antes
// de llamar esto; esta ruta solo confirma en segundo plano.
router.patch('/me', asyncHandler(async (req, res) => {
  const { nombres, apellidos, telefono, correo, biografia } = req.body;
  const { rows } = await query(
    `UPDATE univ_usuarios_perfil SET
       nombres = COALESCE($1, nombres), apellidos = COALESCE($2, apellidos),
       telefono = COALESCE($3, telefono), correo = COALESCE($4, correo),
       biografia = COALESCE($5, biografia)
     WHERE institucion_sk = $6 AND usuario_u = $7
     RETURNING id, nombres, apellidos, correo, telefono, biografia, updated_at`,
    [nombres, apellidos, telefono, correo, biografia, req.sesionUniv.sk, req.sesionUniv.userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Perfil no encontrado.' });
  res.json(rows[0]);
}));

// ── Cambiar contraseña: valida la actual, hashea la nueva ───────────
router.post('/me/password', asyncHandler(async (req, res) => {
  const { passwordActual, passwordNueva } = req.body;
  if (!passwordNueva || passwordNueva.length < 8) {
    return res.status(422).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  }
  const { rows } = await query(
    `SELECT id, password_hash FROM univ_usuarios_perfil WHERE institucion_sk = $1 AND usuario_u = $2`,
    [req.sesionUniv.sk, req.sesionUniv.userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Perfil no encontrado.' });
  const actual = rows[0];

  // Si ya existe un hash previo, se exige la contraseña actual correcta.
  // Si es la primera vez que este perfil define contraseña (migración
  // desde el sistema K-12), se permite establecerla sin este chequeo.
  if (actual.password_hash) {
    if (!passwordActual) return res.status(422).json({ error: 'Debe indicar su contraseña actual.' });
    const coincide = await bcrypt.compare(passwordActual, actual.password_hash);
    if (!coincide) return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
  }

  const nuevoHash = await bcrypt.hash(passwordNueva, SALT_ROUNDS);
  await query(
    `UPDATE univ_usuarios_perfil SET password_hash = $1, password_actualizada_at = now() WHERE id = $2`,
    [nuevoHash, actual.id]
  );
  registrarEvento(req, 'cambio_password', { entidadTipo: 'univ_usuarios_perfil', entidadId: actual.id });
  res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente.' });
}));

// ── Foto de perfil — sube el archivo a Cloudinary y guarda solo la URL ──
// El frontend manda multipart/form-data con el campo "foto". Nunca se
// guarda el binario ni un Base64 en PostgreSQL — solo la secure_url que
// devuelve Cloudinary, que es justo lo que evita el consumo de tráfico
// desbocado descrito en el problema original.
router.post('/me/foto', uploadMemoria.single('foto'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(422).json({ error: 'No se recibió ningún archivo.' });
  const resultado = await subirBufferACloudinary(req.file.buffer, {
    folder: `gestor-yc/${req.sesionUniv.sk}/perfiles`,
    resourceType: 'image',
  });
  const { rows } = await query(
    `UPDATE univ_usuarios_perfil SET foto_url = $1 WHERE institucion_sk = $2 AND usuario_u = $3 RETURNING id, foto_url`,
    [resultado.url, req.sesionUniv.sk, req.sesionUniv.userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Perfil no encontrado.' });
  res.json(rows[0]);
}));

// También se acepta una URL ya subida por el flujo genérico existente
// (POST /api/inetis/upload) para no duplicar lógica de subida.
router.patch('/me/foto-url', asyncHandler(async (req, res) => {
  const { fotoUrl } = req.body;
  if (!fotoUrl) return res.status(422).json({ error: 'fotoUrl es obligatoria.' });
  const { rows } = await query(
    `UPDATE univ_usuarios_perfil SET foto_url = $1 WHERE institucion_sk = $2 AND usuario_u = $3 RETURNING id, foto_url`,
    [fotoUrl, req.sesionUniv.sk, req.sesionUniv.userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Perfil no encontrado.' });
  res.json(rows[0]);
}));

export default router;
