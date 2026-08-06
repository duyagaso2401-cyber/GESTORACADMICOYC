# Gestor Académico YC v2.6

App web de gestión académica (instituciones educativas colombianas). SPA con vanilla JS servida por Express + Vite. Persistencia en PostgreSQL (Neon) via `DATABASE_URL`.

## Stack
- **Frontend:** HTML/CSS/JS vanilla, Bootstrap 5, Chart.js, jsPDF, SheetJS
- **Backend:** Node.js + Express (`server.js`)
- **Base de datos:** PostgreSQL — tabla `inetis_storage (sk TEXT PK, data JSONB, updated_at TIMESTAMPTZ)`
- **Dev server:** Vite (puerto 5000)
- **Producción:** `npm run build` + `npm start` (puerto 4173 o `$PORT`)

## Cómo ejecutar

### Desarrollo
```bash
npm run dev   # Vite dev server en puerto 5000
```

### Producción (Render / Replit Deploy)
```bash
npm run build  # genera dist/
npm start      # Express sirve dist/ + API en $PORT
```

## Variables de entorno requeridas
- `DATABASE_URL` — cadena de conexión PostgreSQL (Neon). Gestionada automáticamente por Replit.
- `SESSION_SECRET` — secreto para sesiones (ya configurado).
- `PORT` — puerto del servidor (opcional, default 4173 en producción).

## Arquitectura API (`/api/inetis/*`)
Todos los endpoints son manejados **localmente** por `server.js` — no hay proxy externo (se eliminó para evitar bucles 502).

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/inetis/db?sk=<clave>` | Leer dato JSON de la BD |
| POST | `/api/inetis/db` | Guardar `{ sk, data }` en la BD |
| GET | `/api/inetis/gestordb` | Leer base gestora global |
| POST | `/api/inetis/gestordb` | Guardar base gestora `{ data }` |
| GET | `/api/inetis/events` | SSE tiempo real |
| POST | `/api/inetis/notify` | Registrar notificación |
| GET | `/api/inetis/notify` | Listar notificaciones |
| POST | `/api/inetis/notify/seen` | Marcar notificaciones leídas |

## Módulos del frontend (`public/modules/`)
- `00-seed-data.js` — datos semilla
- `01-proteccion.js` — protección/autenticación
- `02-sheetjs-loader.js` — carga de SheetJS
- `03-app-core.js` — núcleo principal de la app
- `04-ficha-matricula.js` — ficha de matrícula
- `05-pdf-ficha-blanco.js` — generación PDF
- `06-documentos-y-resto.js` — documentos y módulos adicionales

## User preferences
- Todo debe comunicarse en español.
