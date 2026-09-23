# ════════════════════════════════════════════════════════════════════════════
# RONDA 44 — DIMENSIÓN 10: Dockerfile multi-stage para GESTOR ACADÉMICO YC.
#
# IMPORTANTE (transparencia, según lo pedido explícitamente en esta ronda):
# este entorno de trabajo NO puede levantar contenedores Docker reales para
# probar esta imagen — no hay Docker Engine disponible aquí. Este archivo se
# entrega como ENTREGABLE DE INFRAESTRUCTURA listo para usar en un entorno
# que sí tenga Docker (el servidor de despliegue del cliente, GitHub
# Actions, etc.). La única verificación hecha en esta ronda fue estructural/
# sintáctica (instrucciones Dockerfile válidas, orden de stages correcto),
# NO una construcción ni ejecución real de la imagen.
# ════════════════════════════════════════════════════════════════════════════

# ---- Etapa 1: dependencias (capa cacheable) ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Etapa 2: build/runtime ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Usuario sin privilegios (no root) — buena práctica de seguridad para
# contenedores en producción.
RUN addgroup -S gestor && adduser -S gestor -G gestor

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY gestor-academico ./gestor-academico
COPY modulo-repositorio ./modulo-repositorio
COPY config.js ./config.js
COPY sql ./sql
COPY scripts ./scripts

# El proyecto no tiene paso de compilación propio (ver package.json →
# "build": "echo 'Sin paso de compilacion necesario'") — corre directamente
# con tsx (TypeScript en caliente), igual que en desarrollo/Replit.

USER gestor

EXPOSE 5000

# El backend expone /api/health o equivalente (ver src/index.ts); ajustar la
# ruta si difiere en el despliegue real.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:5000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
