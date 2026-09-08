// ============================================================
// INICIALIZACIÓN DE SENTRY — en su PROPIO archivo, cargado ANTES que
// todo lo demás (ver package.json: "--import ./src/instrument.ts").
// ------------------------------------------------------------------
// Es necesario que esté separado de index.ts, y no simplemente al
// principio de ese archivo: en un proyecto ESM (como este), TODOS los
// "import" de un archivo se resuelven y cargan ANTES de que corra
// cualquier código de ese archivo, sin importar en qué línea estén
// escritos. Eso significa que si Sentry.init() estuviera dentro de
// index.ts, para cuando esa línea se ejecutara, "express" (y todo lo
// demás que index.ts importa) ya se habría cargado por completo —
// demasiado tarde para que Sentry pueda instrumentarlo. Cargando este
// archivo por separado, ANTES que index.ts, Sentry alcanza a
// prepararse a tiempo.
// ============================================================
import 'dotenv/config';
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  tracesSampleRate: 0.1, // 10% de las peticiones, para no consumir la cuota gratuita muy rápido
});
