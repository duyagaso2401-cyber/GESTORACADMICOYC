# ✅ Checklist final — lo único que debes hacer tú

Este ZIP ya tiene el módulo universitario enterprise (LMS/SIS) **integrado directamente** dentro de tu proyecto: `src/index.ts`, `src/routes/university.ts`, el `package.json`, el `.env` y los dos frontends (`portal.html` y `universidad/index.html`) ya fueron editados. No necesitas copiar ni pegar nada a mano.

**Reemplaza tu carpeta de proyecto con esta**, conservando tu `.git/` y tu `node_modules/` actuales (este ZIP no los incluye a propósito — ver el aviso al final).

## 1. Instalar las 2 dependencias nuevas

```bash
npm install
```

Esto instalará `bcryptjs` y `nodemailer`, que ya están declaradas en `package.json`.

## 2. Ejecutar el script SQL una sola vez en tu base de datos

Contra tu base de datos de Supabase/Neon (la misma que ya usa `DATABASE_URL`):

```bash
psql "TU_DATABASE_URL_AQUI" -f sql/01_univ_lms_schema.sql
```

Es 100% seguro volver a ejecutarlo — todas las tablas usan `CREATE TABLE IF NOT EXISTS`, así que no borra ni duplica nada si ya existía.

## 3. (Opcional) Activar el envío real de correo

Abre tu `.env` y completa estas 4-5 líneas (ya están ahí, comentadas, al final del archivo):

```
SMTP_HOST=smtp.tu-proveedor.com
SMTP_PORT=587
SMTP_USER=tu_correo@tu-dominio.edu
SMTP_PASS=tu_contraseña_o_app_password
SMTP_FROM=Gestor Académico YC <no-reply@tu-dominio.edu>
```

Si las dejas comentadas, el sistema sigue funcionando normalmente — las notificaciones se siguen guardando en el Centro de Notificaciones, solo el canal de correo queda inactivo hasta que las completes.

## 4. Desplegar en Render/GitHub como siempre

```bash
npm start
```

No hay ningún paso de compilación adicional (`tsx` ejecuta el TypeScript directamente, igual que antes).

---

### Qué se integró automáticamente (no requiere ninguna acción tuya)

- `src/index.ts` — monta el nuevo router en `/api/university-lms`, reutilizando exactamente la misma sesión/token que ya usa `/api/university` (no hay un segundo sistema de login).
- `src/routes/university.ts` — se exportaron `exigirSesion` y `verificarInstitucionActiva` para que `index.ts` los reutilice (nada cambia en su comportamiento).
- `src/university-lms/` — todo el backend enterprise (46 tablas: admisiones, pensums, secciones/NRC, LMS completo, quizzes, foros, taller de pares, asistencia, gradebook con el fix de guardado por lotes, mensajería, supletorios).
- `src/university-lms/utils/email.js` — nodemailer real y estático, activado en cuanto pongas las variables `SMTP_*`.
- `gestor-academico/dist/modules/07-sync-engine.js` + `css/sync-engine.css` — motor de sincronización invisible, cargado e inicializado en **ambos** frontends (`portal.html` y `universidad/index.html`).
- `sql/01_univ_lms_schema.sql` — corregido para que **ninguna** de sus tablas choque de nombre con las tablas `univ_*` que tu prototipo universitario original ya crea automáticamente al arrancar (`src/db/index.ts`). Las 14 que coincidían se renombraron con el prefijo `univ_ent_` (ej. `univ_secciones` → `univ_ent_secciones`) — este es un fix crítico: sin él, el script SQL se habría "pisado" en silencio con tus tablas ya existentes y el módulo nuevo habría fallado en producción.

### 🆕 NUEVO: la Planilla de Calificaciones ya no parpadea ni salta de pantalla al guardar

Esto es lo que se agregó en esta segunda pasada, después de investigar a fondo `modules/03-app-core.js` (~16,700 líneas):

**Lo que encontré:** en esta Planilla, las notas NO se digitan en un campo de texto — se eligen con botones en un popup (para que funcione bien también en tablet/celular). El verdadero causante del parpadeo/salto de pantalla no era la pérdida de foco de un input, sino que **cada vez que se guardaba una nota, el sistema reconstruía TODA la aplicación** (menú, encabezado y la tabla completa con las fotos de cada estudiante) con `renderApp()`, y además mostraba un cuadro de diálogo bloqueante (`customAlert`) que había que cerrar con un clic antes de poder seguir calificando. Esto ocurría en 5 lugares: guardar una nota individual con auto-guardado activado, el botón "GUARDAR CAMBIOS" (lote), "Replicar a todos", "Replicar a seleccionados", y el guardado de "Notas de Actividades en Clase".

**Lo que cambié:** en esos 5 lugares, reemplacé la reconstrucción completa por una actualización quirúrgica del DOM — se actualizan únicamente las celdas de los estudiantes cuya nota cambió (nota, NOTA base, DEFINITIVA, y "necesita para ganar" si aplica), reutilizando exactamente las mismas fórmulas que ya usaba la tabla completa, así que el resultado visual es idéntico — solo que sin destruir y reconstruir el resto de la pantalla. El aviso de "✅ guardado" ahora es una notificación no intrusiva (la misma que ya usa la Planilla para otros mensajes) en vez de un modal que interrumpe.

**Cómo lo verifiqué:** en vez de adivinar, extraje las fórmulas reales del archivo y les hice un test automatizado que compara, celda por celda, lo que produce mi actualización quirúrgica contra lo que produce una reconstrucción completa de la tabla — para 6 estudiantes con notas distintas (aprobando, reprobando con recuperación, al límite, notas en cero, ya garantizado el año, y un caso "imposible de aprobar"), en 3 periodos distintos. Ese test encontró y me permitió corregir un error real antes de entregarte esto (un color que se quedaba "pegado" de un estado anterior en la columna "necesita para ganar" al pasar de un estudiante en riesgo a uno que ya aseguró el año). Después de la corrección, las 66 comparaciones coinciden exactamente.

**Lo que NO toqué:** el resto del archivo (asistencia, observador, horarios, etc.) sigue igual — el cambio se limitó a los 5 puntos exactos donde ocurría el guardado de notas, para no arriesgar el resto de un archivo tan grande sin necesidad.

### 🆕 NUEVO: se corrigió el error 404 en "Recuperar Contraseña" (`/api/inetis/send-email`)

Al configurar tu SMTP real de Zoho y probar "🔒 ¿Olvidó contraseña?" en el sistema K-12 original, el navegador mostraba en la consola `404 (Not Found)` en `POST /api/inetis/send-email`, y la pantalla decía "No se pudo enviar el correo automático" — aunque el correo SÍ estaba registrado.

**Lo que encontré:** el frontend K-12 (`03-app-core.js` y `06-documentos-y-resto.js`) siempre llamó a `fetch('/api/inetis/send-email', ...)` para varias funciones — recuperar contraseña (de docente/rector, de acudiente/estudiante y del Administrador General), alertas académicas automáticas a acudientes, comunicados masivos y el correo de credenciales tras una pre-matrícula — pero esa ruta **nunca fue registrada en el servidor** (`src/index.ts`). Por eso siempre devolvía 404, incluso antes de que configuraras el SMTP: el problema no era el correo registrado ni Zoho, era que el endpoint no existía. Confirmé que la búsqueda del usuario por correo sí funciona correctamente (`enviarRecuperacion()` en efecto lo encuentra); lo único que fallaba era el paso final de enviar el correo.

**Lo que agregué (nuevo, no reemplaza nada existente):**
- `src/lib/email-general.ts` — un segundo módulo de nodemailer real y estático, independiente de `src/university-lms/utils/email.js` (ese sigue sirviendo solo al Centro de Notificaciones del módulo universitario). Este nuevo módulo reutiliza las **mismas** variables `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` que ya configuraste — no hay que definir nada adicional en el `.env`.
- `src/index.ts` — se registró la ruta `POST /api/inetis/send-email` (junto a las demás rutas `/api/inetis/notify*`), que recibe exactamente `{ to, subject, text }` o `{ to, subject, html }` — el mismo formato que el frontend ya enviaba — y responde `{ ok:true }` si se envió, o `{ ok:false, error, hint }` (con código 503 si el SMTP no está configurado, o 500 si el envío falló) si no.

**Cómo lo verifiqué:** al no poder levantar aquí el servidor completo (requiere tu base de datos Neon real), extraje y probé el módulo `email-general.ts` de forma aislada, compilándolo con el mismo TypeScript del proyecto y simulando nodemailer, cubriendo los 4 escenarios reales: (1) faltan `to`/`subject` → error controlado; (2) SMTP sin configurar → `{ok:false, hint:'SMTP no configurado'}`; (3) envío exitoso → `{ok:true}` y el correo sale con el `to`/`subject`/`text` correctos; (4) SMTP configurado pero el envío falla (ej. credenciales rechazadas) → `{ok:false, hint:'Error al enviar'}` con el mensaje real del error. Los 4 casos se comportaron como se esperaba. Además, recompilé `src/index.ts` completo con TypeScript para confirmar que la ruta nueva no introdujo ningún error de sintaxis ni rompió nada existente (los únicos avisos preexistentes del compilador son de tipos internos de Drizzle en `src/db/schema.ts`, no relacionados con este cambio).

**Lo que NO toqué:** ninguna línea del frontend (`03-app-core.js`, `06-documentos-y-resto.js`) — no hacía falta, ya que ese código siempre esperó el nombre y formato de endpoint que se acaba de crear. Tampoco se tocó `src/university-lms/utils/email.js` ni el resto de rutas `/api/inetis/*`.

### 🆕 NUEVO: limpieza de avisos en la consola del navegador (`portal.html`)

Al revisar la consola del navegador tras la prueba local, aparecían 4 tipos de mensajes. Solo dos merecían corrección (los otros dos son avisos normales del navegador, sin nada que arreglar):

- **"Tracking Prevention blocked access to storage..."** (se repite varias veces) y **"[Intervention] Images loaded lazily..."** → son el propio Edge/Chrome informando sobre su función de privacidad y su optimización de carga de imágenes al usar librerías de terceros (jsPDF, Chart.js, QRCode, etc.). No indican ningún error del sistema — no se tocó nada por esto.
- **`404 (Not Found)` al cargar Sentry del navegador** (`cdn.jsdelivr.net/npm/@sentry/browser@7/build/bundle.min.js`) → sí era un enlace roto real: ese archivo prearmado nunca existió en el paquete de npm de Sentry (jsdelivr solo puede servir lo que el paquete de npm realmente trae). Sentry distribuye su bundle listo para `<script>` en su propio CDN, no en jsdelivr. **Corregido** en `gestor-academico/dist/portal.html`, apuntando ahora a `https://browser.sentry-cdn.com/8.42.0/bundle.tracing.min.js` (versión 8.42.0 para que coincida con `@sentry/node` que ya usa el servidor, y la variante "tracing" porque el `Sentry.init()` de esa misma página configura `tracesSampleRate`, que requiere esa variante). Esto solo activa el monitoreo de errores del navegador cuando configures `SENTRY_DSN` — si no lo configuras, sigue sin hacer nada, igual que antes.
- **Aviso de que `apple-mobile-web-app-capable` está obsoleto** → se agregó junto a él el meta-tag estándar `mobile-web-app-capable` (sin quitar el de Apple, que Safari/iOS todavía necesita) en `gestor-academico/dist/portal.html`. Con ambos presentes, el aviso de deprecación desaparece en Chrome/Edge y la instalación como PWA se sigue viendo igual en iPhone/iPad.

**Lo que NO toqué:** el resto de `portal.html`, y los otros 3 archivos HTML del proyecto (`index.html`, `consulta.html`, `universidad/index.html`) no tenían ninguno de estos dos problemas, así que se dejaron exactamente igual.

### 🆕 NUEVO: salto de pantalla al iniciar sesión (nombre de otra persona en la búsqueda del menú) + ícono de sincronización reubicado en el LMS

**1) Salto de pantalla al iniciar sesión, con el nombre de otro usuario en "Buscar módulo…" (barra lateral izquierda del K-12).**

Ya existía en el código una limpieza de `window._sbSearchQuery` (el texto de esa caja) al cerrar sesión y en el login por portal — pero el verdadero causante no era ese estado interno: es el **autocompletado NATIVO de Chrome/Edge**, que ignora `autocomplete="off"` en campos que detecta como "tipo usuario" y ofrece rellenar la caja con un usuario ya guardado del sitio (el del administrador, o el de una sesión anterior en ese navegador) — de ahí que apareciera "el usuario, ya sea de él o del administrador" justo después de iniciar sesión, y que ese texto disparara de inmediato el filtro de módulos, ocultando la mayoría de golpe (el "salto"). Los atributos `data-lpignore`/`data-1p-ignore` que ya tenía protegen contra 1Password/LastPass, pero no contra el autocompletado propio del navegador.

**Corregido** en `gestor-academico/dist/modules/03-app-core.js`: se le agregó a esa caja de búsqueda el truco estándar `readonly` + quitarlo al enfocar (`onfocus="this.removeAttribute('readonly')"`) — Chrome/Edge no ofrecen autocompletar un campo marcado `readonly`, y en cuanto la persona hace clic o usa Tab para llegar a la caja, se le quita esa marca y escribe con total normalidad, sin ningún cambio de comportamiento para quien sí quiere buscar un módulo.

**2) Ícono de sincronización (☁️) pegado al avatar del Asistente IA, en el LMS/Universidad — y una segunda vuelta: apareció DUPLICADO.**

Encontré la causa exacta: `universidad/index.html` nunca había definido su propio ícono `#_syncChip`, así que `07-sync-engine.js` creaba uno flotante en la esquina inferior derecha (`position:fixed;bottom:14px;right:14px`) — exactamente donde también flota el botón del Asistente IA (`bottom:20px;right:20px`), quedando ambos superpuestos. La primera corrección declaró el ícono directamente dentro de la barra superior de `universidad/app.js`, junto a "Cerrar sesión".

Esa primera corrección dejó un efecto secundario que el usuario detectó de inmediato: el ícono aparecía **duplicado** (uno junto a "Cerrar sesión" y otro chocando encima) y además aparecía en la pantalla de bienvenida (`portal.html`) **sin haber iniciado sesión**, donde no tiene nada que hacer. La causa: `SyncEngine.init()` — que se ejecuta apenas carga la página, antes de cualquier inicio de sesión y antes de que exista cualquier barra superior — llamaba de una vez a `asegurarIndicador()`, creando un ícono flotante por su cuenta sin importar si la página ya traía el suyo propio (el de `universidad/app.js`) o incluso su propio manejador nativo (el `_updateSyncChip` que ya existe en `03-app-core.js` para el sistema K-12). Resultado: dos íconos coexistiendo en el DOM a la vez, y uno de ellos visible incluso sin sesión iniciada.

**Corregido de raíz** en `07-sync-engine.js`: se quitó esa llamada anticipada de `init()`. Ahora el ícono se crea (o se reutiliza el que la pantalla ya tenga) únicamente en el momento en que de verdad hay algo que sincronizar — momento en el que la pantalla real, con su propio topbar, ya existe. Verifiqué con una prueba automatizada simulando los 3 escenarios (página sin sesión iniciada → no aparece ningún ícono; pantalla con su propio ícono ya declarado → se reutiliza ese mismo, nunca se duplica; pantalla sin ícono propio pero con barra superior → se inserta ahí, no flotando) — los 3 se comportaron correctamente.

**Lo que NO toqué:** el comportamiento del propio motor de sincronización (debounce, reintentos, etc.) es exactamente el mismo — solo cambió CUÁNDO y DÓNDE se crea el ícono visual.

### Carpetas/archivos EXCLUIDOS deliberadamente de este ZIP

`.git/`, `node_modules/`, todos los archivos/carpetas `*_RESPALDO*`, y los 3 ZIPs viejos que tenías dentro del proyecto (`GESTOR_ACADEMICO_YC_PRODUCCION.zip`, `gestor-academico-backup.zip`, `zipFile.zip`). Copia el contenido de este ZIP **sobre** tu carpeta actual en vez de borrarla, así conservas tu historial de Git y no tienes que reinstalar `node_modules` de cero salvo por los 2 paquetes nuevos.
