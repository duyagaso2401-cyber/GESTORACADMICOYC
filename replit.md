# Gestor Académico YC

Sistema de gestión académica multi-plataforma para instituciones educativas colombianas.

## Stack
- **Backend**: Node.js + Express + TypeScript (`src/index.ts`)
- **Frontend**: HTML/CSS/JS estático servido desde `gestor-academico/dist/`
- **Base de datos**: PostgreSQL (Neon) vía Drizzle ORM
- **IA**: Google Gemini (`gemini-2.5-flash`) — asistente "Adán"

## Cómo ejecutar
```
PORT=5000 npm run dev
```
Servidor escucha en puerto 5000. Workflow: `Start application`.

## Variables de entorno requeridas
| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión PostgreSQL (Neon) — **NO modificar** |
| `SESSION_SECRET` | Secreto de sesión |
| `GEMINI_API_KEY` | API key de Google Gemini (IA Adán) |

## Estructura del frontend
```
gestor-academico/dist/
  portal.html          ← Aplicación principal (modularizada)
  config.js            ← Configuración de URL base
  modules/
    01-proteccion.js   ← Bloqueo marca de agua + protección código fuente
    02-sheetjs-loader.js ← Carga dinámica de SheetJS con fallback CDN
    03-app-core.js     ← Lógica principal (S01–S09): auth, DB, módulos académicos
    04-ficha-matricula.js ← Modal y PDF de ficha de matrícula
    05-pdf-ficha-blanco.js ← PDF plantilla matrícula en blanco
    06-documentos-y-resto.js ← Gestión de documentos, comunicados, traslados, IA
```

## Rutas API principales
- `GET/POST /api/inetis/db` — KV store por institución
- `GET/POST /api/inetis/docs` — Documentos de estudiantes (PostgreSQL)
- `GET/POST /api/inetis/notify` — Notificaciones del sistema
- `POST /api/inetis/ai/chat` — Asistente IA Adán (streaming SSE, Gemini)
- `POST /api/inetis/ai/general` — Consulta IA sin stream
- `GET /api/inetis/events` — SSE para sincronización en tiempo real

## Notas importantes
- `API_BASE = ''` en el frontend — todas las rutas son relativas (compatible con Replit y Render)
- La conexión a Neon **nunca debe modificarse** (usa `DATABASE_URL` tal como está)
- El módulo repositorio está en `modulo-repositorio/` y se sirve en `/repositorio`

## User preferences
- Comunicación siempre en español
- No solicitar autorización ni confirmación antes de ejecutar cambios
