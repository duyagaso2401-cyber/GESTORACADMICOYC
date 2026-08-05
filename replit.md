# Gestor Académico YC v2.6

Sistema de gestión académica para instituciones educativas (Colombia). Frontend 100 % estático construido con Vite + Vanilla JS. Se conecta a un backend REST en Render (`https://gestoracadmicoyc.onrender.com/`) y usa Neon PostgreSQL **en el backend** (no aquí).

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | Vanilla JS, Bootstrap 5.3, Chart.js 4, jsPDF |
| Bundler | Vite 5 |
| Backend (externo) | API REST en Render |
| Base de datos | Neon PostgreSQL (gestionada en el backend) |

---

## Estructura de archivos

```
index.html          ← punto de entrada (fuente de Vite)
public/
  config.js         ← CONFIG.API_URL apunta al backend en Render
  modules/
    00-seed-data.js
    01-proteccion.js
    02-sheetjs-loader.js
    03-app-core.js
    04-ficha-matricula.js
    05-pdf-ficha-blanco.js
    06-documentos-y-resto.js
vite.config.js
render.yaml         ← configuración de despliegue en Render
```

Los archivos en `public/` se sirven tal cual en `/` tanto en dev como en producción (no los procesa Vite).

---

## Scripts

| Comando | Uso |
|---------|-----|
| `npm run dev` | Servidor de desarrollo local (puerto 5000) |
| `npm run build` | Genera la carpeta `dist/` lista para producción |
| `npm start` | Sirve `dist/` con `vite preview` (usa `$PORT` de Render) |

---

## Desarrollo local (VS Code)

```bash
npm install
npm run dev
# → http://localhost:5000
```

Para probar el build de producción localmente:

```bash
npm run build
npm start
# → http://localhost:4173
```

---

## Despliegue en Render

El archivo `render.yaml` define:
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start` (usa la variable `PORT` que inyecta Render)

En el dashboard de Render también puedes configurarlo manualmente con esos mismos comandos.

> **Importante:** La variable de entorno `PORT` la inyecta Render automáticamente. No es necesario definirla.

---

## User preferences

- Mantener la lógica de conexión al backend y a Neon intacta.
- No restructurar el stack ni migrar a otras herramientas sin solicitud explícita.
- Mantener compatibilidad con desarrollo local en VS Code mediante Git + push a GitHub.
