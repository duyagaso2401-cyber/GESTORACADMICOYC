# Gestor Académico YC

## Project Overview
Gestor Académico YC v2.6 — a Spanish-language academic management web app for Colombian schools. Manages grades, students, descriptors (learning outcomes), attendance, reports, and more across multiple institutions. Runs entirely as a static frontend; data is persisted to localStorage locally and synced to a PostgreSQL backend (Neon/Render) via `/api/inetis/db`.

## Stack
- **Frontend**: Vanilla HTML/JS + Bootstrap 5.3, Chart.js, jsPDF (all CDN)
- **Entry point**: `gestor-academico/dist/index.html`
- **Modules**: `gestor-academico/dist/modules/` (00–06)
  - `03-app-core.js` — main app logic, all modules, DB sync
- **Build tool**: Vite (serves the pre-built `dist/` directory)
- **Backend API**: External Render server + Neon PostgreSQL (relative URL `/api/inetis/db`)

## How to Run
```
npm run dev
```
Serves on port 5000 via Vite. The workflow `Start application` is configured.

The 404 error in the browser console (`/api/inetis/db`) is expected when running locally on Replit without the Render backend — the app falls back to localStorage.

## User Preferences
- Do not break the PostgreSQL connection on Neon/Render
- Keep the existing project structure and stack
