// ════════════════════════════════════════════════════════════════════════════
// RONDA 101 — Lista blanca de orígenes para CORS, extraída a funciones puras
// (sin Express, sin `cors`, sin acceso a variables de entorno dentro de las
// funciones) para poder probarse directamente con `npx tsx`, igual que
// login-lockout.ts. src/index.ts solo lee process.env.ALLOWED_ORIGINS y
// delega la decisión aquí.
// ════════════════════════════════════════════════════════════════════════════

// Convierte el valor crudo de la variable de entorno ALLOWED_ORIGINS
// ("https://a.com, https://b.com,,") en una lista limpia de orígenes
// (['https://a.com','https://b.com']) — recorta espacios y descarta
// entradas vacías (ej. una coma de más al final no genera un origen "").
export function construirOrigenesPermitidos(valorEnv: string | undefined | null): string[] {
  return (valorEnv || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
}

// Decide si una petición con esta cabecera "Origin" debe permitirse.
//  - Lista vacía (ALLOWED_ORIGINS sin configurar) → se permite TODO, para no
//    romper un despliegue existente que aún no la configuró (ver el aviso
//    de consola en src/index.ts).
//  - Sin "Origin" en absoluto (undefined/'') → siempre se permite: ese
//    header solo lo añaden los navegadores en peticiones cross-site; apps
//    nativas, curl, Postman o llamadas same-origin del propio servidor
//    nunca lo traen, y no tiene sentido exigirlo.
//  - Con lista configurada y un Origin presente → solo se permite si está,
//    literalmente (sin normalizar mayúsculas/barra final), en la lista.
export function esOrigenPermitido(origin: string | undefined | null, origenesPermitidos: string[]): boolean {
  if (origenesPermitidos.length === 0) return true;
  if (!origin) return true;
  return origenesPermitidos.includes(origin);
}
