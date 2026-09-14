// =====================================================================
// server/routes/university.routes.js
// PUNTO DE ENTRADA ÚNICO del módulo universitario/LMS enterprise.
// Agrega todos los sub-routers y aplica, en un solo lugar, la
// optimización de red que pide la sección 7 de la especificación:
//   - Paginación / delta-updates / ETag → ya están en utils/http.js y
//     se usan dentro de cada ruta (no hay "SELECT *" en ningún archivo).
//   - Compresión gzip/brotli → se activa a nivel de la app completa en
//     server/index.example.js (más eficiente que por-router).
//   - Rate limiting → protege contra un cliente con polling mal
//     configurado que dispare cientos de peticiones por segundo.
//
// Montaje esperado en el index.ts principal:
//   import universityRouter from './university-lms/routes/university.routes.js';
//   app.use('/api/university', universityRouter);
// =====================================================================
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler, errorHandlerUniversidad } from '../utils/http.js';
import { resolverPerfilUniversitario } from '../middleware/auth.js';

import adminRoutes from './admin.routes.js';
import academicRoutes from './academic.routes.js';
import profileRoutes from './profile.routes.js';
import lmsRoutes from './lms.routes.js';
import quizRoutes from './quiz.routes.js';
import forumRoutes from './forum.routes.js';
import workshopRoutes from './workshop.routes.js';
import attendanceRoutes from './attendance.routes.js';
import gradebookRoutes from './gradebook.routes.js';
import messagingRoutes from './messaging.routes.js';

const router = Router();

// Límite generoso para uso normal, pero que sí frena un bug de polling
// agresivo o un cliente atascado en un loop de reintentos: 300
// peticiones/minuto por IP+sesión a TODO el módulo universitario.
const limitadorGeneral = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones en poco tiempo. Espere unos segundos.' },
});

router.use(limitadorGeneral);

// NOTA: la verificación de sesión (exigirSesion / req.sesionUniv) se
// asume YA APLICADA antes de este router por el index.ts principal,
// igual que hoy hace con src/routes/university.ts. Si este paquete se
// monta en un proyecto nuevo sin ese middleware, descomenta la línea de
// abajo para usar la versión standalone incluida en middleware/auth.js:
//
// import { exigirSesionUniv } from '../middleware/auth.js';
// router.use(exigirSesionUniv);

// Traduce sesionUniv.userId (identidad legada) -> req.univPerfilId (UUID
// de univ_usuarios_perfil), auto-provisionando el perfil la primera vez.
// Debe ir DESPUÉS de la sesión y ANTES de cualquier ruta que toque
// univ_usuarios_perfil (es decir, prácticamente todas).
router.use(asyncHandler(resolverPerfilUniversitario));

router.use('/admin', adminRoutes);
router.use('/academic', academicRoutes);
router.use('/profile', profileRoutes);
router.use('/lms', lmsRoutes);
router.use('/lms', quizRoutes);
router.use('/lms', forumRoutes);
router.use('/lms', workshopRoutes);
router.use('/lms', attendanceRoutes);
router.use('/gradebook', gradebookRoutes);
router.use('/messaging', messagingRoutes);

// Manejador de errores centralizado — SIEMPRE al final, después de
// todas las rutas. Traduce errores de PostgreSQL (23505, 23503, 23514)
// a respuestas HTTP claras en vez de un 500 genérico.
router.use(errorHandlerUniversidad);

export default router;
