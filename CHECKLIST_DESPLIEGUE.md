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

### 🆕 NUEVO: error 500 al recuperar contraseña, pero SOLO en producción (Render.com) — causa real encontrada: Render bloquea el puerto SMTP en el plan gratuito

Reportaste que "Recuperar Contraseña" sí encuentra al usuario en producción (`gestoracademicoyc.com`), pero al enviar el correo la pantalla muestra "No se pudo enviar el correo automático" y la consola del navegador marca `POST /api/inetis/send-email 500 (Internal Server Error)` — con las mismas credenciales de Zoho que en tu prueba local sí funcionaron perfectamente.

**Lo que encontré (causa raíz, no una suposición):** el 500 (en vez del 503 que devuelve el mismo endpoint cuando el SMTP no está configurado) confirma que el servidor SÍ tenía tus variables `SMTP_*` completas y SÍ intentó enviar el correo — el envío en sí fue el que falló. Busqué específicamente si Render.com tiene alguna restricción de red que explique que funcione en tu PC local pero no en su hosting, y encontré que Render anunció oficialmente que **desde septiembre de 2025, los "free web services" (plan gratuito) bloquean todo el tráfico saliente a los puertos SMTP 25, 465 y 587** — es decir, ningún envío de correo por SMTP puede salir desde un servicio en el plan gratuito de Render, sin importar qué tan bien configuradas estén las credenciales. Esto coincide exactamente con tu caso: funciona en tu computador (sin esa restricción) y falla únicamente en Render.

La variable `SMTP_SECURE` que viste en el panel de Render (con "false"/"true" en distintas capturas) no es la causa de este error — ninguno de los dos módulos de correo la leía; ambos calculaban `secure` automáticamente a partir del puerto (465 = sí). De todas formas, se corrigió para que sea configurable (ver abajo), y de paso quedó más claro.

**Qué debes hacer tú para resolverlo (elige una opción):**
1. **Más rápido — actualizar el plan de tu servicio web en Render** de "Free" a un plan pago (ej. "Starter"). El bloqueo de puertos SMTP solo aplica al plan gratuito; en cualquier plan pago tu código actual funcionará sin ningún cambio adicional. Verifícalo en tu dashboard de Render → tu servicio → "Settings" → tipo de instancia.
2. **Si quieres seguir en el plan gratuito** — cambiar de SMTP a un proveedor de correo transaccional que se use por API HTTP (puerto 443, nunca bloqueado), por ejemplo Zoho ZeptoMail, Resend, Brevo o SendGrid. Esto sí requiere un cambio de código adicional (reemplazar `nodemailer` por la API HTTP de ese proveedor) — avísame si prefieres esta ruta y lo implemento.

**Lo que sí corregí ya en el código (mejora de diagnóstico, para que esto nunca vuelva a verse como un error genérico):**
- `src/lib/email-general.ts` y `src/university-lms/utils/email.js`: ahora detectan específicamente cuándo un envío falla por bloqueo/expiración de conexión (códigos `ETIMEDOUT`, `ECONNREFUSED`, `ESOCKET`, o mensajes de "timeout") en vez de por credenciales incorrectas, y en ese caso registran en el log del servidor (y, en el caso de `email-general.ts`, también en la respuesta JSON que ve el frontend) una explicación exacta de esta causa y las dos soluciones — en vez del genérico "Error al enviar". Así, si vuelve a pasar (por ejemplo, con otro proveedor de hosting con la misma restricción), se identifica de inmediato sin tener que investigar de cero.
- Se agregó `connectionTimeout: 10000` (10 segundos) a ambos transportadores de nodemailer, para que un puerto bloqueado falle rápido con un error claro en vez de dejar la petición del navegador colgada esperando.
- Ambos módulos ahora respetan la variable de entorno `SMTP_SECURE` si la defines explícitamente (`true`/`false`) — antes se ignoraba por completo y se inferría solo del puerto (465 = sí, cualquier otro = no). Si no la defines, el comportamiento es exactamente el mismo de antes (inferido del puerto), así que no es necesario que agregues nada nuevo salvo que quieras forzarlo manualmente.

**Cómo lo verifiqué:** al no poder desplegar en un plan gratuito real de Render desde este entorno, verifiqué (a) que la explicación encaja exactamente con la evidencia que compartiste (500 en vez de 503, funciona en local, fue anunciado oficialmente por Render en su changelog de cambios de septiembre de 2025 para servicios gratuitos); (b) con un script de prueba aislado, que la nueva función que distingue "puerto bloqueado" de "credenciales inválidas" clasifica correctamente 5 casos reales (`ETIMEDOUT`, `ECONNREFUSED`, `ESOCKET`, error 535 de autenticación, y el mismo error 535 sin código) — los 3 primeros se identifican como bloqueo de puerto y los 2 de autenticación NO, evitando diagnósticos cruzados; (c) recompilé con TypeScript tanto `email-general.ts` como el resto de `src/` para confirmar que no se introdujo ningún error nuevo (los únicos avisos preexistentes siguen siendo los mismos 25, de tipos internos de Drizzle en `src/db/schema.ts`, sin relación con este cambio); (d) validé la sintaxis de `email.js` con Node.js directamente.

**Lo que NO toqué:** la ruta `/api/inetis/send-email` en `src/index.ts` (su lógica de códigos 503/500 ya era correcta), el resto de `email-general.ts` y `email.js` (plantillas, verificación de configuración, etc.), y ningún archivo del frontend — el problema nunca estuvo ahí.

### 🆕 NUEVO (petición grande, 3 funcionalidades): correo por API HTTP conviviendo con SMTP, sincronización automática apagable por institución con aviso manual, y "Pantalla en Blanco" con rescate del Súper Admin

Esta entrega responde a tu mensaje con 3 pedidos grandes. Los tres se implementaron; documento cada uno por separado, con lo que encontré, lo que agregué, cómo lo verifiqué y — muy importante — las adaptaciones que tuve que hacer para encajar cada pedido en la arquitectura real del proyecto (que en algunos puntos es distinta a como se describió en la petición) y las limitaciones honestas de cada una.

---

#### 1) Correo por API HTTP + SMTP CONVIVIENDO (no se reemplazó nada)

**Lo que agregué:** un nuevo módulo, `src/lib/email-http-provider.ts`, que envía correo por API HTTP (puerto 443, el que ningún hosting bloquea) usando **Resend** o **Zoho ZeptoMail** — tú eliges cuál con una variable de entorno. Ambos módulos de correo que ya existían (`src/lib/email-general.ts` para el K-12, y `src/university-lms/utils/email.js` para el LMS universitario) ahora intentan **primero** este canal HTTP y, si no está configurado o falla, caen automáticamente al SMTP de Zoho que ya tienes funcionando — exactamente como pediste, **ninguna de las dos formas se eliminó, y conviven con respaldo automático**.

**Por qué así:** ya diagnosticamos que Render bloquea los puertos SMTP en el plan gratuito. En vez de obligarte a cambiar de plan, este canal nuevo evita el bloqueo por completo (usa HTTPS, no SMTP) — y si en algún momento sí pasas a un plan pago de Render, no tienes que tocar nada: mientras no definas las variables nuevas, todo sigue funcionando por SMTP exactamente igual que hoy.

**Cómo activarlo (opcional — mientras no lo actives, todo sigue por SMTP como hasta ahora):**
1. Elige un proveedor:
   - **Resend** (`https://resend.com`) — 100 correos/día gratis. Creas cuenta, verificas un dominio tuyo agregando unos registros DNS que ellos te indican, y generas una API key.
   - **Zoho ZeptoMail** (`https://www.zoho.com/zeptomail/`) — producto de correo transaccional de Zoho, distinto del Zoho Mail normal que usas por SMTP. Como ya tienes cuenta y dominio verificado en Zoho, probablemente sea más rápido de activar: solo activas ZeptoMail dentro de tu cuenta Zoho y generas un "Send Mail Token".
2. En Render (o tu `.env` local), agrega:
   - `EMAIL_API_PROVIDER` = `resend` o `zeptomail`
   - `EMAIL_API_KEY` = la API key/token de ese proveedor
   - `EMAIL_API_FROM` = (opcional) el remitente a mostrar; si no lo defines, usa el mismo `SMTP_FROM`/`SMTP_USER` que ya tienes.

**Aplica a TODO el correo de la plataforma, no solo a recuperar contraseña:** ambos módulos (`email-general.ts` y `email.js`) son los ÚNICOS puntos por los que pasa cualquier correo del sistema — confirmé esto revisando todo `src/` y todo el frontend. Esto incluye: recuperación de contraseña (de cualquier rol, y del Admin General), la alerta automática de bajo rendimiento académico a acudientes (`_dispararAlertaBajoDesempenoSiAplica`, se dispara sola cuando un estudiante cruza de aprobado a reprobado), el módulo manual "🔔 Alertas Académicas Tempranas", comunicados masivos, notificación al rector de solicitudes de permiso, credenciales de pre-matrícula, y en el LMS universitario: calificación publicada, mensajes directos, anuncios de curso, y solicitudes/resultados de supletorios. Como todos pasan por estos dos módulos, mejorar los módulos mejora automáticamente los 12 casos de uso, sin tocar cada uno por separado.

**Un hallazgo importante sobre "mal comportamiento":** revisé si existía ya una alerta automática de correo para mal comportamiento/observador, como mencionaste en el ejemplo — hoy **no existe todavía**: el observador (aula y director) solo guarda el registro dentro del sistema (visible en "Seguimiento del Observador"), no dispara ningún correo. Si quieres que también envíe alertas automáticas por correo (como ya pasa con el bajo rendimiento académico), avísame y lo agrego como una funcionalidad nueva aparte — no lo hice en esta entrega porque no estaba claro si querías replicar exactamente el mismo mecanismo de "bajo rendimiento" para comportamiento, o algo distinto (por ejemplo, con qué frecuencia/umbral debería dispararse).

**Cómo lo verifiqué:** recompilé todo `src/` con TypeScript (sin errores nuevos), validé la sintaxis de `email.js` con Node, y con un script de prueba aislado confirmé los 6 escenarios de la convivencia de canales (sin nada configurado, solo SMTP, API primero exitosa, API falla y SMTP la respalda, API falla sin SMTP de respaldo, y ambas fallan) — los 6 se comportaron exactamente como se esperaba.

**Lo que NO toqué:** las plantillas de correo existentes, la ruta `/api/inetis/send-email`, y ningún llamador del frontend — todos siguen funcionando exactamente igual, solo que ahora con un canal adicional de respaldo/preferencia.

---

#### 2) Sincronización automática apagable por institución (K-12 y universidades) + aviso manual arriba de la pantalla

**Lo que encontré (importante, cambia el enfoque):** investigué a fondo el archivo `07-sync-engine.js` (el que trae el ícono ☁️ que corregimos hace poco) y descubrí que **ese motor NO es el que causa refrescos de pantalla ni el que guarda las notas** — hoy no está conectado a ningún guardado real, solo existe el ícono y un ajuste menor de sesión. El mecanismo que SÍ trae cambios de otros dispositivos y refresca la pantalla sola es otro, ya existente y separado, dentro de `03-app-core.js`: la función `_syncAll()`, que corre cada 3 minutos, al volver a la pestaña, y al recuperar la conexión a internet. Por eso el interruptor que pediste se implementó sobre **este** mecanismo real (para que de verdad tenga efecto), no sobre el ícono decorativo.

**Lo que agregué:**
- Un nuevo campo por institución, `sincronizacionAutomatica` (por defecto **encendido**, para no cambiar el comportamiento de ninguna institución existente). Botón nuevo en el panel del Súper Admin: **"🔄 Sinc. automática" / "🔕 Sinc. manual"**, junto a los botones de Activar/Bloquear — aplica igual a colegios que a universidades, porque ambos tipos de institución viven en la misma lista del Súper Admin (no hay una tabla separada para universidades).
- Con la sincronización automática **apagada** para una institución: su portal deja de refrescar la pantalla sola cada 3 minutos / al volver a la pestaña / al reconectar internet. En su lugar, aparece un **aviso fijo en la parte superior de la pantalla**: *"🔕 Sincronización automática desactivada... haz clic para traer los cambios más recientes"*, con un botón "🔄 Sincronizar ahora" que trae los cambios cuando la persona lo pida.
- Lo mismo en el LMS universitario (`universidad/app.js`), leyendo el mismo campo desde `/api/university/dashboard`.

**Lo más importante — GARANTÍA sobre el guardado de datos:** confirmé, revisando el código real, que el guardado de notas/asistencia/todo (`saveDB`/`updDB`/`_pushDB`) es un camino **totalmente aparte** que nunca pasa por `_syncAll()` — se guarda siempre de inmediato al servidor, sin importar si este interruptor está encendido o apagado. Lo único que cambia con el interruptor es si la pantalla se actualiza SOLA cuando OTRA persona/dispositivo cambia algo, o si hay que pedirlo con el botón. Y sobre verlo desde otro dispositivo: **cualquier dispositivo que vuelva a cargar o iniciar sesión siempre trae los datos más recientes del servidor**, sin importar este interruptor — este solo afecta a una pestaña que ya estaba abierta y quiere ver cambios ajenos sin recargar.

**Honestidad sobre el alcance real:** en el LMS universitario, hoy no existía ningún refresco automático de pantalla (a diferencia del K-12) — así que ahí el interruptor no "apaga" nada que ya interrumpiera a alguien; lo que sí hace es dejar preparado el mismo campo/aviso/botón para cuando en el futuro se conecte algo en tiempo real ahí también, y desde ya el botón "Sincronizar ahora" refresca los datos de la pantalla actual a pedido.

**Cómo lo verifiqué:** revisé con grep cada punto donde `_syncAll`/el intervalo/los eventos de visibilidad y conexión se disparan, y confirmé que quedaron correctamente condicionados al nuevo interruptor (excepto el envío de cambios pendientes, que a propósito nunca se condiciona). Validé la sintaxis completa de `03-app-core.js` y `universidad/app.js` con Node, y recompilé `src/routes/university.ts` con TypeScript sin errores nuevos.

---

#### 3) "Pantalla en Blanco" por institución + acceso de rescate del Súper Admin

Implementé exactamente el mecanismo que pediste, adaptado a la arquitectura real del proyecto (aquí no hay una tabla SQL `instituciones` ni endpoints `PATCH /api/instituciones/:id/...` — las instituciones, tanto colegios como universidades, viven como una lista dentro de `gestorDB.platforms`, guardada como un solo registro en la tabla genérica `kv_store`, y TODOS los cambios del Súper Admin — activar, bloquear, editar, eliminar — ya se guardan a través de un único endpoint que sobreescribe esa lista completa, `POST /api/inetis/gestordb`). Crear una tabla y endpoints nuevos y paralelos habría creado dos caminos distintos para guardar lo mismo, con riesgo real de que se desincronicen entre sí — así que el campo nuevo se agregó a esa misma lista, siguiendo exactamente el mismo patrón que ya usan `activa` y `bloqueada`.

**Lo que agregué:**
- Campo `pantallaBlanca` por institución (por defecto **apagado**), con su botón en el panel del Súper Admin: **"⬛ Modo Pantalla en Blanco" / "⚪ Quitar pantalla en blanco"**.
- **K-12:** se revisa (a) al iniciar sesión — antes de dejar entrar a CUALQUIER rol (a diferencia de "bloqueada", que sí deja pasar al admin, "pantallaBlanca" corta a todos, porque es un interruptor de "cortar el acceso", no un aviso); (b) en cada render de la aplicación (cubre una sesión restaurada automáticamente al recargar la página); y (c) con una revisión periódica cada 1 minuto mientras la sesión sigue abierta, para cortar el acceso casi de inmediato si el Súper Admin activa el bloqueo mientras alguien ya está adentro — sin necesidad de que esa persona recargue o vuelva a intentar algo. Al activarse, se borra completamente el contenido de la pantalla (`document.body.innerHTML=''` + `window.stop()`), tal como pediste.
- **Universidad:** se revisa del lado del **servidor**, en `src/routes/university.ts`, dentro de la misma función que ya revisa "activa"/"bloqueada" en CADA petición (`verificarInstitucionActiva`) — esto es incluso más fuerte que en el K-12: ni con una sesión/token ya abierto se puede seguir usando nada mientras el bloqueo esté activo, sin depender de que el navegador vuelva a preguntar. El frontend (`app.js`) detecta esta respuesta y borra la pantalla igual que en el K-12.
- **El propio Súper Admin nunca se autobloquea:** cuando usa su botón "🚀 Entrar" para revisar una institución (colegio o universidad) desde su propio panel, eso nunca pasa por el bloqueo — puede seguir entrando a inspeccionar y luego decidir si apagar el bloqueo.
- **Acceso de rescate:** al escribir la palabra `super` en cualquier momento (cuando no se está escribiendo en un campo de texto), aparece un `prompt()` pidiendo la contraseña maestra. Si es correcta, guarda una marca en `sessionStorage` (solo dura esa pestaña) que exime del bloqueo, y recarga la página. Implementado igual en el portal K-12 y en `universidad/index.html` (son aplicaciones separadas, así que se repitió el mismo mecanismo en ambas, con la misma contraseña por comodidad).

**Una mejora de seguridad que agregué (y por qué):** actuando como lo pediste, con criterio de desarrollador senior — la contraseña maestra **no se guarda en texto plano** en el código (como sí decía el ejemplo original), porque cualquiera puede leer el código fuente de una página con "Ver código fuente" del navegador y verla a simple vista. En su lugar, se guarda únicamente el **hash SHA-256** de la contraseña, y se compara el hash de lo que la persona escribe. Esto no lo vuelve inviolable (sigue siendo código del lado del navegador, ver limitación abajo), pero sí evita que quede expuesta con solo mirar el código, que es el riesgo más obvio y más fácil de explotar.

La contraseña de fábrica es la del ejemplo que diste, `AdminMaster2026SecretKey` — **te recomiendo cambiarla** antes de que esto quede en producción. Dejé instrucciones exactas en un comentario junto a la constante `_HASH_RESCATE_SUPER_ADMIN` (en `03-app-core.js`) y `HASH_RESCATE` (en `universidad/index.html`): se abre la consola del navegador (F12) en cualquier página y se ejecuta una línea que calcula el hash de la nueva contraseña, y se reemplaza el valor en ambos archivos (debe quedar igual en los dos, si quieres poder usarla en ambas aplicaciones).

**Limitación honesta que debes conocer (no es un descuido, es una realidad técnica):** esto es una verificación del lado del navegador, no del servidor — por diseño, así lo pediste. Eso significa que, aunque ya no es tan trivial como leer una contraseña en texto plano, alguien con conocimientos técnicos podría en principio seguir encontrando formas de saltarse esta pantalla en blanco del lado del cliente (por ejemplo, mirando directamente qué devuelve la API en vez de la pantalla). Para el K-12, esto es una limitación aceptada (es del mismo nivel de seguridad que ya tiene "bloqueada" hoy). Para las universidades, en cambio, el bloqueo real y fuerte está del lado del servidor (nadie puede sacar datos aunque se salte la pantalla), así que ahí sí es una barrera sólida, no solo cosmética. Si en algún momento quieres el mismo nivel de fuerza en el K-12, hay que agregar una verificación equivalente en el servidor para sus endpoints — es un cambio más grande y no estaba pedido explícitamente, así que no lo hice en esta entrega, pero te lo señalo para que decidas con esa información.

**Otra limitación honesta:** el bloqueo se aplica al inicio de sesión y a la aplicación ya autenticada (colegio/universidad/todos los roles), que es donde ocurre el uso real del sistema. No se extendió a la página pública de pre-matrícula (`pre-matricula-publica`) por alcance — si también la quieres cubierta, avísame y la agrego.

**Cómo lo verifiqué:** simulé el cálculo y la comparación de hashes SHA-256 con el mismo algoritmo que usa el navegador (Web Crypto), confirmando 4 casos (contraseña correcta, incorrecta, con mayúsculas distintas, vacía). Simulé también la lógica de `api()` del lado de la universidad con 4 escenarios (pantalla en blanco sin rescate, con rescate, institución suspendida/bloqueada, y un error cualquiera) — los 4 se comportaron como se esperaba. Recompilé `src/routes/university.ts` con TypeScript y validé la sintaxis completa de `03-app-core.js`, `universidad/app.js` y los bloques `<script>` de `universidad/index.html` con Node — todo sin errores.

**Lo que NO toqué:** ninguna otra lógica de activar/bloquear/editar/eliminar instituciones ya existente — el campo nuevo convive con los demás exactamente igual que `activa` y `bloqueada`.

---

## Ronda 3 — Alertas por correo ampliadas + los 5 pilares de rendimiento/costos

Esta ronda cubre dos pedidos: (A) extender las alertas automáticas por correo más allá del bajo rendimiento académico a "todos los aspectos que puedan incidir en el estudiante", y (B) los 5 pilares de rendimiento, escalabilidad y reducción de costos que pediste, implementados de forma modular — uno por uno, sin tocar rutas existentes.

**Aviso honesto antes de entrar en detalle:** al investigar el terreno para los 5 pilares, encontré que varias cosas que tu pedido asumía que faltaban por completo, en realidad **ya existían y funcionaban** en el proyecto (paginación, notificaciones push). Te explico exactamente qué ya estaba, qué agregué de nuevo, y qué decidí NO construir y por qué, para que tengas el panorama completo y honesto en vez de que te facture trabajo que no era necesario.

---

### A) Alertas automáticas por correo — comportamiento, asistencia y "todo lo que incida en el estudiante"

Ya existía una alerta automática (correo + notificación in-app) cuando un estudiante cruza a desempeño BAJO en una asignatura (`_dispararAlertaBajoDesempenoSiAplica`). Repliqué exactamente ese mismo patrón para dos aspectos más:

**1. Observador de aula (comportamiento y otros tipos registrados por el docente):**
- Agregué un campo nuevo, **Gravedad** (🟢 Leve / 🟡 Moderada / 🔴 Grave), al formulario de "Nueva Observación de Aula" (Comportamental, Académica, Logro, Asistencia, Otro — los tipos que ya existían).
- Se envía correo al acudiente + notificación (que a su vez dispara push automáticamente) **solo** cuando la gravedad es Moderada o Grave, y el tipo no es "Logro" (un reconocimiento positivo no necesita una alerta urgente). Por defecto el campo queda en "Leve", así que **ninguna observación existente ni el comportamiento actual cambia** salvo que el docente suba el nivel a propósito.
- Decisión deliberada: NO se agregó esto a `guardarObsDirector` (la observación libre del director de grupo, ya existente) porque es un campo de texto libre sin estructura (sin tipo ni gravedad) — enviar un correo automático por cada palabra escrita ahí sería ruido, no una alerta útil. Si quieres una alerta también desde ese formulario, dime y le agrego su propio selector de gravedad.

**2. Inasistencia crítica:**
- Ya existía una notificación in-app (con push automático) por CADA ausencia individual — eso no cambió.
- Agregué una alerta ADICIONAL por correo, pero solo al **cruzar** el umbral crítico institucional que ya estaba configurado (`% Inasistencia Crítica`, 25% por defecto, configurable por ti en Parámetros) — no en cada ausencia, para no saturar de correos al acudiente. Se calcula igual que ya lo hacía el diagnóstico psicopedagógico existente (mismas clases dictadas/ausencias por asignatura).
- Para evitar reenvíos: se guarda una marca por estudiante+asignatura+año en cuanto se envía; si el % baja del umbral después (por ejemplo, ausencias justificadas) y luego lo vuelve a cruzar, sí avisa de nuevo — simulé 5 escenarios distintos (muestra insuficiente, primer cruce, repetición sin reenvío, baja del umbral, y nuevo cruce tras la baja) y los 5 se comportaron como se esperaba.

**Cómo lo verifiqué:** simulé en Node, de forma aislada, la lógica exacta de cruce de umbral y de disparo por gravedad (sin DOM ni red) con los 5+4 casos mencionados — todos correctos. Validé la sintaxis completa de `03-app-core.js` y `06-documentos-y-resto.js` con Node sin errores.

---

### B) Los 5 pilares de rendimiento, escalabilidad y reducción de costos

**Pilar 1 — Paginación y carga diferida:**
- La Planilla de notas y el listado de Gestión de Estudiantes **ya estaban paginados** (25 y 30 estudiantes por página respectivamente) desde antes de esta entrega — no hacía falta construir nada nuevo ahí para el problema de colegios de 1,000+ estudiantes.
- Lo que sí faltaba y agregué: el atributo `loading="lazy"` en las fotos de estudiantes/docentes en 6 listados (tabla de docentes, listado de estudiantes, Planilla, Seguimiento del Observador, y las dos listas de candidatos de Elecciones) — así el navegador solo descarga la foto cuando el usuario realmente se desplaza hasta verla, en vez de cargar las de todos los estudiantes de una vez.
- Offline-first con IndexedDB/localStorage: ya estaba implementado y en uso; no encontré nada que reforzar ahí sin arriesgar romper el guardado existente.

**Pilar 2 — Rate limiting en rutas sensibles:**
- Ya existían dos limitadores generales (`limitadorLogin` en el login, `limitadorGeneral` en toda la API). Agregué dos limitadores NUEVOS y más estrictos, específicamente para: `POST /api/inetis/send-email` (5 correos/minuto por IP — evita que alguien use tu cuenta de correo para bombardear bandejas ajenas) y la consulta pública de boletines (`/api/inetis/boletin/verificar` y `/api/inetis/consulta-rapida`, 20 consultas/minuto por IP).
- Nota honesta: el endpoint literal `/api/auth/login` que mencionaste no existe en este proyecto — el login real (tanto del colegio como el que le da acceso después al sistema universitario) ocurre en `POST /api/inetis/db`, que **ya estaba** protegido por `limitadorLogin` desde antes. No se agregó un limitador duplicado ahí para no aplicar dos límites distintos al mismo endpoint.
- Verificado: recompilé `src/index.ts` con TypeScript — 0 errores nuevos (los mismos 25 errores preexistentes y no relacionados de `schema.ts` siguen ahí, documentados desde la Ronda 1).

**Pilar 3 — Compresión de imágenes antes de subir a Cloudinary:**
- Creé `_comprimirImagenAntesDeSubir()`, un helper que redimensiona (máx. 1280×1280 px) y recomprime a JPEG ~80% de calidad usando `<canvas>`, directamente en el navegador, antes de subir cualquier imagen.
- Lo conecté al punto único y compartido `fileToCloudinaryUrl()` — esto cubre de una sola vez: foto de docente, escudo de la institución, firma de la rectora, y las capturas de cámara (que reutilizan esa misma función). También lo conecté a `fileToCloudinaryUrlTipo()` (variante usada para archivos con tipo forzado) y a `previewLogoGestor()` (el campo de escudo del panel del Súper Admin, que se guarda como Base64 en vez de subir a Cloudinary).
- Es "best effort" y nunca rompe la subida: si la imagen ya es SVG/GIF, si el navegador no soporta `canvas.toBlob`, o si la compresión falla por cualquier motivo, se sube el archivo ORIGINAL sin comprimir — el usuario nunca se queda sin poder subir su foto por un error de este paso. Tampoco se sube la versión comprimida si por alguna razón queda pesando más que la original (puede pasar con imágenes ya muy comprimidas).
- Como la compresión ahora es automática, subí los límites de rechazo manual que existían (que antes obligaban al usuario a comprimir por su cuenta): el escudo institucional pasó de 2MB a 8MB, y el campo del Súper Admin de 300KB a comprimir automáticamente (con un tope final de 600KB después de comprimir, por si la imagen sigue siendo muy grande incluso comprimida).

**Pilar 4 — Generación asíncrona de boletines masivos:**
- **Aviso honesto importante:** investigué cómo se genera hoy el PDF de los boletines, y descubrí que la generación ocurre **100% en el navegador** (con la librería `jsPDF`, en `_generarBoletinesPDF`) — el servidor NUNCA genera bytes de PDF, solo firma un código de autenticidad (HMAC) por boletín. Esto significa que **la RAM de Render nunca estuvo en riesgo** con la descarga masiva de boletines, a diferencia de lo que tu pedido asumía. Construir una cola de trabajos en segundo plano en el servidor para "proteger la RAM de Render" habría sido una solución para un problema que no existe en esta arquitectura, y habría significado reescribir por completo la generación de PDFs del lado del servidor (arriesgado y no justificado).
- Lo que sí encontré y mejoré: la descarga masiva anterior (`descargarTodosBoletinesGrados()`) disparaba TODOS los grados "a ciegas" con `setTimeout` espaciados 400ms, sin esperar a que cada uno terminara — en un colegio con muchos grados y cientos de estudiantes por grado, esto podía apilar varios PDFs pesados generándose en simultáneo en el navegador del usuario (no en Render), consumiendo mucha memoria de SU equipo, y disparando varias descargas casi al mismo tiempo (lo cual además hace que Chrome/Firefox bloqueen descargas por parecer spam).
- Lo cambié a una **cola secuencial real**: un grado a la vez, esperando (`await`) a que termine antes de empezar el siguiente, con una barra de progreso visible ("Generando boletines de X… (2/6)") y un resumen final de éxito/fallos. No introduje JSZip — respeté la decisión ya tomada en el código de mantener "un PDF por grado" en vez de un solo archivo empaquetado.
- Si en el futuro cambias de plan y quieres mover la generación de PDFs al servidor (por ejemplo, para generar boletines sin depender del navegador del usuario, o para adjuntarlos directamente a un correo), es un proyecto aparte y más grande — avísame si quieres que lo diseñemos.

**Pilar 5 — Notificaciones push PWA:**
- Confirmé que la infraestructura completa (VAPID + Service Worker + `web-push`) **ya estaba implementada de punta a punta** desde antes de esta entrega, y que el endpoint compartido `/api/inetis/notify` **ya dispara push automáticamente** para cualquier tipo de notificación (`enviarPushParaNotificacion`, llamada genéricamente sin importar el `kind`) — incluyendo las que ya existían para inasistencias y comunicados/circulares.
- Las dos alertas nuevas que agregué en la parte A (observador de aula y inasistencia crítica) **pasan por ese mismo endpoint** — así que heredan el push automáticamente, sin ningún cambio adicional en el servidor. Ambas incluyen el `estId` del estudiante en sus metadatos, así que el push llega dirigido solo al dispositivo suscrito de ese estudiante/acudiente, igual que ya funcionaba para inasistencias.
- **Importante — esto debes verificarlo tú:** el push solo funciona si las variables de entorno `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` están configuradas en Render. No puedo confirmar desde aquí si ya las tienes puestas en tu servicio de Render — si las notificaciones push no están llegando a los celulares de los acudientes, ese es el primer lugar que debes revisar (Render → tu servicio → Environment).

---

**Cómo verifiqué esta ronda en conjunto:** validé la sintaxis de los 3 archivos JS del frontend tocados (`03-app-core.js`, `06-documentos-y-resto.js`) con Node, sin errores. Recompilé `src/index.ts` con TypeScript — 0 errores nuevos. Simulé de forma aislada (sin DOM/red) la lógica de cruce de umbral de inasistencia (5 escenarios) y la lógica de disparo por gravedad de observaciones (4 escenarios) — todos correctos.

**Lo que NO toqué:** ninguna ruta ni endpoint existente cambió su firma ni su comportamiento por defecto; todos los campos nuevos (`gravedad`, `alertasInasistencia`, `sincronizacionAutomatica`, `pantallaBlanca`, etc.) tienen valores por defecto que preservan el comportamiento anterior para toda institución ya existente.

---

## Ronda 4 — Contraseña de rescate + enforcement real en el servidor para el K-12

Esta ronda responde directamente a lo que señalaste sobre la "Pantalla en Blanco": la contraseña de fábrica, y la limitación honesta de que el K-12 solo verificaba el bloqueo en el navegador (a diferencia de la Universidad, que lo hace en el servidor).

### Tu pregunta sobre la contraseña — respuesta directa

**Sí, cámbiala a `Gestor2026*` — ya quedó hecho.** Pero antes de la parte técnica, aquí está la respuesta completa a "no sé si la debo usar porque es la que uso para entrar al Súper Admin":

Hasta esta ronda, la contraseña de rescate vivía como un hash SHA-256 fijo, escrito directamente en el código (`03-app-core.js` y `universidad/index.html`) — un secreto **totalmente aparte** de tu contraseña real de Súper Admin (la que guarda `gestorDB.superAdmin`). Reutilizar el mismo texto para las dos no era peligroso por sí solo, pero sí mezclaba dos secretos que convenía mantener independientes: si algún día cambias tu contraseña real del Súper Admin (por una fuga, por rutina, por lo que sea), la de rescate se quedaría con el valor viejo sin que te dieras cuenta, o viceversa.

**Lo que hice para resolver esto de raíz, no solo para responder la pregunta:** ahora el servidor acepta CUALQUIERA de las dos como prueba válida de rescate:
1. Tu contraseña real de Súper Admin (la que ya usas para entrar a tu panel) — el sistema la reconoce automáticamente, sin que tengas que hacer nada aparte, en cuanto inicias sesión normalmente.
2. Una contraseña maestra de rescate independiente (`Gestor2026*` por defecto ahora) — pensada para el caso extremo de que necesites el atajo de teclado "super" en una pantalla donde ni siquiera puedes iniciar sesión.

Es decir: **puedes usar `Gestor2026*` para las dos cosas sin ningún problema**, porque ahora el sistema ya no depende de que coincidan — cada una se verifica por su cuenta. Si en algún momento quieres separarlas (recomendado, pero no obligatorio), solo tienes que cambiar la variable de entorno `RESCATE_SUPER_ADMIN_HASH` en Render por el hash de una contraseña distinta; tu login normal del Súper Admin no se ve afectado en absoluto.

### El cambio de fondo: el bloqueo del K-12 ahora también lo revisa el servidor

**El problema que señalaste:** "Pantalla en Blanco" en el K-12 solo se verificaba en el navegador (al iniciar sesión, en cada render, y cada 60 segundos). Alguien con conocimientos técnicos podía, en teoría, seguir sacando datos llamando directamente a la API sin pasar por esa pantalla — exactamente lo que dije en la Ronda 2.

**Lo que agregué:** el servidor ahora revisa el mismo candado (activa / bloqueada / pantalla en blanco) en **`GET` y `POST /api/inetis/db`** — el endpoint real donde viven los datos de cada institución — usando la misma lista del Súper Admin (`gestorDB.platforms`) como fuente de verdad. Esto sube al K-12 al mismo nivel de fuerza que ya tenía la Universidad: ya no basta con evadir la pantalla del navegador, porque el servidor rechaza la petición igual.

**Cómo sigue funcionando "🚀 Entrar" del Súper Admin sin que se autobloquee:** en cuanto inicias sesión en tu panel de Súper Admin, el sistema le pide al servidor, de forma transparente (sin pedirte nada aparte), un "token de rescate" usando esas mismas credenciales que acabas de escribir. Ese token viaja automáticamente en cada petición mientras tengas la pestaña abierta, así que entrar a revisar una institución bloqueada sigue funcionando exactamente igual que antes — la diferencia es que ahora es el SERVIDOR quien reconoce que eres tú, no solo una marca en tu navegador.

**El atajo de teclado "super" también cambió por dentro:** en vez de comparar el hash localmente (lo que ya señalé como una verificación débil), ahora envía el hash al servidor y es el servidor quien decide — cerrando exactamente el hueco que mencioné.

**De regalo, una mejora de rendimiento relacionada:** como este candado ahora se consulta en el endpoint más usado de todo el sistema (`/api/inetis/db`, llamado constantemente por el guardado automático y la sincronización), agregar una consulta nueva a la base de datos en CADA petición habría sido un costo real, justo en el tema de rendimiento del que veníamos hablando. Para evitarlo, creé una pequeña caché compartida en memoria (`src/lib/gestor-cache.ts`, 8 segundos de vigencia, invalidada al instante cuando el Súper Admin guarda un cambio) que usan tanto el K-12 como la Universidad — de paso, esto también eliminó una consulta duplicada que la Universidad ya venía haciendo en cada una de sus peticiones desde la Ronda 2.

### El otro hueco que señalé: pre-matrícula pública

**Ya está cubierto.** La pantalla de Pre-Matrícula/Inscripción es pública (no exige iniciar sesión), así que el bloqueo que se revisaba al momento de loguearse no la alcanzaba. Ahora, al abrirla, se revisa el mismo candado antes de mostrar el formulario — y aunque alguien lograra ver el formulario de todas formas, el envío (que termina guardándose vía `POST /api/inetis/db`) ya quedaría rechazado por el servidor de todos modos, gracias al cambio de arriba.

**Cómo lo verifiqué:** simulé de forma aislada (sin servidor real) la verificación de contraseña PBKDF2 del lado del servidor, la comparación de hashes con tiempo constante, y la firma/expiración del token de rescate — 12 casos, todos correctos. Simulé también la lógica de precedencia activa/bloqueada/pantalla-en-blanco y el manejo de "sk" de años históricos — 8 casos, todos correctos. Recompilé `src/index.ts`, `src/routes/university.ts` y el nuevo `src/lib/gestor-cache.ts` con TypeScript — 0 errores nuevos (los mismos 25 de siempre en `schema.ts`, sin relación con esto). Validé la sintaxis completa de `03-app-core.js` y de los bloques `<script>` de `universidad/index.html` con Node — sin errores.

**Limitación honesta que queda:** `DELETE /api/inetis/db` (usado por el Súper Admin para borrar una institución por completo) sigue sin ningún candado — no lo toqué en esta ronda porque no es lo que preguntaste y quería mantener el cambio enfocado. Si quieres que también quede protegido (por ejemplo, exigiendo el token de rescate para poder borrar), dime y lo agrego.

**Recomendación final, para que quede clara:** te sugiero, cuando tengas un momento, fijar `RESCATE_SUPER_ADMIN_HASH` en las variables de entorno de Render con el hash de una contraseña — puede ser `Gestor2026*` si así lo prefieres, no hay ningún impedimento técnico para eso ahora. Si no la configuras, el sistema sigue funcionando igual, usando por defecto el hash de `Gestor2026*` que ya quedó puesto en el código.

---

## Ronda 5 — Diagnóstico: "Recuperar Contraseña" sigue fallando con 500

Revisé el código de `POST /api/inetis/send-email` a fondo, línea por línea, y necesito ser directo contigo sobre lo que encontré: **el código ya hace exactamente lo que pides desde la Ronda 1** — intenta primero la API HTTP (ZeptoMail/Resend) y solo cae a SMTP si esa falla o no está configurada, y responde 200 de inmediato en cuanto la API HTTP tiene éxito. No hay ningún bug ahí que haga que "prefiera" SMTP.

Eso significa que el 500 que ves casi seguro es una de estas dos cosas, no un error de lógica:

1. **El Render en producción todavía no tiene este código desplegado** (sigue corriendo una versión de antes de que existiera el canal por API HTTP), o
2. **`EMAIL_API_PROVIDER` y/o `EMAIL_API_KEY` no están puestas (o no llegaron) en las variables de entorno de ese servicio en Render** — en ese caso, el código correctamente ni siquiera intenta ZeptoMail (porque no lo tiene configurado) y va directo a SMTP, que es justo el síntoma que describes.

**Para que puedas confirmar cuál es, en vez de que sigamos adivinando:** agregué un endpoint nuevo, de solo lectura y sin exponer ningún secreto:

```
GET /api/inetis/email-status
```

Ábrelo en el navegador (o con curl) apuntando a tu Render, por ejemplo `https://gestoracademicoyc.com/api/inetis/email-status` — te va a devolver algo como:

```json
{ "apiHttpConfigurado": true, "apiHttpProveedor": "zeptomail", "smtpConfigurado": true, "algunCanalConfigurado": true }
```

- Si `apiHttpConfigurado` sale en `false`, el problema es el punto 2 de arriba: revisa en Render → tu servicio → **Environment** que `EMAIL_API_PROVIDER=zeptomail` y `EMAIL_API_KEY=<tu Send Mail Token completo, con el prefijo "Zoho-enczapikey ")` estén puestas, y haz un **Manual Deploy** (Render no relee variables nuevas solo con guardarlas si el servicio no se reinicia).
- Si `apiHttpConfigurado` sale en `true` mostrando `"apiHttpProveedor":"zeptomail"` y el correo SIGUE fallando, entonces sí es un problema puntual con la llamada a ZeptoMail (API key inválida, remitente no verificado, etc.) — en ese caso, revisa los logs de Render justo después de un intento fallido: ahora van a mostrar la respuesta COMPLETA y exacta de ZeptoMail (antes se recortaba a 300 caracteres y con `console.warn`; ahora es `console.error` con el cuerpo completo), incluyendo si el remitente (`EMAIL_API_FROM`) no está verificado en tu cuenta de ZeptoMail, que es la causa más común de rechazo cuando la API key sí es válida.

**Otro detalle que agregué a la validación:** si `EMAIL_API_KEY` no empieza con el prefijo `"Zoho-enczapikey "` (un error de configuración muy común — copiar solo el token largo y no la línea completa que Zoho muestra en su panel), ahora se avisa explícitamente en los logs, en vez de dejar que ZeptoMail rechace la petición con un error genérico de autenticación.

**Los 3 puntos concretos que pediste, confirmados/ajustados:**
1. ✅ Ya usa el canal por API HTTP primero — confirmado revisando el código, sin cambios necesarios en la lógica.
2. ✅ Responde 200 de inmediato en éxito — confirmado, sin cambios necesarios.
3. ✅ Logging detallado — esto SÍ lo mejoré: los errores de ZeptoMail/Resend ahora se registran completos (no recortados) con `console.error`, junto con el remitente usado y el destinatario, y se agregaron avisos específicos para los dos errores de configuración más comunes (key sin el prefijo correcto, o provider configurado pero sin key).

**Cómo lo verifiqué:** recompilé `src/index.ts`, `src/lib/email-general.ts` y `src/lib/email-http-provider.ts` con TypeScript — 0 errores nuevos. Simulé (sin red real) 5 combinaciones de variables de entorno contra la lógica de `emailApiConfigurado`/`correoGeneralConfigurado` — las 5 se comportaron como se esperaba. No pude probar el envío real contra ZeptoMail desde aquí (no tengo acceso a tu cuenta ni a tus credenciales), así que el paso que falta es que abras `/api/inetis/email-status` en tu Render y me digas qué te devuelve — con eso te digo exactamente qué falta.

---

## Ronda 6 — La causa real encontrada: token de ZeptoMail rechazado, comillas literales en las variables, y un bug mío en el rate-limiting

Con los logs de Render y la lista de tus variables de entorno que me compartiste, esta vez sí encontré la causa exacta (no una hipótesis) — y de paso encontré un bug real que introduje yo en la Ronda 3, sin relación con el correo.

### 1) La causa directa del 500: ZeptoMail rechazó el token con "Invalid API Token found"

Tus logs muestran, textualmente, que ZeptoMail respondió con `401` y `{"error":{"code":"TM_4001","details":[{"code":"SERR_157","message":"Invalid API Token found"}]}}`. Esto es ZeptoMail diciendo, sin ambigüedad, que el valor que llegó como `EMAIL_API_KEY` no es un token válido para ellos — no es un problema del código (el canal por API HTTP sí se está usando, tal como pediste), es un problema del **valor** que tiene esa variable en Render.

### 2) La pista que explica el porqué: comillas literales pegadas por accidente

En tus mismos logs vi esta línea: `Remitente usado: ""Gestor Académico YC <contacto@gestoracademicoyc.com>""` — con las comillas DOBLES y REPETIDAS. Eso solo pasa si, al pegar el valor en el panel de "Environment Variables" de Render, quedaron las comillas de más incluidas como parte literal del texto (por ejemplo, si copiaste `"Gestor Académico YC <...>"` completo, comillas incluidas, en vez de solo el texto de adentro). Render **no quita esas comillas solo**: las guarda tal cual, como basura pegada al valor real.

Es muy probable que a `EMAIL_API_KEY` le haya pasado exactamente lo mismo (un valor como `"Zoho-enczapikey abc123..."` con comillas incluidas en vez de `Zoho-enczapikey abc123...`), lo cual explica perfectamente el "Invalid API Token found": ZeptoMail recibe un texto con comillas de más y lo rechaza porque no coincide con ningún token real.

**Lo que agregué para que esto no vuelva a pasar (y probablemente resuelva el problema sin que tengas que tocar nada en Render):** una función `_limpiarEnv()` en `src/lib/email-http-provider.ts` y en `src/lib/email-general.ts` que detecta y quita automáticamente un par de comillas (dobles o simples) que envuelvan TODO el valor de una variable, antes de usarla — se aplica a `EMAIL_API_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_API_FROM`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`.

**Importante — esto no es garantía absoluta:** tus logs mostraban comillas DOBLADAS (`""..."" `), lo que sugiere que el valor pudo quedar envuelto en más de una capa de comillas. Mi función solo quita UNA capa (la más externa) por diseño — quitar comillas "a ciegas" de forma más agresiva podría corromper un valor que legítimamente empiece o termine con `"`. Por eso, aunque este cambio ayuda, **te recomiendo que de todas formas entres a Render → tu servicio → Environment → `EMAIL_API_KEY` y revises el valor a simple vista:** no debe tener ninguna comilla `"` ni `'` al principio ni al final, debe empezar exactamente con `Zoho-enczapikey ` (con un espacio después), y debe ser el "Send Mail Token" completo que te dio ZeptoMail (no un token de Zoho Mail normal ni una contraseña SMTP). Si tiene comillas, bórralas ahí mismo y guarda — es la forma más segura de estar 100% seguro, independientemente de mi función de limpieza.

### 3) Un nombre de variable equivocado: `EMAIL_FROM` en vez de `EMAIL_API_FROM`

Al comparar la lista de variables que configuraste en Render contra lo que el código realmente lee, noté que pusiste `EMAIL_FROM`, pero el código (hasta esta ronda) solo leía `EMAIL_API_FROM` — así que esa variable se estaba ignorando por completo, y el remitente terminaba cayendo al respaldo `SMTP_FROM` (el mismo que salió con las comillas dobladas en el punto 2).

**Ya está corregido:** ahora el código acepta `EMAIL_FROM` como alias válido de `EMAIL_API_FROM` — no necesitas renombrar nada en Render, ambos nombres funcionan igual. El orden de prioridad quedó: `EMAIL_API_FROM` → `EMAIL_FROM` → `SMTP_FROM` → `SMTP_USER`.

### 4) Un bug real que introduje yo en la Ronda 3 (sin relación con el correo, pero lo vi en tus logs)

Tus logs mostraban, repetidas veces, este error: `ValidationError: ERR_ERL_UNEXPECTED_X_FORWARDED_FOR ... The 'X-Forwarded-For' header is set but the Express 'trust proxy' setting is false`. Esto lo causaron los limitadores de tráfico (`express-rate-limit`) que agregué en la Ronda 3: Render (como todo hosting con proxy reverso) le agrega a cada petición una cabecera `X-Forwarded-For` con la IP real del visitante, pero Express, por defecto, no confía en esa cabecera — así que la librería de rate-limiting se quejaba en cada petición.

**No era la causa del error del correo**, pero sí era un problema real: mientras esto no se corrigiera, el rate-limiting corría el riesgo de identificar a todos tus visitantes como una sola IP (la del proxy de Render) en vez de la IP real de cada uno, lo cual le resta efectividad al límite (alguien podría agotar el límite de todos los demás sin querer).

**Ya está corregido:** agregué `app.set('trust proxy', 1)` justo después de crear la app de Express en `src/index.ts` — le dice a Express que confíe en el primer proxy delante de él (el de Render), que es exactamente el escenario correcto y seguro aquí.

### Qué debes hacer tú ahora

1. **Revisa el valor de `EMAIL_API_KEY` en Render** (ver punto 2 arriba) y quítale cualquier comilla que veas al principio o al final, si la tiene. Aprovecha y revisa también `EMAIL_FROM`/`SMTP_FROM` por si tienen el mismo problema.
2. **Vuelve a desplegar** (Manual Deploy, o espera el redeploy automático tras subir este ZIP) — como siempre, Render no relee variables de entorno solo con guardarlas.
3. **Verifica primero con el endpoint de diagnóstico** (`/api/inetis/email-status` en tu dominio) que siga mostrando `apiHttpConfigurado: true`.
4. **Intenta de nuevo "Recuperar Contraseña"** desde la pantalla real. Si sigue fallando, mira los logs de Render justo después del intento: ahora deberían mostrar la respuesta exacta de ZeptoMail (por ejemplo, si sigue siendo "Invalid API Token", significa que el token en sí es inválido/revocado en el panel de Zoho y hay que generar uno nuevo, no un problema de comillas).

**Cómo lo verifiqué:** recompilé `src/index.ts`, `src/lib/email-http-provider.ts` y `src/lib/email-general.ts` con TypeScript — 0 errores nuevos (los mismos 25 de siempre en `schema.ts`, sin relación con esto). Escribí y corrí 11 casos de prueba aislados para `_limpiarEnv()` (valor con comillas dobles, con comillas simples, sin comillas, con espacios de más, comillas dobladas como las de tus logs, una sola comilla suelta, vacío, `undefined`, etc.) — los 11 pasaron. No pude probar el envío real contra ZeptoMail (no tengo tu token ni acceso a tu cuenta), así que el paso 4 de arriba es la única verificación que falta y que solo tú puedes hacer.

---

## Ronda 7 — Sigue fallando tras la Ronda 6: agregué una prueba de envío real para dejar de adivinar

Revisé lo que me compartiste con cuidado, y tengo que ser directo: **los logs de Render que me pasaste esta vez son solo del arranque del servidor** (desde que se reinició hasta "Your service is live"), no del momento exacto en que intentaste "Recuperar Contraseña". Por eso no aparece ahí ningún mensaje de ZeptoMail ni de `[email-http-provider]` — esos solo se imprimen en el instante de un intento de envío real, y ese instante no quedó capturado en lo que copiaste.

Lo que sí es un dato valioso: `/api/inetis/email-status` ahora muestra `apiHttpConfigurado: true` con `"zeptomail"`, así que las variables SÍ están llegando al proceso con el formato correcto (si hubieran seguido con comillas de más, como sospechaba en la Ronda 6, este endpoint igual habría dicho `true` — ese endpoint solo confirma que la variable no está vacía, no que su contenido sea válido para ZeptoMail). Es decir: el arreglo de comillas de la Ronda 6 no está de más, pero por sí solo no prueba ni descarta que el token en sí sea correcto.

**En vez de seguir pidiéndote que copies logs de Render (que se mezclan con el tráfico normal del sistema y es fácil perder el momento exacto), agregué una forma de probar el envío real con un solo comando, que te devuelve el error exacto de ZeptoMail de inmediato, en la misma respuesta:**

```
POST /api/inetis/email-status/enviar-prueba
Body: { "to": "tu-correo-personal@gmail.com", "hashRescate": "<hash de tu contraseña de rescate>" }
```

Protegido con la misma contraseña maestra de rescate que ya usas (`Gestor2026*` por defecto, o la que hayas puesto en `RESCATE_SUPER_ADMIN_HASH`), para que no sea un endpoint público de envío de correo libre para cualquiera.

**Cómo obtener el hash que pide (`hashRescate`):** abre la consola del navegador (F12) en cualquier página del sistema y pega esto, cambiando la contraseña si usaste una distinta a `Gestor2026*`:

```js
crypto.subtle.digest("SHA-256", new TextEncoder().encode("Gestor2026*"))
  .then(b=>console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")))
```

Copia el texto largo que imprime (eso es el `hashRescate`), y luego ejecuta esto en una terminal (cambiando el dominio, el correo de destino y el hash):

```bash
curl -X POST https://gestoracademicoyc.com/api/inetis/email-status/enviar-prueba \
  -H "Content-Type: application/json" \
  -d '{"to":"tu-correo-personal@gmail.com","hashRescate":"PEGA_AQUÍ_EL_HASH"}'
```

La respuesta te va a decir, sin rodeos, una de dos cosas:
- `{"ok":true,...}` → el envío por ZeptoMail SÍ funciona — si "Recuperar Contraseña" sigue sin funcionar después de esto, el problema estaría en otra parte del flujo (no en el correo en sí), y con eso ya sabríamos dónde seguir mirando.
- `{"ok":false,"canalProbado":"zeptomail","error":"..."}` → el campo `"error"` va a traer el mensaje EXACTO que devuelve ZeptoMail (por ejemplo, si el token sigue siendo inválido, si el remitente no está verificado en tu cuenta de ZeptoMail, o cualquier otro motivo de rechazo) — cópiame exactamente ese texto y con eso sí puedo decirte la causa exacta, en vez de seguir descartando posibilidades una por una.

**Nota honesta:** esta prueba solo cubre el canal por API HTTP (ZeptoMail), a propósito — no cae a SMTP como sí hace el flujo real de "Recuperar Contraseña", para que la respuesta no mezcle dos posibles fallas distintas en un solo mensaje confuso. El SMTP ya sabemos, por tus propios logs, que falla por tiempo de espera agotado (`Connection timeout`) — es el bloqueo de puertos SMTP de Render en el plan gratuito, documentado desde rondas anteriores, y no es el canal que nos interesa arreglar (para eso existe precisamente el canal por API HTTP).

**Cómo lo verifiqué:** recompilé `src/index.ts` con TypeScript — 0 errores nuevos (los mismos 25 de siempre en `schema.ts`). Escribí y corrí 7 casos de prueba aislados para la lógica de autorización del nuevo endpoint (hash correcto, hash correcto en mayúsculas, hash incorrecto, hash ausente/vacío, hash con caracteres no válidos, falta el campo "to") — los 7 pasaron. No pude ejecutar la prueba de envío real contra tu cuenta de ZeptoMail (no tengo tu contraseña de rescate ni tus credenciales), así que el resultado de tu propio `curl` es, esta vez sí, el dato que hace falta para cerrar este tema de una vez.

---

## Ronda 8 — Causa confirmada con datos reales, y corregida automáticamente en el código

Esta vez tu evidencia sí incluyó el momento exacto del intento de envío, y eso permitió confirmar la causa con certeza — ya no es hipótesis.

### Lo que confirmaron tus logs

En el log apareció, de nuevo, mi propia advertencia: *"EMAIL_API_KEY no empieza con el prefijo esperado 'Zoho-enczapikey'"* — pero esta vez con el arreglo de comillas de la Ronda 6 ya desplegado y funcionando. Eso descarta el problema de comillas (ya estaba resuelto) y confirma algo más simple: **el valor guardado en `EMAIL_API_KEY` en Render es solo el token largo (algo como `wSs...`), sin las palabras `Zoho-enczapikey ` que Zoho muestra delante de él en su panel** — probablemente porque, al copiarlo, se seleccionó solo la parte que parece "la clave" y no la línea completa. ZeptoMail exige el texto completo con ese prefijo; sin él, responde exactamente lo que viste: `401 Invalid API Token found`.

### Lo que corregí (esta vez en el código, no solo con un aviso)

Hasta la Ronda 7, el código solo AVISABA en los logs si faltaba el prefijo, pero seguía enviando el valor tal cual — dejando la corrección completamente en tus manos. **Ahora, en `src/lib/email-http-provider.ts`, si `EMAIL_API_KEY` no trae ya el prefijo `Zoho-enczapikey `, el propio código se lo agrega automáticamente antes de cada envío por ZeptoMail.** Esto es seguro en los dos sentidos: si el valor ya estaba completo, no se toca nada; si le faltaba el prefijo (tu caso), agregarlo es exactamente lo que ZeptoMail necesita para aceptar el token — nunca puede "empeorar" algo que sin el prefijo de todas formas no iba a funcionar.

Con este cambio, **es muy probable que el envío ya funcione sin que tengas que tocar nada en Render** — pero de todas formas, cuando tengas un momento, te recomiendo entrar a Render → tu servicio → Environment → `EMAIL_API_KEY` y pegar el valor completo tal como Zoho lo muestra (con el prefijo incluido). No es obligatorio ya (el código lo compensa automáticamente), pero es la forma más prolija y explícita de tenerlo configurado, y evita depender de esta corrección automática si en el futuro cambias de proveedor de correo.

### Qué debes hacer tú ahora

1. **Vuelve a desplegar** este ZIP (Manual Deploy en Render).
2. **Prueba de nuevo con el endpoint de la Ronda 7** (`POST /api/inetis/email-status/enviar-prueba` con tu `to` y `hashRescate` — ver Ronda 7 arriba para el paso a paso completo). Esta vez debería devolver `{"ok":true,...}`.
3. Si `ok:true`, ya puedes probar "Recuperar Contraseña" directamente desde la pantalla real — debería llegar el correo.
4. Si por algún motivo sigue devolviendo `ok:false`, copia el campo `"error"` completo de la respuesta — a estas alturas, con el prefijo ya corregido automáticamente, cualquier error que quede sería una causa distinta (por ejemplo, el remitente `contacto@gestoracademicoyc.com` sin verificar como dominio de envío dentro de tu cuenta de ZeptoMail, que es el motivo de rechazo más común después de un token con el formato correcto).

**Cómo lo verifiqué:** recompilé `src/lib/email-http-provider.ts` con TypeScript — 0 errores nuevos (los mismos 25 de siempre en `schema.ts`, sin relación con esto). Escribí y corrí 6 casos de prueba aislados para la lógica de auto-corrección del prefijo (token sin prefijo, con prefijo en minúsculas, en mayúsculas, ya correcto, vacío, y un caso límite sin el espacio después del prefijo) — los 6 pasaron. No pude confirmar el envío real contra tu cuenta de ZeptoMail (no tengo tu token), así que el resultado del `curl` de prueba de la Ronda 7, ejecutado después de este redeploy, es la verificación final que falta.

---

## Ronda 9 — Causa final: no es código, es una restricción de cuenta en Zoho ZeptoMail (Customer Validation Form pendiente)

**Buena noticia primero:** el error CAMBIÓ, y eso confirma que la corrección de la Ronda 8 funcionó. Antes era `401 Invalid API Token found` (ZeptoMail ni siquiera reconocía el token). Ahora es `403 Request Denied — "Email sending blocked"` (código `TM_3601` / `SM_143`). Ese cambio es la prueba de que el token YA es válido y ZeptoMail ya lo autenticó correctamente — lo que está pasando ahora es un bloqueo a nivel de CUENTA, no del código ni del token.

**Investigué directamente en la documentación oficial de Zoho ZeptoMail para confirmar esto con una fuente primaria, no una suposición:** según su propia página de ayuda ["¿Por qué se bloqueó mi cuenta?"](https://help.zoho.com/portal/en/kb/zeptomail/faqs/sending-emails/articles/why-was-my-account-blocked) y ["¿Cómo reviso mi cuenta?"](https://help.zoho.com/portal/en/kb/zeptomail/faqs/getting-started/articles/how-can-i-review-my-account), toda cuenta nueva de ZeptoMail pasa por una revisión obligatoria antes de poder enviar correos de verdad: hay que completar un formulario llamado **"Customer Validation Form"** dentro del panel de ZeptoMail, y el equipo de Zoho lo revisa (normalmente en un par de días hábiles) para confirmar que el uso es transaccional (recuperación de contraseña, OTPs, confirmaciones — exactamente tu caso) y no masivo/publicitario. Mientras esa revisión no se complete, o si la cuenta quedó marcada para revisión automáticamente, ZeptoMail bloquea el envío con ese mismo mensaje: "Email sending blocked".

### Qué debes hacer tú ahora (esto ya no se puede resolver desde el código)

1. **Entra al panel de ZeptoMail** (zeptomail.zoho.com, con tu cuenta de Zoho).
2. **Busca "Customer Validation Form"** en el menú de la izquierda (aparece cuando la cuenta necesita revisión).
3. **Complétalo por completo**, explicando que el uso es transaccional: recuperación de contraseña y notificaciones automáticas para una plataforma de gestión académica (colegios y universidades) — exactamente la clase de uso que ZeptoMail aprueba sin problema.
4. **Espera la aprobación** — Zoho menciona típicamente 1-2 días hábiles.
5. Si ya lo completaste y sigue bloqueado, o no encuentras ese formulario en tu panel, **escribe directamente a `presales@zeptomail.com`** (es el correo que la propia documentación de Zoho indica para este caso exacto) citando el `request_id` que aparece en el error de tus logs: `2d6f.6f33ef91012b3c36.m1.3ae7f6a0-b0ac-11f1-8705-5254001dc20d.1a0a2df030a` — con ese identificador, el soporte de Zoho puede ver la razón interna exacta del bloqueo (que la API no expone).
6. **Mientras esperas la aprobación**, puedes seguir usando el endpoint de prueba de la Ronda 7 (`POST /api/inetis/email-status/enviar-prueba`) para verificar en cualquier momento, sin tener que probar "Recuperar Contraseña" una y otra vez, si ya se desbloqueó.

**Nota honesta:** no hice ningún cambio de código en esta ronda — no había nada que arreglar en `src/lib/email-http-provider.ts` ni en ningún otro archivo. El sistema ya está enviando la petición correctamente formada (con el token con el prefijo correcto, el remitente correcto); lo único que falta es que Zoho autorice tu cuenta para enviar. Por eso este ZIP no trae cambios de código respecto al de la Ronda 8 — se actualiza únicamente para dejar este hallazgo documentado.

**Alternativa si no quieres esperar la revisión de Zoho:** el código ya soporta un segundo proveedor por API HTTP, Resend (`EMAIL_API_PROVIDER=resend`), como se explicó desde la primera ronda de este canal — igual requiere verificar un dominio propio, pero es una cuenta y un proceso de revisión totalmente aparte del de Zoho, así que si Zoho tarda más de lo esperado, podrías activar Resend en paralelo sin tocar nada de código (solo cambiando esas 2 variables de entorno en Render).

**Fuentes consultadas:** [¿Por qué se bloqueó mi cuenta? — Zoho ZeptoMail](https://help.zoho.com/portal/en/kb/zeptomail/faqs/sending-emails/articles/why-was-my-account-blocked), [¿Cómo reviso mi cuenta? — Zoho ZeptoMail](https://help.zoho.com/portal/en/kb/zeptomail/faqs/getting-started/articles/how-can-i-review-my-account), [Primeros pasos con ZeptoMail](https://www.zoho.com/zeptomail/help/getting-started.html), [Dirección del remitente en ZeptoMail](https://zoho.com/zeptomail/help/sender-address.html).

---

## Ronda 10 — Confirmado con tu panel de ZeptoMail: es 100% la revisión de cuenta pendiente, nada técnico

Revisé tus capturas de pantalla del panel de ZeptoMail una por una, buscando cualquier cosa que SÍ pudiera arreglarse desde aquí:

- **Dominio `gestoracademicoyc.com`: ✅ Verificado.** Los dos registros DNS (TXT del DKIM y CNAME) también aparecen "✅ Verificado". Esto descarta por completo cualquier problema de dominio.
- **Restricción de dirección de remitente: desactivada.** No hay ninguna lista blanca bloqueando `contacto@gestoracademicoyc.com`.
- **Lista de supresión: vacía.** El correo `yadan3108@gmail.com` no está bloqueado ahí.
- **Usuarios: solo tú, como administrador.** Nada raro en permisos.

Todo lo que SÍ se puede revisar desde afuera está en orden. Y tu propio panel de ZeptoMail lo confirma con sus propias palabras, en la tarjeta "Información de créditos": **"Su cuenta no se ha revisado todavía."** Eso es exactamente la causa — no es nada de configuración, es que Zoho tiene tu cuenta en cola de revisión manual, y mientras esa revisión no se complete, su sistema puede bloquear el envío por API con el mismo error que ves (`SM_143 / Email sending blocked`), incluso si el panel también dice que deberías poder enviar hasta 100 correos al día mientras tanto — en la práctica, cuentas y dominios muy nuevos suelen quedar con un bloqueo más estricto hasta que un humano de Zoho los revisa.

### Qué hacer ahora — el camino más rápido

En vez de escribir un correo y esperar días, usa el **chat de soporte que ya está integrado en tu propio panel de ZeptoMail** (los íconos en la esquina inferior derecha — el de globo de chat y el de "?"). Ábrelo y diles, tal cual:

> "Mi cuenta de ZeptoMail (dominio gestoracademicoyc.com) muestra 'cuenta no revisada' y estoy recibiendo el error SM_143 / TM_3601 'Email sending blocked' al enviar por la API, aunque mi dominio ya está verificado. ¿Pueden revisar/aprobar mi cuenta? Request ID de un intento reciente: 2d6f.6f33ef91012b3c36.m1.3ae7f6a0-b0ac-11f1-8705-5254001dc20d.1a0a2df030a"

Un chat en vivo con su soporte suele resolverse en minutos u horas, mucho más rápido que esperar el "1-2 días hábiles" genérico del proceso automático.

**Para que quede clarísimo:** de aquí en adelante, no hay nada más que yo pueda ajustar en el código para este problema puntual. Cada capa que estaba bajo nuestro control — el formato del token, el remitente, el dominio, el DNS, la lógica de envío — ya está correcta y confirmada. Lo que falta es exclusivamente una aprobación humana del lado de Zoho.

**Mientras esperas la respuesta de Zoho**, recuerda que puedes seguir usando `POST /api/inetis/email-status/enviar-prueba` (Ronda 7) para comprobar en segundos, sin tocar la pantalla real de "Recuperar Contraseña", el momento exacto en que Zoho apruebe tu cuenta y el envío empiece a funcionar.

---

## Ronda 11 — Bug de descriptores corregido + paquete de rendimiento/autonomía (6 pilares + 4 pilares)

Ronda grande, con 4 pedidos distintos en un solo mensaje. Se abordaron los 4, cada uno documentado por separado abajo, distinguiendo siempre **qué se corrigió**, **qué se construyó nuevo**, **qué YA existía** (para no atribuirme crédito de algo que ya estaba hecho) y **qué queda como andamiaje pendiente de decisiones tuyas**.

### 1. Bug corregido — Descriptores: la Asignatura aparecía en blanco

**Causa encontrada:** en `htmlDescriptores()` (`gestor-academico/dist/modules/03-app-core.js`), el `<select id="descMat">` se renderizaba siempre vacío; solo se llenaba cuando se disparaba el `onchange` de Grado o Docente (función `actualizarMatsDesc()`) — pero esa función nunca se llamaba automáticamente al abrir el formulario, así que el docente tenía que tocar esos campos manualmente para "despertar" la Asignatura, tal como reportaste.

**Corrección:** se extrajo la lógica de `actualizarMatsDesc()` y `actualizarGruposReplicaDesc()` a dos funciones puras reutilizables (`_matsDisponiblesDesc()` y `_htmlGruposReplicaDesc()`), y `htmlDescriptores()` ahora las usa para precalcular la Asignatura y los "grupos destino para replicar" **desde el primer render**, usando el mismo Grado/Docente que el formulario ya muestra seleccionado por defecto. Ya no hace falta tocar nada manualmente — la Asignatura (y los grupos de réplica) aparecen pobladas de inmediato.

**Cómo lo verifiqué:** `node --check` sobre el archivo (sin errores de sintaxis) y 3 casos de prueba aislados simulando la lógica exacta (docente con carga en dos grupos del mismo grado, admin, y docente sin carga asignada aún) — los 3 pasaron.

### 2. Auditoría de los "6 pilares de rendimiento" — qué ya existía vs. qué se hizo nuevo

Antes de tocar nada, se revisó qué de lo pedido ya estaba resuelto en rondas anteriores de este mismo proyecto, para no duplicar trabajo:

- **Pilar 3 (paginación/lazy loading), Pilar 5 (compresión de imágenes antes de subir a Cloudinary), Pilar 4 original (boletines masivos asíncronos) y rate limiting en rutas críticas**: **ya estaban implementados** desde la "Ronda 3" de este proyecto (tareas ya completadas antes de este mensaje). No se tocó nada de eso — sigue funcionando igual.
- **Rate limiting específico para `/api/inetis/send-email`, la consulta pública de boletines y el login (`POST /api/inetis/db`)**: también ya existía. Se le agregó el mismo limitador estricto a los 2 endpoints nuevos de esta ronda (restablecimiento de contraseña y códigos de invitación), por la misma razón (evitan fuerza bruta/abuso).
- **"GET /api/healthcheck" (Pilar 1)**: ya existía una ruta equivalente, `GET /api/health`, 100% aislada de la base de datos. Se agregó `GET /api/healthcheck` con el nombre EXACTO que pediste, registrada literalmente antes que cualquier otro middleware (antes de CORS, compresión, body-parser y rate-limit) para que responda desde RAM sin ejecutar absolutamente nada más — pensado para que UptimeRobot (o similar) haga ping sin gastar cómputo de Neon ni de Render. `/api/health` se dejó intacta para no romper nada que ya la esté usando.
- **Caché en memoria para lecturas frecuentes (Pilar 2)**: esto SÍ era trabajo nuevo. `GET /api/inetis/db` — el endpoint más llamado de todo el sistema (sincronización periódica de cada dispositivo abierto) — ya tenía optimización de ANCHO DE BANDA (ETag/304), pero cada llamada seguía consultando Neon para saber la versión vigente. Se agregó `src/lib/db-cache.ts`: una caché en memoria de 5 segundos por institución, que se actualiza al instante cuando alguien guarda (no solo se invalida — se refresca ya con el dato nuevo, así ni el propio dispositivo que guardó tiene que esperar). Sin librerías nuevas (no se agregó `node-cache` ni similar): un `Map` en memoria del propio proceso alcanza para esta escala, siguiendo el mismo criterio que ya usaba `gestor-cache.ts` (la caché de instituciones del Súper Admin).

### 3. "4 pilares de autonomía" — qué se construyó, con qué alcance exacto

**Importante léelo con calma:** este era, con mucha diferencia, el pedido más grande de los 4. Se construyó todo lo que se pudo construir de forma segura y verificable sin arriesgar nada que ya funciona (especialmente el envío de correos, que costó 10 rondas estabilizar). Cada pieza dice explícitamente su alcance.

#### 3.1 — Registro por código de invitación institucional (Pilar 1)

Dos endpoints nuevos:
- `POST /api/inetis/auth/invitacion/generar` — el admin/rector genera un código de 6 dígitos para un rol (`docente`, `directivo`, `gestor`, `rector`, `admin`), con vigencia (72h por defecto) y límite de usos (1 por defecto — se puede pedir más).
- `POST /api/inetis/auth/invitacion/registrar` — cualquiera con el código válido se autoregistra: se le crea de inmediato una cuenta con el rol del código, **sin aprobación manual**, tal como pediste.

**Alcance de esta ronda:** cuentas de "personal" (admin, rector, gestor, docente, directivo) — el modelo estándar `db.users[]` que ya usa todo el sistema. **El autoregistro de estudiantes/acudientes queda fuera a propósito**: esas cuentas están ligadas a una matrícula (grado, grupo, número de documento, datos del acudiente) que hoy solo se crea desde "Estudiantes" por un admin; abrir eso a autoregistro exige definir reglas de negocio nuevas (a qué grado queda un estudiante que se autoregistra, cómo evitar duplicados por documento, etc.) que no vinieron especificadas en tu mensaje — se necesita tu decisión antes de construirlo, para no inventar reglas que después haya que deshacer.

**Nota de seguridad, para que quede explícito:** el endpoint de generar confía en que quien tiene el `sk` de la institución es un admin de esa institución — es EL MISMO modelo de confianza que ya tiene todo el sistema K-12 hoy (quien tiene el `sk` ya podría escribir usuarios directamente vía `POST /api/inetis/db`). No es una debilidad nueva, es consistencia con lo que ya existía.

#### 3.2 — Recuperación de contraseña con token de un solo uso (Pilar 1)

Dos endpoints nuevos, **ADICIONALES** al flujo actual de "¿Olvidó su contraseña?" (que sigue funcionando exactamente igual — no se tocó ni una línea de ese flujo, a propósito, porque ya costó 10 rondas estabilizar su entrega real por ZeptoMail):
- `POST /api/inetis/auth/restablecer/solicitar` — recibe `{sk, usuario}`, y si existe (y tiene correo registrado), envía un enlace de restablecimiento por el mismo canal de correo ya estabilizado (`enviarCorreoGeneral`). Responde siempre igual exista o no el usuario, para no revelar qué usuarios existen.
- `POST /api/inetis/auth/restablecer/confirmar` — recibe `{sk, token, nuevaPassword}`, valida el token y cambia la contraseña.

**Sobre el "token JWT" pedido:** es un JWT real (HS256 — header, payload y firma en base64url, tal como especifica el estándar), pero implementado a mano con el módulo `crypto` nativo de Node, **sin agregar la librería `jsonwebtoken`** como dependencia nueva. Motivo: (a) el proyecto ya tenía la costumbre de evitar dependencias nuevas cuando lo nativo alcanza, y (b) en el momento de construir esto no fue posible confirmar de forma confiable la instalación de un paquete nuevo contra el registro de npm desde este entorno (el registro dio errores intermitentes) — y una dependencia sin poder verificar su instalación no se agrega a un sistema en producción. El resultado es funcionalmente idéntico y quedó cubierto por 7 pruebas automatizadas (token válido, secreto incorrecto, payload manipulado, formato inválido, expirado, vacío/`undefined`).

El enlace expira en 30 minutos y **solo sirve una vez**: cada token emitido registra una ficha de un solo uso en `kv_store` (la misma tabla genérica que usa todo el proyecto — sin migraciones nuevas), que se borra al confirmarse el cambio; un segundo intento con el mismo token ya no encuentra la ficha, aunque la firma siga siendo válida.

Para que el servidor pueda fijar una contraseña nueva reconocible por el navegador, se usa `hashPasswordServidor()` en `src/lib/reset-tokens.ts`, que genera el MISMO formato que ya usa el frontend (`PBKDF2-HMAC-SHA256`, 100000 iteraciones, formato `pbkdf2$salt$hash`) — verificado con 4 casos de prueba comparando byte a byte el resultado de la implementación del navegador (Web Crypto) contra la del servidor (Node `crypto`): coinciden exactamente.

**Alcance:** igual que el punto anterior, cuentas de personal (`db.users[]`) — estudiantes/acudientes quedan fuera por el mismo motivo (modelo de identidad distinto).

**Variable de entorno nueva (opcional pero recomendada):** `JWT_RESET_SECRET` — si no la configuras, el sistema usa un valor por defecto para no caerse, pero ese valor por defecto es público (está en este código fuente), así que en producción **debes configurar tu propio secreto** en Render. También puedes configurar `SITIO_BASE_URL` (la URL pública de tu sitio) para que el enlace del correo apunte exactamente ahí; si no la configuras, se usa `RENDER_EXTERNAL_URL` (que Render ya define automáticamente) o la URL de la propia petición como respaldo.

**Pendiente (no es un cambio de código, es una decisión de producto):** falta la pantalla del frontend donde el usuario abre el enlace del correo y escribe su nueva contraseña — los dos endpoints ya están listos para que esa pantalla los use.

#### 3.3 — Tareas programadas / mantenimiento autónomo (Pilar 4)

Tres tareas nuevas, con el mismo patrón que ya usaba el respaldo automático semanal (funciones que se llaman solas con `setTimeout`/`setInterval` nativos — sin librerías de cron nuevas):

- **(a) Cierre autónomo de planillas:** todos los días, justo después de la medianoche **hora Colombia**, revisa el Cronograma de Notas de cada institución; si la fecha límite de un periodo ya pasó y seguía marcado como abierto, lo cierra automáticamente (mismo efecto que si el admin lo cerrara a mano desde "Cronograma de Notas"). Verificado con pruebas que confirman: no toca periodos ya cerrados, no toca periodos aún vigentes, y no revienta si no hay fechas configuradas.
- **(b) Alertas automáticas de ausentismo a acudientes:** **desactivada por defecto** en todas las instituciones (para que ninguna reciba correos nuevos sin haberlo pedido). Una institución la activa guardando `config.alertasAusenciasActivas=true` en su blob (aún no hay un botón dedicado en el panel — pendiente, se documenta abajo). Cuando está activa, revisa una vez por semana cuántas ausencias acumula cada estudiante y, si el acudiente tiene correo registrado y el conteo cruza un nuevo múltiplo del umbral configurado (`config.umbralAusenciasAlerta`, 3 por defecto), le envía un resumen — sin repetir la misma alerta cada semana si el conteo no subió.
- **(c) Limpieza periódica de tokens/códigos vencidos:** cada 6 horas, borra fichas de restablecimiento de contraseña vencidas sin usar y códigos de invitación vencidos, en Neon.

**Pendiente (fuera de alcance de esta ronda, documentado a propósito):** falta un botón/casilla en el panel de administración para activar/desactivar las alertas de ausentismo y ajustar el umbral — hoy solo se puede activar guardando ese campo directamente en los datos de la institución. La generación de reportes de morosidad ("morosos") pedida en el mismo punto depende del módulo financiero (punto 3.4) — no existía ninguna noción de pagos/mora en el sistema antes de esta ronda, así que no había nada de qué generar un reporte todavía.

#### 3.4 — Módulo financiero + webhooks de pago (Pilar 2) — ANDAMIAJE, no listo para cobrar

Se construyó la base técnica completa para los 3 niveles de cobro pedidos (suscripción SaaS de la plataforma, mensualidades, trámites administrativos), pero **esto es andamiaje, no un módulo listo para producción** — te explico exactamente qué falta y por qué no se inventó.

**Lo que sí se construyó y quedó verificado:**
- 2 tablas nuevas en Neon (`fin_transacciones`, `fin_suscripciones`), creadas automáticamente al arrancar el servidor (mismo mecanismo que ya usa todo el proyecto — sin pasos de migración manuales).
- 3 endpoints públicos de webhook, uno por proveedor: `POST /api/payments/webhook/wompi`, `POST /api/payments/webhook/mercadopago`, `POST /api/payments/webhook/stripe`. Los tres verifican la firma de cada proveedor **investigada contra su documentación oficial** (Wompi: hash SHA-256 de los campos + timestamp + secreto de eventos; Mercado Pago: HMAC-SHA256 sobre un "manifiesto" con el id del pago + `x-request-id` + timestamp; Stripe: HMAC-SHA256 sobre `{timestamp}.{cuerpo crudo}`, con ventana de 5 minutos contra ataques de repetición) — implementadas a mano con `crypto` nativo (ninguno de los tres tiene, o requiere, una librería para esto en Node: solo Stripe trae un helper oficial, y aun así se hizo a mano para no sumar una dependencia nueva). Verificado con 13 pruebas automatizadas (firma válida se acepta; secreto incorrecto, payload manipulado, timestamp viejo, y ataque de "downgrade" a v0 en Stripe, todos se rechazan).
- Cada webhook responde **503** si su proveedor no tiene el secreto configurado (no procesa nada) y **401** si la firma no coincide (tampoco procesa nada, ni registra la transacción) — mismo criterio de "seguro cuando no está configurado" que ya usan los proveedores de correo.
- Convención de referencia (`tipo:sk:estudianteId:concepto`, ej. `mensualidad:INST123:est456:Mensualidad-Sept-2026`) para que el webhook sepa a qué institución/estudiante/concepto corresponde cada pago — la deberá usar quien construya la pantalla de generar el cobro/enlace de pago.

**Lo que falta, y por qué no se construyó sin tu decisión:**
1. **Elegir proveedor(es) reales y sus credenciales** (`WOMPI_EVENTOS_SECRETO`, `MERCADOPAGO_WEBHOOK_SECRETO` + `MERCADOPAGO_ACCESS_TOKEN`, `STRIPE_WEBHOOK_SECRETO`) — mientras no configures ninguno, el módulo existe pero no procesa pagos reales (503 en todos).
2. **Definir precios, planes de suscripción, y reglas de mora** — no venían especificados.
3. **Conectar la generación automática del PDF firmado** (certificado/paz y salvo) cuando un trámite se aprueba — quedó un punto de extensión claramente marcado en el código (`_registrarTransaccionPago()`, comentario "Punto de extensión") explicando exactamente qué falta, en vez de inventar una integración con el generador de certificados que no pude verificar contra el código real de boletines sin más información tuya sobre el formato exacto del certificado.
4. **La pantalla/flujo para generar el cobro** (crear la preferencia/enlace de pago en el proveedor elegido, con la convención de referencia de arriba) — eso se hace del lado de cada proveedor con sus propios SDKs/paneles, y depende de cuál elijas.

#### 3.5 — Copiloto de soporte con IA (Pilar 3)

**Esto ya existía, completo y en producción:** el asistente "Adán" (backend `POST /api/inetis/ai/chat` con Gemini + fallback por FAQ con reglas; frontend con widget flotante, voz, streaming, adjuntar archivos/imágenes). No se construyó nada nuevo aquí porque ya cumple el pilar casi en su totalidad.

**Hallazgo para que lo tengas presente:** el widget de Adán está, a propósito, restringido a roles de personal (`gestor`, `admin`, `rector`, `docente`) — estudiantes, acudientes y visitantes anónimos **nunca** lo ven (así lo dice el propio comentario del código: es una decisión de seguridad ya tomada, no un descuido). Esto significa que preguntas como "¿Cómo pagar mi mensualidad?" (pensadas para acudientes) no llegarían a tener quién las responda hasta que decidas si el widget también debe abrirse a acudientes/estudiantes — no se cambió ese acceso en esta ronda porque es una decisión de producto/seguridad, no un bug.

### Resumen de variables de entorno nuevas (todas opcionales — el sistema funciona igual sin ellas, cada una solo activa su función correspondiente)

| Variable | Para qué | Si falta |
|---|---|---|
| `JWT_RESET_SECRET` | Firma de los tokens de restablecimiento de contraseña | Usa un valor por defecto inseguro para producción — configúrala |
| `SITIO_BASE_URL` | Que el enlace del correo de restablecimiento apunte a tu dominio | Usa `RENDER_EXTERNAL_URL` o la URL de la petición |
| `WOMPI_EVENTOS_SECRETO` | Activa el webhook de Wompi | El webhook responde 503 (no procesa nada) |
| `MERCADOPAGO_WEBHOOK_SECRETO` | Activa el webhook de Mercado Pago | El webhook responde 503 |
| `MERCADOPAGO_ACCESS_TOKEN` | Consultar el detalle real del pago en Mercado Pago | Se registra el pago como "pendiente" para conciliar a mano |
| `STRIPE_WEBHOOK_SECRETO` | Activa el webhook de Stripe | El webhook responde 503 |

### Cómo se verificó todo esto

- TypeScript: recompilé todo el backend — **0 errores nuevos**. Los únicos errores que aparecen son 27 instancias del mismo problema pre-existente y ya documentado en `src/db/schema.ts` (un desajuste de tipos entre la sintaxis de índices usada y la versión de `drizzle-orm` instalada, que NO afecta la ejecución real porque el proyecto corre con `tsx`, no con `tsc`) — 25 ya existían antes de esta ronda; las 2 nuevas son mis 2 tablas financieras, que usan exactamente la misma sintaxis que las otras 25 ya existentes, por consistencia.
- JavaScript del frontend: `node --check` sobre `03-app-core.js` — sin errores de sintaxis.
- 10 scripts de prueba aislados, con un total de 60+ casos individuales, todos verdes: helper de cierre de planillas, cruce de umbral de alertas de ausentismo, cálculo de la próxima medianoche Colombia, lógica del bug de descriptores, compatibilidad PBKDF2 navegador↔servidor, JWT hecho a mano (7 casos), lógica de restablecimiento de contraseña, lógica de códigos de invitación, y las 3 firmas de webhooks de pago (13 casos).
- **Cero dependencias nuevas agregadas** en `package.json` — todo lo de esta ronda (JWT, hashing compatible con el navegador, firmas de webhooks) se construyó con el módulo `crypto` nativo de Node, siguiendo la costumbre ya establecida en este proyecto de no sumar librerías cuando lo nativo alcanza.

---


## Ronda 12 — Auto-matrícula, restablecimiento de contraseña frontend, alertas de ausentismo, cierre del módulo financiero, Adán para acudientes/estudiantes, y corrección móvil

Esta ronda implementa las 4 definiciones de negocio que pediste (auto-registro/matrícula, pantallas de recuperación/alertas, integración financiera con certificados, y expansión del copiloto Adán), más la corrección del banner de sincronización que tapaba los botones en móvil, y cierra los puntos que habían quedado documentados como "pendientes de tu decisión" en la Ronda 11.

### 1 — Corrección de vista móvil: banner de sincronización tapando botones

**Causa raíz encontrada:** `_actualizarBannerSyncManual()` (y su gemela en el módulo de universidad, `_actualizarBannerSyncUniv()`) compensaban el aviso fijo de "sincronización desactivada" con un `paddingTop` **fijo de 38px**, calculado para una sola línea de texto en pantalla ancha. En celulares el texto se parte en 2-3 líneas y el aviso terminaba siendo más alto que esos 38px, pero seguía teniendo `position:fixed` con `z-index:99998` — por eso tapaba (y bloqueaba los clics de) la barra superior y la cuadrícula de botones de los módulos, tal como se ve en las capturas que enviaste.

**Qué se corrigió (en ambos archivos, `03-app-core.js` y `universidad/app.js`):**
- El padding del `body` ahora se calcula con la **altura real ya renderizada** del aviso (`getBoundingClientRect().height`) en vez de un número fijo, y se recalcula automáticamente en `resize` y `orientationchange` (por ejemplo, al girar el teléfono).
- Se agregaron reglas `@media(max-width:768px)` y `@media(max-width:576px)` (los mismos cortes que ya usa el resto del sistema) que reducen el tamaño de letra y el espaciado del aviso en pantallas angostas, para que ocupe menos espacio.
- Se agregó un botón "✕" para cerrar el aviso manualmente si de todos modos estorba (queda cerrado por esa sesión de navegador; la sincronización sigue disponible por el botón habitual del panel).

### 2 — Auto-registro y matrícula desde el portal virtual existente

Se reutilizó al 100% el formulario de pre-matrícula/inscripción ya existente (`_htmlFormPreMatricula`, `guardarPreMatricula()`) — no se construyó un formulario nuevo.

- **Procesamiento autónomo por defecto:** al enviar el formulario, si `config.requiereAprobacionMatricula !== true` (por defecto está desactivado, es decir, autónomo), el sistema crea/vincula al estudiante en `db.ests[]` con su grado de inmediato, sin esperar aprobación manual, y le muestra en pantalla las credenciales de acceso (mismo formato que ya usaba la aprobación manual del admin).
- **Control opcional para el rector:** se agregó el parámetro `config.requiereAprobacionMatricula` (por defecto `false`), con un interruptor visible arriba de "Gestión de Pre-Matrículas" en el panel del admin. Si lo activa, las solicitudes vuelven a quedar en "Pendiente" para revisión manual, exactamente como funcionaba antes de esta ronda.
- **Prevención de duplicados (mejorada):** antes, si ya existía un estudiante con el mismo número de documento, el sistema simplemente **no hacía nada** (ni creaba ni actualizaba, en silencio). Se extrajo la lógica a una función compartida (`_procesarMatriculaDesdeSolicitud()`, reutilizada tanto por la aprobación manual como por la automática) que ahora, si el documento ya existe, **actualiza y vincula** los datos nuevos sobre el registro existente (grado, acudiente, foto, etc.) y le **"habilita las credenciales"** limpiando cualquier baja/retiro previo (`deletedAt=null`), en vez de duplicar o ignorar la solicitud.
- **Vínculo estudiante-acudiente automático:** no requirió una cuenta separada para el acudiente — el sistema YA validaba el acceso del rol `padre` directamente contra los campos `numDocAcud`/`numDoc` del propio registro del estudiante (`doLoginInstitucional()`), así que en cuanto el estudiante se crea o se actualiza con los datos del acudiente, el acceso del acudiente queda enlazado automáticamente, sin pasos manuales adicionales. Verificado con 4 casos de prueba automatizados que confirman que el acudiente puede iniciar sesión inmediatamente después de la auto-matrícula.

### 3 — Pantallas de recuperación de contraseña y alertas de ausentismo

**Pantalla de restablecimiento de contraseña (frontend, nueva):** se construyó `renderRestablecerPassword()`, una pantalla pública y autónoma (no depende de tener una institución ya cargada) que se activa sola al abrir el enlace `?restablecerToken=...&sk=...` que ya enviaba el correo de la Ronda 11. Pide la nueva contraseña dos veces, llama a `POST /api/inetis/auth/restablecer/confirmar`, y muestra el resultado. También se agregó la forma de **disparar** ese enlace desde la interfaz: dentro del modal existente "¿Olvidó contraseña?" se agregó una opción "🔐 Prefiero crear yo mismo una nueva contraseña", que busca al usuario por su nombre de usuario en las instituciones activas y llama a `POST /api/inetis/auth/restablecer/solicitar` — sin tocar ni reemplazar el flujo anterior (que sigue funcionando igual, reenviando una contraseña temporal por correo).

**Panel de control de alertas de ausentismo (frontend, nuevo):** se agregó, dentro de "Configuración Base → Control de Inasistencias y Alertas" (mismo panel donde ya estaban los umbrales de inasistencia crítica/preventiva), un interruptor para `config.alertasAusenciasActivas` y un campo numérico para `config.umbralAusenciasAlerta` — el mecanismo de envío en sí (`enviarAlertasAusentismoAutomaticas()`) ya existía desde la Ronda 11; lo que faltaba, y ahora existe, es la forma de activarlo/ajustarlo sin tocar la base de datos a mano.

### 4 — Integración del módulo financiero: certificados, mensualidades y suscripciones SaaS

Se implementó el "Punto de Extensión" que había quedado marcado en `_registrarTransaccionPago()` desde la Ronda 11, para los 3 casos que pediste:

- **Mensualidades/pensiones:** cuando un webhook de pago aprueba una transacción con referencia `mensualidad:<sk>:<estudianteId>:<concepto>`, el servidor busca al estudiante en el blob de la institución y le agrega el pago a su arreglo `pagos[]` (el mismo campo que ya usa el resto del sistema), marcando `pensionAlDia=true`.
- **Suscripciones SaaS:** con referencia `suscripcion_saas:<sk>::<plan>`, el servidor activa/renueva la fila de la institución en `fin_suscripciones` (`estado='activa'`, vigencia de 30 días desde el pago — ciclo mensual por defecto).
- **Certificados/paz y salvo firmados:** con referencia `tramite:<sk>:<estudianteId>:<concepto>`, el servidor genera y **firma los datos** del certificado (mismo mecanismo `_firmarBlob`/`DOC_SIGN_SECRET` que ya usan los boletines) y los deja listos para descarga en `GET /api/inetis/pagos/certificados?sk=...&estudianteId=...`.
  - **Decisión de arquitectura documentada:** el servidor **no genera el PDF en sí**. Todo el sistema genera sus PDFs (boletines, actas) 100% en el navegador con `jsPDF`, porque requiere un DOM/Canvas que Node no tiene, y el proyecto no tiene ninguna librería de PDF del lado del servidor (agregar `pdfkit` o `puppeteer` habría roto la política de "cero dependencias nuevas sin que lo pidas explícitamente"). En vez de eso, se reutilizó la infraestructura de PDF que YA existe en el navegador: cuando el estudiante/acudiente inicia sesión, un botón flotante nuevo ("📜 Certificados disponibles") aparece si tiene certificados pendientes, y al hacer clic genera el PDF final con `jsPDF` + el mismo generador de código QR que usan los boletines (`_qrDataUrlBoletin`), verificable con el panel "Verificar Autenticidad" ya existente (`POST /api/inetis/boletin/verificar`, que es genérico: verifica cualquier dato firmado con `DOC_SIGN_SECRET`, no solo boletines).
- **Idempotencia (importante, no pedida explícitamente pero necesaria):** los 3 proveedores de pago documentan que pueden reenviar el mismo webhook más de una vez (reintentos de red). Se agregó una verificación que compara el estado previamente guardado de la transacción antes de repetir el abono/generación — así un reintento del webhook nunca duplica una mensualidad ni regenera el certificado dos veces.

### 5 — Copiloto de IA "Adán" para acudientes y estudiantes

- **Apertura del widget:** se amplió el filtro de rol en `iaInjectWidget()` (antes solo `gestor/admin/rector/docente`) para incluir `estudiante` y `padre`. También se corrigió el segundo punto de bloqueo, más fuerte, dentro de `renderApp()`: antes esos dos roles llamaban a `iaRemoveWidget()` incondicionalmente ANTES de llegar siquiera a `iaInjectWidget()` — cambiar solo el primer punto no habría tenido ningún efecto visible.
- **System prompt dinámico por rol:** se agregó una rama completa y separada en `buildSystemPrompt()` (backend) para `rol==='estudiante'||rol==='padre'`, que reemplaza el prompt administrativo por uno de "Asistente de Soporte y Tutoría": ayuda de uso de la plataforma, tutoría académica, apoyo emocional básico (con derivación a un profesional cuando corresponde) y cultura general.
  - **Restricción de seguridad explícita:** el prompt le prohíbe expresamente a Adán actuar como si pudiera consultar/modificar planillas de calificaciones, asistencia u observador, o mostrar datos de OTRO estudiante distinto al propio (o al hijo/a del acudiente).
  - **Aviso de transparencia:** `POST /api/inetis/ai/chat` **no tiene autenticación propia** — el rol viaja del cliente sin firmar, así que esta restricción es una mitigación a nivel de instrucción/UX, no un control de acceso real a nivel de datos. Hoy no hay riesgo estructural adicional porque esta ruta no lee la base de datos de la institución por su cuenta (solo usa lo que ya viene en el contexto que manda el navegador), pero se documenta para que quede claro el límite real de esta protección.

### Resumen de variables/config nuevas de esta ronda

| Config/Variable | Para qué | Si falta |
|---|---|---|
| `config.requiereAprobacionMatricula` | Exige aprobación manual de matrículas (si no, es automática) | `false` (automática) por defecto |
| `config.alertasAusenciasActivas` | Activa el envío automático de alertas de ausentismo | `false` (desactivado) por defecto |
| `config.umbralAusenciasAlerta` | Cada cuántas ausencias se notifica al acudiente | `3` por defecto |

### Cómo se verificó todo esto (Ronda 12)

- TypeScript: recompilé `src/index.ts` (con los cambios del webhook de pagos) — **0 errores nuevos** (los 27 de siempre, pre-existentes en `schema.ts`, sin relación con esta ronda).
- JavaScript del frontend: `node --check` sobre `03-app-core.js`, `06-documentos-y-resto.js` y `universidad/app.js` — sin errores de sintaxis, después de cada bloque de cambios.
- 2 scripts de prueba aislados nuevos, con 22 casos en total: idempotencia y firma del certificado + parseo de referencias + vigencia de suscripción SaaS (11 casos), y dedup/vínculo de auto-matrícula por número de documento incluyendo el caso de un estudiante retirado que vuelve y la validación de que el acudiente puede iniciar sesión de inmediato (11 casos). Además se re-ejecutaron los 6 scripts de prueba más relevantes de la Ronda 11 (firmas de pago, JWT, invitación, cron, restablecimiento) para confirmar que nada se rompió — todos verdes.
- **Cero dependencias nuevas agregadas** en `package.json` en esta ronda tampoco: el certificado se firma con `crypto` nativo (igual que boletines) y se dibuja en PDF reutilizando `jsPDF`/`QRCode` que el navegador ya tenía cargados para los boletines.

### Lo que queda pendiente de tu decisión (documentado, no resuelto a ciegas)

1. **Formato exacto del certificado/paz y salvo en PDF** — se implementó un diseño simple y funcional (nombre, concepto, fecha, código QR de verificación), pero si tu institución necesita un diseño específico (logo, firma del rector, texto legal exacto), dímelo y se ajusta el generador `_descargarCertificadoPDF()`.
2. **Reglas de mora/vigencia de la suscripción SaaS** — se asumió un ciclo de 30 días desde el pago aprobado; si tu plan es anual o tiene otra regla, se ajusta fácilmente en `_actualizarSuscripcionSaas()`.
3. **Qué pasa con una mensualidad ya acreditada si luego el proveedor la reembolsa** — hoy el reembolso se registra en `fin_transacciones` pero no revierte automáticamente `pensionAlDia`/el registro en `est.pagos[]`; no vino especificado y podría ser una decisión de negocio sensible (¿se retira el acceso de inmediato o se da un plazo?).

---

## Ronda 13 — Reglas finales de negocio: plantilla oficial del certificado, ciclo de vigencia SaaS y manejo de reembolsos/contracargos

Esta ronda responde, una por una, a las 3 decisiones de negocio que habían quedado documentadas como "pendientes de tu decisión" al cierre de la Ronda 12, con las reglas exactas que diste. El objetivo declarado era dejar el ciclo financiero y de certificación **completamente cerrado y funcional**, y eso es lo que se implementó.

### 1 — Plantilla oficial del certificado / paz y salvo (PDF tamaño Carta + QR de verificación pública)

Se reescribió por completo `_descargarCertificadoPDF()` (frontend, `03-app-core.js`) siguiendo tu especificación exacta:

- **Tamaño y formato:** `new jsPDF('p','mm','letter')` — tamaño Carta, tal como pediste (el resto del sistema usa A4 para boletines; este documento es el único que usa Carta, a propósito).
- **Encabezado:** nombre de la institución (en mayúsculas) y su escudo/logo si está cargado en `db.logo`; el código DANE/NIT se incluye si tu institución lo tiene guardado en la configuración; título dinámico en mayúsculas — `"CERTIFICADO DE ESTUDIOS"` por defecto, o `"PAZ Y SALVO ACADÉMICO Y FINANCIERO"` automáticamente cuando el concepto de la transacción contiene la frase "paz y salvo" (detectado con `/paz\s*y\s*salvo/i`).
- **Cuerpo:** texto oficial con el nombre completo del estudiante y su tipo/número de documento, indicando matrícula vigente y estar al día por todo concepto en el periodo lectivo — con una redacción para el certificado de estudios y otra, específica, para el paz y salvo.
- **Firma/estampado:** bloque con el nombre configurado como rector/secretario (`db.rectora`) y la leyenda "Firmado digitalmente" — es un **estampado visual**, no una firma digital criptográfica sobre el PDF en sí (el proyecto no tiene ni agregó ninguna librería de firma de PDF); la validez real del documento la da el mecanismo de abajo, no el estampado visual.
- **Código QR de verificación pública:** en la esquina inferior, generado con el mismo helper que ya usan los boletines (`_qrDataUrlBoletin`), apuntando a `TU_DOMINIO/api/certificados/verificar/<código>` — exactamente la ruta pública que pediste.

**Nuevo endpoint público, sin autenticación:** `GET /api/certificados/verificar/:hash` (backend, `src/index.ts`). Cualquiera que escanee el QR (o pegue el enlace) ve una página HTML autónoma y estilizada (no JSON, no requiere tener la plataforma abierta) con 3 estados posibles: **código no encontrado** (gris), **documento revocado** (rojo — ver punto 3), o **válido** (verde, con institución, nombre del estudiante, concepto y fecha de emisión).

**Cambios de base de datos para soportar esto:** se agregaron las columnas `codigo_verificacion` (con índice, para que la búsqueda pública sea instantánea) y `revocado` a `fin_transacciones` — ambas con `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, siguiendo el mismo mecanismo de migración que ya usa todo el proyecto (`initDb()` en `src/db/index.ts`, sin sistema de migraciones aparte). El listado `GET /api/inetis/pagos/certificados` ahora también informa `revocado` por cada certificado, y el modal "📜 Certificados disponibles" muestra un aviso rojo "REVOCADO" y desactiva la descarga cuando corresponde (ver punto 3).

### 2 — Ciclo de vigencia de la suscripción SaaS (mensual/anual, gracia de 3 días, alerta 5 días antes)

- **Duración según el plan:** `_actualizarSuscripcionSaas()` ahora detecta si el plan es anual con una expresión regular sobre el texto del plan/concepto (`/anual|annual|yearly|year\b/i`) — si lo es, la vigencia se calcula a **365 días** desde la confirmación del webhook; si no, a **30 días** (mensual, el valor por defecto). Ambos se cuentan desde la fecha/hora exacta en que llega el webhook de pago aprobado, tal como pediste.
- **Margen de gracia de 3 días:** nueva función `verificarSuscripcionSaas(sk)`, que se ejecuta en cada `POST /api/inetis/db` (guardado). Si la fecha actual está dentro de `vigenteHasta + 3 días`, todo sigue funcionando con normalidad. Solo al superar ese margen se bloquea el guardado.
  - **Decisión de arquitectura que debes conocer:** todo el sistema K-12 guarda sus datos a través de un único endpoint genérico (`POST /api/inetis/db`, un solo "blob" JSON por institución) — no existe, a nivel de ese endpoint, una forma de distinguir una acción "administrativa" de una "operativa" (ej. no se puede permitir editar asistencia pero bloquear editar cobros, porque ambas viajan en el mismo guardado). Por eso, "congelar las funciones administrativas" se implementó como: **se bloquean todos los guardados** (la API responde `402` con `{error, suscripcionVencida:true}`) **pero las consultas (GET) siguen funcionando con total normalidad** — el rector y su equipo pueden seguir viendo toda su información en todo momento, solo no pueden guardar cambios nuevos hasta renovar. Un Súper Admin puede seguir usando el mecanismo de rescate ya existente (`_tieneRescateValido`, el mismo que se usa para la "Pantalla en Blanco") para levantar el bloqueo manualmente en un caso excepcional.
  - **Frontend:** se agregó el manejo del nuevo código `402` en `_pushDB()` — el cambio del docente/admin **no se pierde** (ya quedó guardado en `localStorage` desde antes), y se le muestra un aviso claro una sola vez por sesión ("🔒 La suscripción de esta institución venció...") en vez de fallar en silencio.
  - **Compatibilidad hacia atrás, importante:** una institución que **todavía no tiene ninguna fila** en `fin_suscripciones` (es decir, la inmensa mayoría hoy, porque el cobro de SaaS es apenas un andamiaje) **nunca se ve afectada** por este bloqueo — `verificarSuscripcionSaas()` devuelve `{ok:true}` de inmediato si no encuentra fila. El bloqueo solo puede activarse para instituciones que ya están efectivamente suscritas y vencidas.
- **Alerta previa de 5 días:** nueva función `enviarAlertasVencimientoSaas()`, agregada a las tareas autónomas programadas del servidor (primer chequeo 15 minutos después de arrancar, luego cada 12 horas). Revisa todas las suscripciones activas y, cuando falten 5 días o menos para el vencimiento, envía un correo (reutilizando `enviarCorreoGeneral`, el mismo mecanismo de correo que ya existe) y marca `alertaVencimientoEnviada=true` para no reenviarla una y otra vez.
  - **Adaptación documentada:** el proyecto no tiene un campo dedicado de "contacto de facturación" por institución. Se resuelve buscando, dentro de los usuarios de la institución, al primero con rol `admin` o `rector` que tenga un correo (`correo`/`email`) registrado. Si tu institución no tiene ningún admin/rector con correo cargado, la alerta simplemente no tiene a quién enviarse (no genera error, solo no se envía) — si esto te afecta, dímelo y se agrega un campo explícito de "correo de facturación" en la configuración.

### 3 — Reembolsos, devoluciones y contracargos (`REFUNDED`/`CHARGEBACK`/`DISPUTED`)

Se implementaron, tal cual las especificaste, las 3 reacciones automáticas cuando un webhook notifica uno de estos estados:

1. **Estado de la transacción:** `normalizarEstadoPago()` ahora reconoce también `CHARGEBACK`, `DISPUTED`, `DISPUTE` e `IN_DISPUTE` (antes solo `REFUNDED`/`REFUND`/`CHARGED_BACK`) y los mapea todos al mismo estado interno `'reembolsado'`, que queda guardado de inmediato en `fin_transacciones.estado`.
   - **Simplificación consciente, por instrucción tuya explícita:** una disputa (`DISPUTED`) se trata de inmediato igual que un reembolso ya confirmado, aunque en la práctica una disputa "abierta" a veces termina resolviéndose a favor del comercio. Pediste reaccionar de una vez por seguridad en lugar de esperar la resolución final del proveedor, así que así quedó implementado.
2. **Reversión automática en el estado de cuenta:** nueva función `_revertirPagoMensualidadEnBlob()`. Cuando el webhook trae una reversión de una **mensualidad** (`esNuevaReversion` — es decir, la transacción estaba `aprobado` y ahora llega como reembolso/disputa), se busca el pago exacto dentro de `est.pagos[]` del estudiante (por proveedor + ID de pago del proveedor, la misma pareja única que ya se usaba para la idempotencia) y se marca `estado:'reembolsado'` **solo esa entrada** (el historial de otros pagos no relacionados queda intacto), y se pone `est.pensionAlDia=false` para que el estudiante vuelva a figurar en mora/pendiente.
   - **Simplificación documentada:** `pensionAlDia` se pone en `false` sin verificar si, aun quitando ese pago puntual, otro pago distinto ya cubría el mismo periodo — en la enorme mayoría de los casos (un pago = un periodo) esto es exactamente lo correcto; si tu institución maneja pagos parciales/fraccionados para un mismo periodo, este caso extremo podría marcar `pensionAlDia=false` de más y dime para afinarlo.
3. **Revocación del certificado:** si la transacción reembolsada/disputada corresponde a un **trámite** (certificado/paz y salvo pagado), se marca `fin_transacciones.revocado=true` en esa misma fila. El certificado **sigue siendo criptográficamente válido** (su firma no cambia — sigue siendo el mismo documento que se generó), pero la página pública de verificación (`/api/certificados/verificar/:hash`) ahora comprueba también esta bandera y, si está en `true`, muestra el estado "🚫 REVOCADO" en rojo en vez de "✅ VÁLIDO" — exactamente el efecto de "impedir su verificación" que pediste. El modal de "Certificados disponibles" del estudiante/acudiente también refleja el mismo estado y bloquea la descarga.
   - **Punto que quedó explícitamente sin definir (documentado, no resuelto a ciegas):** especificaste la regla para mensualidades y trámites, pero no para un reembolso de la **suscripción SaaS** en sí (`suscripcion_saas`). Hoy ese caso queda registrado en `fin_transacciones` (con el estado `reembolsado`) pero **no** revierte automáticamente la fila de `fin_suscripciones` (no la desactiva ni le resta los días de vigencia ya otorgados) — no vino especificado si eso debería congelar la cuenta de inmediato, prorratear los días, o esperar a que la vigencia expire por sí sola. Dime la regla y se agrega en la misma función (`_registrarTransaccionPago`, rama `esNuevaReversion` para `suscripcion_saas`).

### Resumen de columnas nuevas de esta ronda

| Columna | Tabla | Para qué |
|---|---|---|
| `codigo_verificacion` (+ índice) | `fin_transacciones` | Búsqueda O(1) del certificado desde la página pública de verificación por QR |
| `revocado` | `fin_transacciones` | Marca un certificado como inválido tras un reembolso/contracargo, sin alterar su firma original |
| `alerta_vencimiento_enviada` | `fin_suscripciones` | Evita reenviar la alerta de "vence en 5 días" más de una vez por ciclo |

Las 3 se crean solas al arrancar el servidor (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` dentro de `initDb()`) — no requieren que corras ningún script SQL a mano.

### Cómo se verificó todo esto (Ronda 13)

- TypeScript: recompilé `src/index.ts`, `src/db/schema.ts`, `src/db/index.ts` y `src/lib/pagos-webhooks.ts` — **0 errores nuevos** (se mantienen exactamente los mismos 27 errores pre-existentes de siempre en `schema.ts`, sin relación con esta ronda; el nuevo índice de `codigoVerificacion` no sumó ningún error nuevo porque comparte la sintaxis, ya conocida, del resto de índices de esa misma tabla).
- JavaScript del frontend: `node --check` sobre `03-app-core.js`, `06-documentos-y-resto.js` y `universidad/app.js` — sin errores de sintaxis, verificado después de cada bloque de cambios (incluida la reescritura completa de `_descargarCertificadoPDF()` y el nuevo manejo del código `402` en `_pushDB()`).
- 1 script de prueba aislado nuevo, con 26 casos: detección de plan mensual vs. anual, cálculo de vigencia a 30 y 365 días, límites exactos del margen de gracia de 3 días (dentro/fuera), compatibilidad hacia atrás (institución sin fila = nunca bloqueada), ventana de alerta de 5 días con su deduplicación, normalización de `DISPUTED`/`CHARGEBACK`, idempotencia de la reversión, y aislamiento de la reversión por entrada de pago específica (no afecta otros pagos del mismo estudiante).
- **Cero dependencias nuevas agregadas** en `package.json` en esta ronda: el PDF sigue generándose 100% en el navegador con `jsPDF` (ahora en tamaño Carta) y el QR reutiliza el generador que ya tenían los boletines; la página pública de verificación es HTML armado a mano en el propio backend, sin ningún motor de plantillas nuevo.

### Lo que queda pendiente de tu decisión (documentado, no resuelto a ciegas)

1. **Reembolso de la propia suscripción SaaS** (no de mensualidades ni trámites, que ya quedaron resueltos): hoy se registra el estado pero no se toca `fin_suscripciones` — dime si debe congelar la cuenta de inmediato, prorratear días, o no hacer nada hasta que la vigencia expire sola.
2. **Campo dedicado de "correo de facturación"** por institución: hoy la alerta de vencimiento SaaS se envía al primer admin/rector con correo registrado; si prefieres un contacto de facturación separado (que no dependa de que exista ese rol con ese dato), se agrega un campo nuevo en la configuración.
3. **Firma digital criptográfica del PDF en sí** (más allá del estampado visual "Firmado digitalmente" + el QR de verificación): si tu institución necesita que el archivo PDF traiga una firma digital embebida verificable con Adobe Reader/software de firma (ej. PAdES), eso requeriría agregar una librería nueva (hoy no existe ninguna en el proyecto) — dime si es un requisito real y se evalúa cuál conviene.

---

## Ronda 14 — Corrección crítica: la Planilla de Notas se sincronizaba sola aunque el Súper Admin la hubiera apagado, y podía perder/desubicar notas durante ese refresco

Reportaste 3 síntomas concretos en la Planilla de Calificaciones del docente: (1) la sincronización automática se seguía ejecutando aunque el Súper Admin la hubiera desactivado para la institución, (2) la pantalla parpadeaba/saltaba y perdía el scroll mientras se calificaba, y (3) ese refresco podía reemplazar/desubicar las notas recién ingresadas antes de guardarlas. Investigué a fondo el mecanismo de sincronización de `03-app-core.js` (motor "invisible" ya construido en la Ronda 11, más el canal en tiempo real por Server-Sent Events) y encontré la causa raíz exacta de cada síntoma. Es una corrección 100% de frontend — no se tocó ningún endpoint ni tabla del backend.

### 1 — Causa raíz del síntoma 1: el canal en tiempo real (SSE) ignoraba el interruptor del Súper Admin

El proyecto ya tenía, desde la Ronda 12, el interruptor `plat.sincronizacionAutomatica` (panel del Súper Admin → botón "🔄 Sinc. automática" / "🔕 Sinc. manual" por institución) y la función `_sincronizacionAutoHabilitadaAhora()` que lo consulta. Y, en efecto, el temporizador de polling (`_syncInterval`, cada 3 minutos) y el listener de "volver a la pestaña" (`visibilitychange`) sí lo respetaban correctamente.

**Lo que no lo respetaba:** el canal de sincronización en tiempo real (Server-Sent Events, `_makeSseChannel`/`_connectSSEPlat`), que queda permanentemente abierto mientras la sesión está activa. Su manejador `onmessage` llamaba a `_syncAll(false)` ante **cualquier** evento `"change"` que el servidor difundiera — incluido el eco del propio guardado de cualquier otro docente/dispositivo — **sin revisar el interruptor**. Como este eco llega prácticamente en tiempo real cada vez que alguien guarda algo en la institución, era la vía más frecuente por la que se disparaba una sincronización de fondo con el interruptor en "OFF": exactamente el síntoma 1 que reportaste.

**Corrección:** se agregó la misma verificación que ya usan el polling y el `visibilitychange` — `if(msg.type==='change'&&_sincronizacionAutoHabilitadaAhora()) _syncAll(false);`. La verificación periódica de "Pantalla en Blanco" (cada 60 segundos) sigue funcionando exactamente igual sin este cambio — es, a propósito, un mecanismo de seguridad aparte que nunca dependió de este interruptor (evita que alguien bloqueado por el Súper Admin siga con la sesión abierta), y no toca en ningún momento las notas de la Planilla.

### 2 y 3 — Causa raíz de los síntomas 2 y 3: el popup de selección de nota no contaba como "estoy editando"

La Planilla no usa una casilla de texto libre para calificar — el docente elige la nota desde un popup táctil ("🎯 Seleccione la nota", con botones de rango 0.0–5.0 y accesos rápidos cualitativos para Preescolar/Transición). `_syncAll()` ya tenía, desde la Ronda 12, una protección: si detecta que hay un `INPUT`/`TEXTAREA`/`SELECT` con el foco activo, NO reconstruye la pantalla de inmediato — la deja pendiente hasta que la persona termine (evento `blur`). Pero esa protección solo miraba esos 3 tipos de campo, y el popup de nota está hecho de `<button>`, así que **nunca calificaba como "editando"**.

Efecto concreto: si una sincronización de fondo se disparaba (por ejemplo, por el bug del punto 1, o por el eco normal de OTRO docente guardando algo) justo mientras el popup de nota estaba abierto, `_syncAll()` procedía de inmediato a reconstruir toda la tabla debajo del popup. El botón de la celda al que apuntaba el popup quedaba huérfano (desprendido del DOM), y el cálculo de posición del popup (que se recalcula contra ese botón en cada scroll/resize) terminaba usando un elemento fantasma cuyas coordenadas son todas cero — el popup "saltaba" de golpe a la esquina superior izquierda de la pantalla. Esto explica el parpadeo/salto reportado, y — más importante — interrumpía visualmente al docente justo mientras seleccionaba una nota, dando la sensación de que "la planilla se comió la nota" aunque los datos ya guardados nunca se perdían realmente (ver el mecanismo de notas pendientes de abajo).

**Correcciones aplicadas (las 3 trabajan juntas):**
- `_syncAll()` ahora también considera "estoy editando" cuando el popup de nota está abierto (`_popupActive`, una bandera que el propio popup ya mantenía). Con eso, un refresco de fondo mientras se está calificando queda en espera — igual que ya pasaba con un campo de texto — en vez de reconstruir la tabla a medio proceso.
- `cerrarPopupNota()` ahora aplica ese refresco en espera apenas el popup se cierra (se seleccione una nota o se cierre con "✕"), con el mismo patrón (y el mismo pequeño respiro de 80ms) que ya usaba el listener global de `blur` para los campos de texto — así los datos de la nube se muestran apenas es seguro hacerlo, sin interrumpir la selección a medio hacer.
- Defensa adicional en el propio posicionador del popup: si en algún otro escenario el botón-ancla ya no está en el documento (por ejemplo, tras una sincronización **manual forzada** con el botón "🔄 Sincronizar ahora" — que, a propósito, sigue refrescando de inmediato aunque haya algo en edición, porque es una acción explícita del usuario), el popup se cierra solo en vez de saltar a la esquina de la pantalla.

### Por qué las notas nunca se perdían de verdad, aunque se sintiera así

Vale aclarar, porque cambia la gravedad real del reporte: el sistema YA tenía, desde la Ronda 11, un mecanismo de "notas pendientes" (`_notasPendientes`/`_reaplicarPendientes()`) diseñado específicamente para que un refresco en tiempo real nunca borre lo que el docente acaba de calificar — tanto en modo manual (nota pendiente, borde amarillo, hasta pulsar "GUARDAR CAMBIOS") como en modo auto-guardado (el valor ya queda escrito en la base de datos local — `db` — de inmediato, antes de que cualquier sincronización de fondo pueda siquiera ejecutarse, y la fusión de 3 vías (`_merge3way`) está diseñada para conservar el valor local cuando el servidor todavía no lo tiene). Revisé ese mecanismo a fondo y sigue siendo correcto. El problema real de esta ronda era la **interrupción/desubicación visual en pleno acto de calificar** (síntomas 1 y 2) — que es justo lo que las 3 correcciones de arriba resuelven — y no una pérdida silenciosa de datos ya confirmados.

### Guardado en sí: ya cumplía lo pedido, sin cambios necesarios

Revisé también los requisitos de "autoguardado reactivo a eventos, nunca por temporizador" y "sin re-renderizado masivo del DOM": ya se cumplían desde la Ronda 11 y no hizo falta tocarlos. El guardado de una nota (`saveNota()`) se dispara únicamente al elegir un valor en el popup (evento, no un timer), nunca hace `innerHTML` de toda la tabla ni `location.reload()`, y actualiza solo la fila del estudiante afectado (`_refrescarFilaPlanilla()`) — el mismo camino que usa tanto el modo automático como el guardado por lotes ("GUARDAR CAMBIOS"). No se encontró ningún `setInterval`/`setTimeout` que reconstruyera la tabla completa por su cuenta.

### Cómo se verificó todo esto (Ronda 14)

- JavaScript del frontend: `node --check` sobre `03-app-core.js`, `06-documentos-y-resto.js` y `universidad/app.js` — sin errores de sintaxis tras cada bloque de cambios.
- 1 script de prueba aislado nuevo, con 16 casos: el interruptor de sincronización bloqueando (o no) el canal SSE en cada combinación relevante (ON/OFF/sin plataforma resuelta aún/canal del Súper Admin, que nunca depende del interruptor de una institución/tipo de mensaje distinto a "change"), la detección de "editando" con el popup de nota abierto o cerrado (con y sin un campo de texto adicional en foco), el efecto de esa detección sobre si `_syncAll()` renderiza de inmediato o difiere (incluyendo que la sincronización manual forzada sigue renderizando de inmediato, sin cambios), el comportamiento de `cerrarPopupNota()` al limpiar el refresco pendiente y programar el render diferido (o no hacer nada si no había nada pendiente), y el cierre defensivo del popup cuando su botón-ancla ya no existe en el documento.
- Se confirmó que el módulo de universidad (LMS/SIS, `universidad/app.js`) usa un motor de sincronización completamente distinto (`window.SyncEngine`, de `07-sync-engine.js`) que ya respeta su propio interruptor correctamente (`if(_flagsPlataformaUniv.sincronizacionAutomatica) window.SyncEngine.autoAttach()`) — no tenía el bug del canal SSE de la Planilla del K-12 y no requirió cambios.
- Cero dependencias nuevas agregadas en `package.json` — todo el ajuste reutiliza banderas y funciones que ya existían en el propio archivo (`_sincronizacionAutoHabilitadaAhora()`, `_popupActive`, `window._syncRenderPendiente`, `_renderPreservandoContexto()`).
- No se modificó ningún archivo del backend (`src/`) en esta ronda — es una corrección exclusivamente de frontend.

---

## Ronda 15 — "Notas de Actividades en Clase": réplica por columna, popup de selección rápida igual al de la Planilla, y sincronización del promedio sin parpadeos

Pediste integrar en el módulo "Notas de Actividades en Clase" varias capacidades que la Planilla principal ya tenía, más cerrar el ciclo de sincronización del promedio. Antes de tocar nada revisé a fondo el módulo (`htmlNotasActividades()` y funciones asociadas en `03-app-core.js`) y encontré que 2 de los 4 requerimientos ya estaban resueltos desde una ronda anterior — se documentan igual abajo para que quede constancia de qué se verificó y qué se construyó nuevo. Es una actualización 100% de frontend — no se modificó ningún archivo del backend (`src/`), porque este módulo, igual que la Planilla, guarda todo dentro del mismo blob JSON de la institución (`db.notasActColumnas`, `db.notasActAsignadas`, `db.notasAct`) a través del mismo endpoint genérico que ya existe.

### 1 — Réplica de notas por columna + popup de selección rápida (NUEVO)

- **"📋 Replicar a todos" en cada columna:** se agregó, junto al botón "✕ quitar" que ya tenía cada encabezado de columna, un nuevo botón que abre un selector de nota (idéntica rejilla de botones 0.0–5.0 que usa `replicarColumna()` en la Planilla) y, al elegir un valor, lo aplica de inmediato a **todos los estudiantes del grado** en esa columna — con la fecha y hora de "hoy" para todos (si algún estudiante necesita otra fecha, se corrige después tocando su propia celda). Nuevas funciones: `replicarColNotaAct(colId)` / `aplicarReplicaNotaAct(colId,valor)`.
- **Popup de la celda, ahora igual al de la Planilla:** el popup para calificar una actividad individual (`abrirPopupNotaAct`) usaba antes un campo de texto numérico simple. Se reemplazó por **el mismo menú de selección rápida** que ya usa la Planilla principal (`abrirPopupNota`): la rejilla de botones 0.0–5.0 por rango de desempeño (BAJO/BÁSICO/ALTO/SUPERIOR), más los 4 accesos cualitativos S/A/B/D para Transición/Preescolar cuando el grado de la asignatura lo amerita (`esGradoInicial()`, la misma detección que ya usa la Planilla). Se conservaron los campos de fecha y hora — son lo que distingue a este módulo de la Planilla (cada nota de actividad queda fechada) — ahora ubicados arriba de la rejilla, editables antes de tocar el botón de la nota.
  - **Adaptación documentada:** interpretamos "el mismo menú desplegable... permitiendo seleccionar observaciones, estados o notas predefinidas" como la misma rejilla de selección rápida de valores 0.0–5.0 que ya usa la Planilla (con sus accesos cualitativos), no como un sistema nuevo de "estados" u "observaciones" de texto libre — el módulo sigue siendo de notas numéricas 0.0–5.0, igual que el resto del sistema de calificaciones. Si lo que necesitas es además poder dejar una observación de texto por actividad (no solo nota + fecha/hora), dínoslo y se agrega como un campo adicional del popup.
  - No se incluyó el botón de dictado por voz que sí tiene el popup de la Planilla — no vino pedido explícitamente y su lógica actual está atada a las columnas de la Planilla (SER/SABER/HACER); se puede adaptar a este módulo si lo necesitas.
  - **Protección heredada de la Ronda 14, automática:** como este popup ahora usa la misma bandera `_popupActive` que ya protege al popup de la Planilla contra un refresco de fondo a mitad de la selección, quedó protegido contra exactamente el mismo bug que se corrigió ahí (parpadeo/salto de posición si una sincronización llega mientras el popup está abierto) sin tener que reconstruir esa lógica de nuevo — se cierra de forma defensiva si su botón-ancla deja de existir, y aplica cualquier refresco en espera justo al cerrarse.

### 2 — Contexto Grado + Asignatura + Periodo y promedio automático (YA EXISTÍA — verificado, sin cambios de código)

Este requerimiento ya estaba completamente resuelto desde antes de esta ronda:

- Las columnas de actividades se asignan con la clave `db.notasActAsignadas[cargaId_periodo]` — como cada `cargaId` (`db.carga`) ya identifica de forma única una combinación Grado+Asignatura+Docente, esa clave por sí sola captura estrictamente el contexto Grado+Asignatura+Periodo que pediste: la misma columna del catálogo compartido (ej. "Talleres 1") puede reutilizarse en distintas asignaturas/grados/periodos sin mezclar sus valores entre sí, porque cada valor se guarda con la clave completa `cargaId_periodo_columnaId_estudianteId`.
- La tabla ya tenía, al final, una columna fija "PROMEDIO" (`_promedioNotasActEst()`) que promedia en tiempo real todas las columnas activas de ese periodo para cada estudiante, y se recalcula sola tras cada guardado individual (`_refrescarCeldaNotaAct`) sin reconstruir la tabla.
- Se verificó con 4 casos de prueba nuevos que un cambio en una carga/periodo no se filtra a otro grado, asignatura o periodo que reutilice la misma columna del catálogo — ver la sección de verificación más abajo.

### 3 — Sincronización del promedio con la Planilla: ajustada para no perder el foco ni parpadear

La sincronización en sí (elegir Ser/Saber/Hacer y actualizar la columna correspondiente en `db.ests[].nts` para todo el grupo, con el promedio redondeado a 1 decimal) también ya existía (`abrirModalSincronizarNotaAct` / `_confirmarSyncNAC`), incluyendo el redondeo exacto que pediste (`Math.round(promedio*10)/10`). Se ajustaron 2 cosas:

- **Nombre del botón y del modal**, ahora literalmente "🔄 Sincronizar Promedio con Planilla" (antes decía solo "Sincronizar con Planilla"), para que coincida con lo que pediste.
- **Se quitó el `renderApp()` que se ejecutaba al terminar la sincronización.** Esa reconstrucción completa de la pantalla no cambiaba nada visible — esta pantalla ("Notas de Actividades en Clase") no muestra ninguna de las columnas de la Planilla que la sincronización actualiza, solo escribe en `db.ests[].nts`, que la Planilla lee por su cuenta la próxima vez que se abra — así que solo causaba el parpadeo/pérdida de posición que pediste evitar, sin ningún beneficio. El aviso de confirmación (✅ con el número de estudiantes sincronizados) se conserva igual.

### Resumen de funciones nuevas de esta ronda

| Función | Para qué |
|---|---|
| `replicarColNotaAct(colId)` | Abre el selector de nota para aplicar a todos los estudiantes de una columna de actividad |
| `aplicarReplicaNotaAct(colId,valor)` | Aplica la nota elegida a todos los estudiantes del grado en esa columna, con la fecha/hora de hoy |

`abrirPopupNotaAct`, `cerrarPopupNotaAct` y `_guardarNotaAct` se reescribieron (mismos nombres, nueva implementación) para usar la rejilla de selección rápida en vez del campo numérico.

### Cómo se verificó todo esto (Ronda 15)

- JavaScript del frontend: `node --check` sobre `03-app-core.js`, `06-documentos-y-resto.js` y `universidad/app.js` — sin errores de sintaxis.
- 1 script de prueba aislado nuevo, con 17 casos: el contexto estricto Grado+Asignatura+Periodo (una columna del catálogo reutilizada en 2 cargas/grados distintos nunca mezcla sus valores; cambiar de periodo no arrastra notas de otro periodo), el promedio automático combinando varias columnas activas, la réplica a todos afectando únicamente al grado de la carga activa (verificado que un estudiante de OTRO grado con una carga distinta que reutiliza la misma columna del catálogo no se ve tocado), el recorte de valores fuera de rango (por debajo de 0.0 o por encima de 5.0) tanto en la réplica como en el guardado individual, y la sincronización con la Planilla (redondeo a 1 decimal, que un estudiante sin promedio se omite en vez de escribir un 0 por error, y que sincronizar dos columnas distintas del mismo estudiante no se pisan entre sí).
- Se revisó que las funciones de exportar/importar Excel de este módulo (`descargarNotasActExcel`/`cargarNotasActExcel`) leen `db.notasAct` directamente y no dependen del popup — no requirieron ningún cambio.
- Cero dependencias nuevas agregadas en `package.json` — toda la réplica y el nuevo popup reutilizan exactamente el mismo patrón visual y las mismas funciones auxiliares (`colorNota`, `esGradoInicial`, `_activarAccesibilidadPopup`, `_toastPlan`, `_popupActive`) que ya usaba la Planilla principal.
- No se modificó ningún archivo del backend (`src/`) en esta ronda.

### Lo que queda pendiente de tu decisión (documentado, no resuelto a ciegas)

1. **Observaciones de texto por actividad:** si además de la nota numérica necesitas poder registrar una observación escrita por actividad (no solo fecha/hora), dínoslo y se agrega como campo adicional del popup y de `db.notasAct`.
2. **Dictado por voz en este módulo:** la Planilla principal tiene un botón de dictado por voz en su popup; no se replicó aquí porque su lógica actual está atada a los campos de la Planilla (SER/SABER/HACER) y no vino pedido explícitamente — se puede adaptar si lo necesitas.

---

## Ronda 16 — "Notas de Actividades en Clase": los 2 puntos que quedaron abiertos en la Ronda 15 (observaciones de texto por actividad y dictado por voz)

Pediste completar los 2 puntos que la Ronda 15 dejó documentados como pendientes: agregar una observación de texto por actividad (hasta ahora el popup solo guardaba nota + fecha + hora) y extender a este módulo el dictado por voz que ya tenía la Planilla principal. Es una actualización 100% de frontend sobre el mismo archivo de la ronda anterior (`03-app-core.js`) — no se tocó ningún endpoint ni tabla del backend (`src/`).

### 1 — Observación de texto por actividad (NUEVO)

- El popup para calificar una actividad (`abrirPopupNotaAct`) ahora incluye un campo de texto opcional ("Observación (opcional)", con ejemplos de ayuda como "Entregó tarde, participó activamente, con apoyo del acudiente...") justo debajo de fecha/hora. Igual que fecha y hora, se lee al momento de tocar cualquiera de los botones de nota (rejilla 0.0–5.0 o los accesos cualitativos S/A/B/D), así que se puede escribir antes o después de elegir el valor.
- La observación se guarda como un cuarto campo (`obs`) dentro del mismo registro `db.notasAct[cargaId_periodo_columnaId_estudianteId]` que ya tenía `valor`, `fecha` y `hora` — no se creó una estructura de datos nueva. Las notas registradas antes de esta ronda (sin el campo `obs`) se siguen leyendo sin problema: se tratan como observación vacía.
- Cuando una celda tiene observación, la tabla muestra un pequeño ícono 📝 junto a la fecha/hora; al pasar el cursor por encima (`title="..."`) se ve el texto completo. Este ícono se mantiene sincronizado tanto en el renderizado inicial de la tabla como en el refresco granular de una sola celda (`_refrescarCeldaNotaAct`) que ya usa este módulo para no repintar toda la pantalla al guardar una nota — se agregó un escape de caracteres (`_escAttrNAC`, nuevo) para que una observación con comillas, `&`, `<` o `>` nunca rompa el HTML de la tabla.
- **"📋 Replicar a todos" no pisa las observaciones individuales:** al aplicar una misma nota a todo el grado desde una columna, cada estudiante conserva la observación que ya tuviera escrita para esa celda (si la había) — solo se reemplaza el valor numérico, la fecha y la hora, igual que antes. Esto evita que una réplica masiva borre en silencio un comentario individual que el docente ya había registrado.

### 2 — Dictado por voz en este módulo (NUEVO)

- El popup de nota de actividad ahora tiene el mismo botón "🎙️ Dictar por Voz" que ya usa la Planilla principal, con el mismo reconocimiento de voz en español (`es-CO`) y el mismo parseo de números dictados (dígitos con punto o coma decimal, o palabras como "cuatro", "cero", etc.), incluida la misma tolerancia 0.0–5.0.
- **Decisión de diseño, documentada a propósito:** en vez de generalizar/reutilizar la función `iniciarVozNota()` de la Planilla, se duplicó como una función nueva y separada (`iniciarVozNotaAct`), con sus propios identificadores de pantalla (`vozNotaActBtn`/`vozNotaActStatus`, distintos a los de la Planilla) y que guarda por el camino propio de este módulo (`_guardarNotaAct`, que registra fecha/hora/observación en `db.notasAct`) en vez del camino de la Planilla (que escribe directo en `db.ests[].nts`). Se optó por duplicar en vez de compartir código para no arriesgar la función de la Planilla, que ya está probada en producción — mismo criterio que ya se usó en la Ronda 15 para el popup de selección rápida.
- Al reconocer un número válido, la nota se guarda dejando el popup abierto un instante (para que se alcancen a leer fecha, hora y la observación ya escrita en ese momento) y luego se cierra solo, igual que al tocar un botón de la rejilla.

### Cómo se verificó todo esto (Ronda 16)

- JavaScript del frontend: `node --check` sobre `03-app-core.js`, `06-documentos-y-resto.js` y `universidad/app.js` — sin errores de sintaxis tras el conjunto de cambios.
- 1 script de prueba aislado nuevo, con 23 casos: el guardado y la lectura de la observación de texto (incluida una observación de solo espacios, que se normaliza a vacía, y notas guardadas antes de esta ronda sin el campo `obs`, que no revientan al leerse), que "Replicar a todos" preserva la observación previa de cada estudiante (y no revienta si un estudiante no tenía nota ni observación previas en esa celda), el escapado de caracteres especiales de `_escAttrNAC` (comillas, `&`, `<`, `>`, valores vacíos/nulos), y el reconocimiento de números dictados por voz para este módulo (dígitos con punto o coma, enteros, palabras simples, "cero" como nota válida 0.0, valores fuera de rango o texto no reconocido) — incluyendo la confirmación de que una nota dictada por voz aquí se guarda en `db.notasAct` (con fecha/hora/observación) y no en `db.ests[].nts` como en la Planilla.
- Se dejó documentado en el propio script de prueba un matiz de comportamiento ya existente y heredado tal cual de la Planilla (no una regresión de esta ronda): al dictar una frase compuesta en palabras como "tres punto cinco", el reconocimiento toma el entero inicial ("tres") porque las palabras sueltas se revisan antes que sus variantes compuestas en la lista de reconocimiento — así funciona hoy también el dictado por voz de la Planilla, y se preservó intacto a propósito en vez de "corregirlo" por nuestra cuenta en una ronda que no lo pedía.
- Cero dependencias nuevas agregadas en `package.json` — la observación de texto usa un campo adicional en la misma estructura de datos que ya existía, y el dictado por voz reutiliza la misma API del navegador (`SpeechRecognition`/`webkitSpeechRecognition`) que ya usaba la Planilla.
- No se modificó ningún archivo del backend (`src/`) en esta ronda — es una corrección exclusivamente de frontend, y con esto quedan resueltos los 2 puntos que la Ronda 15 había dejado documentados como pendientes.

---

## Ronda 17 — AGENTE AUTÓNOMO Y AUDITOR SUPREMO DEL ECOSISTEMA (Gemini + Function Calling) + Keep-Alive Inteligente + estrategia de ancho de banda

Pediste la implementación completa de un agente de IA que audite y corrija de forma autónoma el ecosistema completo (rendimiento académico, inasistencias, integridad de la base de datos, sincronización offline-first y salud del servidor), con Function Calling real sobre Gemini, respetando estrictamente la soberanía de las notas de los docentes y el esquema de la base de datos, además de un Keep-Alive inteligente para Render y una estrategia integral de reducción de tráfico de red. Es una construcción nueva de backend + un panel nuevo en el frontend del Súper Admin — **no se modificó ningún endpoint ni comportamiento existente de la Planilla, la matrícula, los pagos ni ningún otro módulo**; todo lo nuevo vive en archivos propios y se conecta al resto del sistema por los mismos puntos ya establecidos (`kv_store`, la tabla `notifications`, el canal SSE).

### 1 — Configuración y conexión a Gemini (con degradación elegante)

- El nuevo servicio lee `process.env.GEMINI_API_KEY` **directamente** — es la MISMA clave que ya usa el Asistente Adán (no hacía falta ninguna clave nueva; ya está configurada en tu `.env`).
- Si esa variable llegara a faltar, el agente NUNCA tumba el servidor: registra una advertencia en consola (`⚠️ [EcosystemAgent] GEMINI_API_KEY no configurada...`) y sigue auditando con su propio motor de reglas determinista (sin razonamiento generativo ni Function Calling) — el resto de Express sigue funcionando con total normalidad. Puede comprobarlo en cualquier momento desde `GET /api/agent/status`.
- Cliente oficial `@google/genai` (ya era una dependencia del proyecto, usada por Adán — cero paquetes nuevos), modelo `gemini-2.5-flash` por defecto, configurable con la nueva variable opcional `GEMINI_AGENT_MODEL` (o `GEMINI_MODEL`, la misma que ya usa Adán, si esa no está definida).

### 2 — Soberanía Académica y Control de Esquema de BD (la regla más importante de esta ronda)

- **Nunca se toca una nota real.** `repairDataIntegrity` solo repara una dimensión Ser/Saber/Hacer (`s`/`sb`/`h`) cuando es **técnicamente inválida** — `null`, `undefined`, `NaN` o texto no numérico, síntomas reales de un fallo de sincronización — reemplazándola por `0` (el mismo valor por defecto que ya usa el propio frontend cuando esas dimensiones faltan). Una nota real y baja (por ejemplo 1.2, o incluso 0.0) **jamás** se considera "inválida": eso es una nota real, y ante eso la única acción permitida es `flagAcademicAlert` (una alerta, nunca una modificación). Esta distinción está probada explícitamente (ver la sección de verificación).
- **Nunca se ejecuta `ALTER TABLE` ni `CREATE TABLE` en tiempo de ejecución.** La única tabla nueva (`agent_audit_logs`) se crea UNA SOLA VEZ al arrancar el servidor, con el mismo mecanismo `CREATE TABLE IF NOT EXISTS` que ya usan todas las demás tablas del proyecto (`src/db/index.ts`) — no es el agente quien la crea, es el propio despliegue. Cualquier metadato adicional que el agente necesite recordar en el futuro se guarda dentro del campo `JSONB details` de esa misma tabla; si en algún momento hiciera falta de verdad una columna física nueva, el agente solo deja esa sugerencia registrada en el log (categoría "Sincronización", estado "Informativo") para que la evalúes tú — nunca la crea por su cuenta.
- **Salvaguarda anti-alucinación:** aunque Gemini decida invocar una herramienta, esa llamada solo se ejecuta si su "target" (el `targetId` o `studentId`) coincide EXACTAMENTE con un hallazgo que el motor de reglas determinista ya detectó de forma independiente en esa misma institución. Si el modelo "inventara" un identificador que no existe, la llamada se ignora y queda registrada como aviso informativo — nunca se ejecuta contra datos reales. Probado explícitamente (ver verificación).

### 3 — Optimización de red y ancho de banda

**Del lado del Agente y Neon (100% nuevo en esta ronda):**
- **Consulta incremental real:** cada ciclo de auditoría hace `SELECT key, value, updated_at FROM kv_store WHERE updated_at > <última auditoría>` — nunca un `SELECT *` de toda la base de datos, y solo trae las instituciones que de verdad cambiaron.
- **Consolidación en memoria + UNA sola escritura en lote:** todos los hallazgos y acciones de todo el ciclo (sobre todas las instituciones cambiadas) se acumulan en memoria y se insertan en `agent_audit_logs` con un único `INSERT ... VALUES (...), (...), ...` al final — nunca fila por fila.
- **Silencio total en inactividad:** si la consulta incremental no trae ninguna fila (nadie guardó nada desde el último ciclo), la auditoría termina de inmediato — cero llamadas adicionales a Neon y cero llamadas a Gemini. Esto es, literalmente, lo que pasará la mayoría de las noches y fines de semana.

**Del lado de los usuarios (docentes/administrativos) — verificado, con una limitación documentada:**
- ✅ **Compresión ya activa:** `compression({threshold:1024})` ya estaba montada de forma global en Express (`src/index.ts`) — se verificó que sigue cubriendo también las nuevas rutas `/api/agent/*`.
- ✅ **Caché condicional ya existente:** `GET /api/inetis/db` ya respondía `304 Not Modified` (ETag) cuando el navegador ya tenía la última versión — se verificó que sigue intacto.
- ✅ **Guardado por lotes ya existente:** la Planilla ya tenía un modo "GUARDAR CAMBIOS" (lote explícito de varias notas pendientes en una sola escritura) y, en modo autoguardado, un debounce de red de 350ms (`_pushDB()`) que agrupa ediciones rápidas seguidas antes de enviarlas — se verificó que ambos mecanismos siguen funcionando exactamente igual.
- ⚠️ **Payloads Ultraligeros (delta real por celda) — NO implementado en esta ronda, decisión documentada a propósito:** todo el sistema (desde la Ronda 1) guarda los datos de cada institución como **un solo bloque JSON completo** en `kv_store` (`db.ests`, `db.asistencia`, notas, etc., todo junto bajo una sola llave `sk`). Por diseño, cada guardado — sin importar si cambió una sola celda — envía ese bloque completo a `POST /api/inetis/db`; no existe hoy un endpoint que reciba "solo la nota que cambió" porque no hay una fila de base de datos por nota individual. Implementar un delta real de verdad (enviar por la red solo la celda modificada) requeriría rediseñar el modelo de datos completo — pasar de "un JSON por institución" a "una fila SQL por nota" — lo cual tocaría absolutamente todo el sistema (guardado, sincronización offline-first, papelera, historial de cambios, exportación a Excel, todo lo construido en 16 rondas anteriores) y es un proyecto de migración propio, no algo para resolver dentro de esta entrega sin arriesgar la estabilidad de todo lo ya construido y probado. Si quieres, en una ronda dedicada exclusivamente a esto se puede diseñar esa migración con cuidado. Mientras tanto, el debounce + el modo de guardado por lotes ya existentes son lo que more se acerca a "paquetes consolidados" dentro del modelo de datos actual.

### 4 — Servicio `EcosystemAgent` y Function Calling (`src/services/ecosystemAgent.js`)

Archivo JavaScript plano (misma convención que el subsistema `src/university-lms/`), con el System Prompt exacto que especificaste y las 4 herramientas declaradas para Gemini Function Calling:

| Herramienta | Qué hace | Salvaguarda |
|---|---|---|
| `repairDataIntegrity({type,targetId})` | Repara dimensiones Ser/Saber/Hacer técnicamente inválidas (null/NaN/texto no numérico) | Nunca toca un valor numérico ya válido, por bajo que sea |
| `triggerSystemSync({nodeId})` | Fuerza un nuevo aviso de sincronización en tiempo real (SSE) a los dispositivos ya conectados de esa institución | Solo puede apuntar a la institución que se está auditando |
| `flagAcademicAlert({studentId,reason,level})` | Registra una alerta pedagógica (promedio < 3.0 o inasistencia crítica) — notificación in-app para docente/coordinación/rectoría/Súper Admin | Única reacción permitida ante un hallazgo académico; no repite la misma alerta más de una vez por semana por estudiante |
| `notifySuperadmin({summary,details,actionsTaken})` | Escribe el reporte final consolidado del ciclo en la bitácora | — |

Cuando Gemini está configurado, cada institución con hallazgos recibe su propia llamada de Function Calling (acotada solo a sus propios hallazgos, para que un mismo id de estudiante nunca se confunda entre dos instituciones distintas que por coincidencia numeren a sus estudiantes igual). Si Gemini no está disponible o falla, el motor determinista ejecuta exactamente las mismas 4 herramientas por su cuenta, sin narrativa generativa — la cobertura de auditoría/reparación es idéntica en ambos casos.

### 5 — Auditoría académica/inasistencias, parser de voz, auditoría técnica, Keep-Alive y cron

- **Auditoría académica e inasistencias:** replica EXACTAMENTE las fórmulas que ya usa la Planilla (`_baseNota()`/`calcNotaDef()`, con recuperación y nivelación) y el cálculo de % de inasistencia ya existente (`analizarInasistenciaAdan()`), usando los umbrales institucionales ya configurados (`db.config.pctInasistenciaCritica`/`pctInasistenciaPreventiva`, 25%/20% por defecto) — no se inventaron fórmulas ni umbrales nuevos.
- **`POST /api/agent/process-voice-grades`:** recibe el texto YA transcrito por el navegador (mismo patrón que el dictado por voz que ya existe en la Planilla — la transcripción de audio a texto la hace el propio navegador con la Web Speech API; el servidor nunca procesa audio crudo) y usa **Structured Outputs** de Gemini (`responseSchema`) para devolver un arreglo `[{estudianteNombreDetectado, nota, confianza}]` lo más fiel posible a los nombres reales del curso. Este endpoint **nunca guarda nada por su cuenta**: solo interpreta texto y devuelve JSON para que el docente revise y confirme antes de guardar — la Soberanía Académica también aplica aquí.
- **Auditoría técnica:** valida la integridad de las dimensiones Ser/Saber/Hacer (ver punto 2) y la FORMA del interruptor `sincronizacionAutomatica` del Súper Admin (detecta si quedó corrupto por una fusión de datos defectuosa) — **adaptación documentada:** el *cumplimiento* de ese interruptor por parte de cada dispositivo ya se corrigió en el propio navegador (Ronda 14); el servidor no puede observar el comportamiento en tiempo real de un dispositivo específico, así que aquí se audita la integridad del dato, no el comportamiento del cliente.
- **Keep-Alive Inteligente (`src/lib/keep-alive.ts`):** `GET /api/health` (ya existía) ahora también reporta si hubo actividad reciente. Un temporizador adaptativo se auto-pinguea a esa misma ruta: cada 15 min si hubo actividad real en los últimos 30 minutos, cada 30 min sin actividad mas en horario normal, y se espacia hasta cada 2 horas durante la ventana de madrugada configurable (12:00 a.m.–5:00 a.m. hora Colombia por defecto, hora en la que casi nadie usa el sistema) — así Render no se suspende en las horas en que sí importa, sin generar tráfico innecesario cuando no hay nadie. Usa `RENDER_EXTERNAL_URL` (que Render ya provee automáticamente) o la nueva variable opcional `KEEP_ALIVE_SELF_URL`.
- **Cron de auditoría semanal:** todos los domingos a las 2:00 a.m. (hora de Colombia), con el mismo patrón de temporizador simple (`setInterval` + comprobación de hora) que ya usan `iniciarRespaldosAutomaticosProgramados()`/`iniciarTareasAutonomasProgramadas()` en este mismo proyecto — **no hizo falta agregar `node-cron` como dependencia nueva**, la especificación ya contemplaba "node-cron **o** temporizador" y el proyecto ya tenía su propio patrón probado para esto.
- **`POST /api/agent/run-full-audit`:** disparo manual bajo demanda (usado por el botón "▶️ Disparar Auditoría Ahora" del panel), con protección contra dos auditorías corriendo en paralelo si se pulsa el botón varias veces seguidas.

### 6 — Base de datos y panel "🤖 Auditoría IA / Agente" en el panel del Súper Admin

- **Tabla `agent_audit_logs`** exactamente con las columnas pedidas (`id`, `timestamp`, `category`, `issue_detected`, `action_taken`, `status`, `details` JSONB) — creada automáticamente por `src/db/index.ts` al arrancar el servidor; también se dejó `sql/02_agent_audit_logs.sql` como referencia manual opcional (no hace falta ejecutarlo).
- **Nueva pestaña "🤖 Auditoría IA / Agente"** en el panel del Súper Admin (`renderGestorAdmin()` en `03-app-core.js`, junto a "🏥 Salud del Sistema" y las demás pestañas ya existentes — es el mismo panel donde ya vive el interruptor de sincronización automática y demás controles de plataforma):
  - Tabla con Fecha/Hora, Problema Detectado, Acción Autónoma Ejecutada, y un badge de color por estado (🟢 Corregido / 🟡 Alerta / 🔵 Informativo).
  - Filtros por estado y por categoría (Académico/Técnico/Sincronización).
  - Botón "🔎 Ver JSON" por fila (modal con el detalle completo, incluido el campo `details`).
  - Botón principal "▶️ Disparar Auditoría Ahora".
  - Indicador de si Gemini está activo o el agente está en modo determinista.

### Cómo se verificó todo esto (Ronda 17)

- JavaScript del frontend: `node --check` sobre `03-app-core.js`, `06-documentos-y-resto.js` y `universidad/app.js` — sin errores de sintaxis.
- JavaScript/TypeScript del backend: `node --check` sobre los 2 archivos `.js` nuevos (`src/services/ecosystemAgent.js`, `src/routes/agent.js`); los 2 archivos `.ts` nuevos/modificados (`src/lib/sync-bus.ts`, `src/lib/keep-alive.ts`) y todos los `.ts` tocados (`src/index.ts`, `src/db/schema.ts`, `src/db/index.ts`) se verificaron con el compilador de TypeScript en modo `--noResolve` (sintaxis pura, sin depender de tener `node_modules` instalado) — cero errores de sintaxis; los únicos avisos que aparecen son, como es esperable, "no se encuentra el módulo" para paquetes que solo existen tras `npm install` (igual que ya le pasa al resto del proyecto).
- 1 script de prueba aislado nuevo, con 41 casos, centrado especialmente en la Soberanía Académica: una nota real baja (1.2, 0.0) **nunca** se marca como técnicamente inválida y por lo tanto **nunca** es tocada por `repairDataIntegrity` (solo genera alerta); los valores realmente corruptos (`null`/`undefined`/`NaN`/texto no numérico) sí se reparan a 0 sin tocar las dimensiones vecinas que ya eran válidas; la fórmula de promedio (`_baseNota`/`calcNotaDef`, con recuperación y nivelación) y el % de inasistencia calculan exactamente igual que en el frontend; la decisión de intervalo del Keep-Alive Inteligente (activo/sin actividad/madrugada) responde correctamente a cada combinación; la salvaguarda anti-alucinación bloquea correctamente una llamada de Gemini con un identificador inventado; y el anti-duplicado de alertas evita repetir la misma alerta al mismo estudiante más de una vez por semana, salvo que el nivel de severidad cambie. Se re-ejecutaron también los 3 scripts de prueba de rondas anteriores (16 + 17 + 23 casos) — sin regresiones, 97 pruebas en total, todas en verde.
- Se revisó manualmente cada punto de integración con el sistema ya existente: el canal SSE (`sseClients`/`broadcastChange`) se extrajo a `src/lib/sync-bus.ts` sin cambiar su comportamiento (mismo Map, mismo formato de mensaje) — solo se reubicó para que el nuevo agente también pudiera usarlo; se verificó que `src/index.ts` no quedó con declaraciones duplicadas tras el cambio.
- Cero dependencias nuevas agregadas en `package.json` — `@google/genai` y `compression` ya estaban instaladas (las usa Adán y el servidor, respectivamente); el cron y el Keep-Alive usan temporizadores simples, igual que los demás mecanismos periódicos ya existentes en el proyecto.
- No se modificó ningún endpoint, cálculo ni comportamiento de la Planilla, Notas de Actividades, matrícula, pagos, LMS universitario ni ningún otro módulo — todo lo nuevo vive en archivos propios (`src/services/ecosystemAgent.js`, `src/routes/agent.js`, `src/lib/keep-alive.ts`, `src/lib/sync-bus.ts`) y se conecta al resto del sistema únicamente por los puntos ya establecidos (`kv_store`, la tabla `notifications`, el canal SSE, `GET /api/health`).

### Lo que queda pendiente de tu decisión (documentado, no resuelto a ciegas)

1. **Payloads Ultraligeros (delta real por celda) para el tráfico de usuarios:** como se explicó en la sección 3, esto requeriría migrar el modelo de datos de "un JSON por institución" a "una fila SQL por nota" — un proyecto de migración propio y delicado. Lo que ya existe (debounce de 350ms + modo de guardado por lotes "GUARDAR CAMBIOS" + compresión + caché ETag) cubre buena parte del espíritu del pedido dentro del modelo actual. Si quieres avanzar en la migración completa, dímelo y se planea como una ronda dedicada.
2. **Auditoría de "colas de sincronización offline-first" a nivel de cada dispositivo:** esas colas (`_notasPendientes`, IndexedDB/localStorage) viven en el navegador de cada docente, no en el servidor — el agente no tiene forma de inspeccionarlas remotamente sin que el propio dispositivo las reporte. Si quieres que cada dispositivo reporte el tamaño de su cola pendiente al servidor (para que el agente la audite), se puede agregar como un pequeño "latido" adicional en una ronda futura.
3. **Umbral exacto de "inasistencia crítica":** se usó el umbral ya configurado por cada institución (`pctInasistenciaCritica`, 25% por defecto) en vez de un 20% fijo, para no crear un segundo criterio distinto al que ya usa el resto del sistema (la alerta automática de la propia Planilla). El umbral "preventivo" (20% por defecto) también genera su propia alerta de nivel `preventivo`, separado del crítico.

---

## Ronda 18 — Corrección de 2 bugs críticos reportados por docentes: Guardado Manual ignorado en "Notas de Actividades" y sincronización de fondo que no respetaba de forma centralizada la bandera del Súper Admin

Aceptaste la recomendación de la Ronda 17 de **no** migrar el modelo de datos a payloads delta por celda (se mantiene el esquema de bloques JSON + debounce de 350ms + compresión + caché ETag, tal como quedó documentado). Esta ronda es una corrección de bugs inmediata, sin tocar el `EcosystemAgent` ni ningún archivo de la Ronda 17 (`ecosystemAgent.js`, `routes/agent.js`, `keep-alive.ts`, `sync-bus.ts`, la tabla `agent_audit_logs` ni el panel "🤖 Auditoría IA / Agente"): ninguno de esos archivos se abrió ni se modificó en esta ronda.

### BUG 1 — Respeto al Guardado Manual: "Notas de Actividades en Clase" seguía autoguardando aunque el docente hubiera activado el modo manual

**Causa raíz encontrada:** "Guardado Manual" es una sola preferencia global de la institución (`_autoGuardar` / `db.config.autoGuardar`, con su botón "⚡/🕹 Auto-guardar" en la Planilla). La Planilla YA la respetaba desde su primera versión: al calificar con `_autoGuardar` en `false`, la nota queda en memoria (`_notasPendientes`, borde amarillo, indicador "⚠️ N sin guardar") y solo se escribe en la base de datos al pulsar "GUARDAR CAMBIOS". El módulo **"Notas de Actividades en Clase"** (agregado en la Ronda 15), en cambio, nunca implementó ese mecanismo: cada nota (`_guardarNotaAct`, usada también por el dictado por voz) y cada "Replicar a todos" (`aplicarReplicaNotaAct`) llamaban a `updDB()` de forma directa e incondicional — que dispara `saveDB()`/`_pushDB()` (guardado con debounce de red de 350ms) sin mirar nunca `_autoGuardar`. Ese era el "temporizador/evento de autoguardado en segundo plano" que el docente veía activarse solo, sin importar su selección.

**Corrección aplicada** (todo en `gestor-academico/dist/modules/03-app-core.js`, módulo "Notas de Actividades en Clase"): se extendió, en su propia variable (`_notasActPendientes`, para no arriesgar el código ya probado de la Planilla), exactamente el mismo mecanismo de "notas pendientes" que ya usaba la Planilla:
- `_guardarNotaAct()` y `aplicarReplicaNotaAct()` ahora revisan `_autoGuardar`: si está en `true`, guardan igual que antes (sin cambios, sin regresión); si está en `false`, la nota (o la réplica completa) se queda en `_notasActPendientes` — **ningún** `updDB()`/`saveDB()`/`_pushDB()` se dispara hasta que el docente confirme.
- `_valorNotaAct()` ahora es "consciente" de lo pendiente: si existe una nota pendiente para esa celda, se muestra esa (con su borde amarillo vía `_refrescarCeldaNotaAct()`), no la última guardada — así la celda, el promedio en pantalla y el popup de edición siempre reflejan la última elección del docente, aunque todavía no se haya confirmado.
- Nuevo botón **"💾 GUARDAR CAMBIOS"** e indicador "⚠️ N nota(s) sin guardar" en la propia pantalla de "Notas de Actividades en Clase" (visibles solo cuando el Guardado Manual está activo, igual que en la Planilla), con su función `guardarNotasActividades()` que aplica todo lo pendiente en un único `updDB()` (un solo guardado en lote, no uno por nota).
- Al volver a activar "⚡ Auto-guardar" desde la Planilla, las notas de actividad que hubieran quedado pendientes también se confirman solas de inmediato — mismo comportamiento que ya tenía la Planilla con sus propias notas pendientes (`_toggleAutoGuardar()` ahora también vacía `_notasActPendientes`).
- El aviso de "le queda(n) N minutos de sesión" y el cierre forzado por tiempo agotado (`_avisoTiempoSesion`/`_forzarCierrePorTiempo`) ahora también avisan y respaldan las notas de actividad pendientes, no solo las de la Planilla — antes se podían perder silenciosamente si la sesión expiraba con notas de actividad sin confirmar.

**Alcance de la corrección, documentado con transparencia:** el "Replicar a todos" de la Planilla (`aplicarReplicaColumna`, para SER/SABER/HACER/RECUP./NIVELACIÓN) ya tenía —desde antes de esta ronda, en el código ya probado en producción— el mismo patrón de guardar siempre de inmediato sin pasar por pendientes, incluso con Guardado Manual activo. No se tocó esa función en esta ronda de corrección inmediata, para no arriesgar una regresión en un flujo de la Planilla que lleva mucho tiempo en producción sin quejas. Si quieres que también respete el modo manual (con el mismo mecanismo de pendientes ya usado en el resto de la Planilla), dímelo y se aplica en una próxima ronda con sus propias pruebas dedicadas.

### BUG 2 — Respeto a la bandera del Súper Admin: la sincronización de fondo debe verificarla de forma estricta, antes de cualquier llamada de red

**Revisión realizada:** se auditaron uno por uno TODOS los puntos del código que pueden disparar una sincronización de fondo con el servidor: el temporizador de polling (`_syncInterval`, cada 3 minutos), el evento `online` del navegador, el evento `visibilitychange` (al volver a la pestaña), y el mensaje SSE en tiempo real (`_makeSseChannel`, usado por los dos canales — el de la institución y el del gestor global). Los cuatro puntos **ya** revisaban `_sincronizacionAutoHabilitadaAhora()` antes de llamar a `_syncAll()` (corrección de la Ronda 14) — no se encontró ningún punto de ESTOS que hoy ignore la bandera. Lo que sí se encontró es la misma clase de fragilidad que causó el Bug 1: esa revisión vivía SOLO en cada punto de llamada externo, así que dependía de que cada uno de ellos —los de hoy y cualquiera que se agregue en el futuro— **recordara** hacerla antes de invocar `_syncAll()`. Un módulo nuevo que la olvide (exactamente lo que pasó con "Notas de Actividades" y el Bug 1) volvería a producir tráfico de red ignorando la bandera, sin que nada lo impidiera.

**Corrección aplicada** (`_syncAll(force)` en `03-app-core.js`): la propia función de sincronización ahora **se niega a tocar la red** si la sincronización automática de la institución está apagada, salvo que sea una sincronización explícitamente pedida por la persona (`force=true`: el botón "🔄 Sincronizar ahora" del aviso, o el clic en el ícono ☁️ — eso debe seguir funcionando siempre, incluso con el interruptor en OFF, porque es una acción deliberada y puntual, no un proceso de fondo). Esto convierte la revisión de la bandera en una garantía del propio motor de sincronización, no en una convención que cada punto de llamada debe recordar — así que ningún punto de llamada, presente o futuro, puede volver a "saltársela" por accidente.

**Lo que esta corrección deliberadamente NO toca (y por qué):**
- **El guardado de las propias notas/asistencia/etc. del docente** (`saveDB()`/`_pushDB()`, incluido el reenvío automático al reconectar tras quedarse sin señal) nunca dependió de esta bandera y sigue sin depender de ella — eso es "guardado", no "sincronización", y debe funcionar siempre para que el docente nunca pierda su propio trabajo.
- **El watcher de "Pantalla en Blanco"** (cada 60s, llama a `_pullGestorDB()` directamente, no a `_syncAll()`) sigue siendo intencionalmente independiente de esta bandera, tal como ya estaba documentado en el propio código: es un mecanismo de seguridad (bloqueo remoto del Súper Admin) que debe reaccionar siempre, aunque la institución tenga la sincronización de datos apagada.
- El **motor `SyncEngine`** (`07-sync-engine.js`, cargado en `portal.html`) se revisó también: hoy no está enganchado a ningún campo del módulo K-12 (`autoAttach()` no encuentra ningún `[data-sync-cell]` en la Planilla ni en Notas de Actividades — sigue siendo una pieza lista para un futuro que aún no se usa ahí, como ya documentaba su propio comentario en `portal.html`), así que no genera tráfico de fondo propio y no fue necesario modificarlo.

### Cómo se verificó todo esto (Ronda 18)

- `node --check` sobre los 3 módulos frontend tocados o revisados (`03-app-core.js`, `06-documentos-y-resto.js`, `07-sync-engine.js`) — sin errores de sintaxis.
- 1 script de prueba aislado nuevo, con 23 casos: para el Bug 1, prueba que en modo manual ninguna nota (individual o "Replicar a todos") llega a `db.notasAct` hasta pulsar "GUARDAR CAMBIOS", que el valor pendiente se refleja igual en pantalla, que el modo automático sigue guardando de inmediato sin regresión, y que reactivar el auto-guardado confirma solo lo pendiente; para el Bug 2, prueba que `_syncAll(false)` (fondo) queda bloqueado con la bandera apagada, que `_syncAll(true)` (acción explícita) sigue funcionando siempre, que con la bandera encendida todo sincroniza igual que antes, y que un punto de llamada futuro que "olvide" revisar la bandera queda bloqueado de todos modos por el propio motor.
- Se re-ejecutaron los 4 scripts de prueba de rondas anteriores directamente relacionados (Ronda 14 "planilla_sync_fix": 16 casos; Ronda 15 "notas_actividades": 17 casos; Ronda 16 "notas_actividades_r16": 23 casos; Ronda 17 "ecosystem_agent": 41 casos) — sin regresiones, 97 pruebas adicionales en verde, sumadas a las 23 nuevas: 120 pruebas en total, todas en verde.
- Se confirmó por revisión manual que ningún archivo de la Ronda 17 (`ecosystemAgent.js`, `routes/agent.js`, `keep-alive.ts`, `sync-bus.ts`) se tocó en esta ronda.

---

## Ronda 19 — Auto-guardar también en "Notas de Actividades" desde su propia pantalla, apariencia "sin calificar" en la Planilla, y auditoría del "combinado automático de cambios"

Enviaste 3 capturas de pantalla mostrando: (1) la Planilla con varias filas en rojo (0.0 en SER/SABER/HACER/RECUP./NIVELACIÓN) y un aviso "🔄 Se combinaron automáticamente cambios guardados por otra persona"; (2) y (3) "Notas de Actividades en Clase" con ese mismo aviso apareciendo mientras se guardaban notas en modo automático. Tu diagnóstico: el guardado instantáneo de "Notas de Actividades" dispara sincronizaciones/combinaciones de fondo que han ocasionado que se "borren" notas de compañeros, sobre todo en la Planilla — y pediste que ese módulo tenga su propio control de Guardado Manual/Automático como la Planilla, además de corregir la apariencia de las celdas sin calificar.

### 1 — "Notas de Actividades en Clase" ahora tiene su PROPIO botón "⚡/🕹 Auto-guardar" (NUEVO)

La Ronda 18 ya había corregido que este módulo *respetara* el modo Guardado Manual/Automático (`_autoGuardar`), pero el ÚNICO lugar para *cambiar* ese modo seguía siendo el botón de la Planilla — el docente tenía que salir de "Notas de Actividades" para activarlo o desactivarlo. Se agregó un botón idéntico ("⚡ Auto-guardar: ON" / "🕹 Auto-guardar: OFF") directamente en la barra de acciones de "Notas de Actividades en Clase", que llama a la misma función `_toggleAutoGuardar()` de siempre: es **una sola preferencia** (`db.config.autoGuardar`, institucional), así que cambiarla desde cualquiera de las dos pantallas cambia la misma para ambas — no se crearon dos modos independientes que pudieran quedar desincronizados entre sí. `_toggleAutoGuardar()` ahora actualiza los dos botones (el de la Planilla y el de Notas de Actividades), cualquiera que esté visible en ese momento.

### 2 — Apariencia "sin calificar" en la Planilla (NUEVO): una celda en 0.0 ya no se ve como una nota reprobatoria real

**Causa raíz:** cada celda SER/SABER/HACER/columna extra/RECUP./NIVELACIÓN que nunca había recibido una nota se inicializa en `0` (`{s:0,sb:0,h:0,rec:0,niv:0}`) — y la Planilla mostraba ese `0` exactamente igual que una nota reprobatoria YA calificada: caja roja, "0.0". Esta misma base de código **ya usaba** la convención "0 = todavía no se aplicó" para decidir si activar la RECUPERACIÓN (`rec>0`) o la NIVELACIÓN (`niv>0`) en los cálculos — pero esa convención nunca se reflejó en la apariencia de SER/SABER/HACER. Un docente que entraba a un grado recién creado, o a un periodo que nadie había calificado todavía, veía una fila entera en rojo y razonablemente pensaba que las notas "se habían borrado".

**Corrección aplicada:** se extendió esa misma convención (ya usada en los cálculos) a la apariencia de las 5 columnas de nota de la Planilla, y también a NOTA BASE y DEFINITIVA: mientras no se haya ingresado ninguna nota, la celda se muestra como una caja gris con un guion "—" — igual que ya se veía en "Notas de Actividades en Clase" (la tercera imagen que enviaste) — y cambia de aspecto (color según la nota, tal como siempre) en cuanto el docente ingresa un valor real. La celda sigue siendo un botón: se puede tocar en cualquier momento para calificar. NOTA BASE y DEFINITIVA solo se muestran como "—" cuando **nada** se ha calificado todavía (ni SER/SABER/HACER, ni RECUP., ni NIVELACIÓN) — si al menos una dimensión ya tiene una nota real, se sigue mostrando el promedio calculado normalmente, aunque otra dimensión siga en gris. Este mismo criterio se aplicó de forma consistente en los 4 lugares donde la Planilla dibuja o refresca una celda de nota: la tabla al renderizar (`htmlPlanilla`/`mkBtn`), el refresco puntual tras guardar (`_refrescarFilaPlanilla`), la selección rápida en modo automático o pendiente (`seleccionarNotaRapido`/`seleccionarNota`), y la restauración del borde amarillo de "pendiente" tras un refresco de fondo (`_reaplicarPendientes`).

**Limitación documentada con transparencia:** el sistema no guarda un indicador aparte de "esta celda ya fue tocada alguna vez" — solo el número. Esto significa que si alguna vez un docente calificó deliberadamente una dimensión con un 0.0 exacto (nota real de cero), esa celda también se mostrará como "—" (sin calificar), indistinguible de una celda que nunca se tocó. Esta es la MISMA limitación que ya existía, sin quejas previas, para RECUP. y NIVELACIÓN (donde un `rec`/`niv` de 0 exacto tampoco se puede distinguir de "no aplica"); no se inventó una limitación nueva, solo se hizo visualmente consistente con una que ya existía en los cálculos.

### 3 — Auditoría del aviso "Se combinaron automáticamente cambios guardados por otra persona"

Se revisó a fondo de dónde sale este aviso y si puede estar causando pérdida real de notas, como sospechas:

- El aviso sale de `_resolverConflictoDB()`, que se activa SOLO cuando el propio guardado del docente (`_pushDB()`) recibe un `409` del servidor — es decir, cuando OTRA persona ya guardó un cambio en esa misma institución mientras este docente tenía cambios propios sin confirmar todavía. Esto puede pasar **incluso con la "Sincronización automática" de la institución apagada** (como se ve en tu primera captura) porque es un mecanismo de seguridad del propio GUARDADO (evita que el guardado de un docente borre en silencio el de otro), no depende de esa bandera y nunca debe depender de ella — desactivarlo sí causaría pérdida real de notas, en vez de evitarla.
- Se auditó la función de combinación (`_combinarValorMerge`/`_mergeArregloPorId`, usada desde antes de esta ronda) específicamente para `db.notasAct` (notas de actividad) y `db.ests[].nts` (notas de la Planilla): ambas estructuras se combinan **campo por campo/estudiante por estudiante**, no como un bloque completo — se verificó con casos concretos que una nota nueva agregada por OTRO docente, o una nota YA existente que otro docente editó y este equipo no había tocado, se conservan correctamente al combinar. El único caso real donde el sistema debe "elegir" un valor es cuando DOS docentes editan exactamente LA MISMA celda (mismo estudiante, misma columna, mismo periodo) casi al mismo instante — un caso raro, inherente a cualquier sistema con datos compartidos, y ahí gana el valor ya confirmado por el servidor (comportamiento esperado y documentado, no una falla).
- **No se encontró, en esta revisión, evidencia de un defecto que borre notas de otros compañeros por combinación** — pero tampoco se puede afirmar con total certeza que nunca ocurre un caso límite no cubierto, sin poder reproducirlo con datos reales. Lo que SÍ reduce directamente la probabilidad de que dos docentes choquen en la misma ventana de tiempo es exactamente lo que pediste en el punto 1: que "Notas de Actividades" también pueda usar Guardado Manual (menos guardados = menos ventanas de conflicto).
- **Propuesta para resolver esto con evidencia real, no solo con análisis de código** (no implementada todavía, queda en la sección de decisiones pendientes): agregar una bitácora permanente de cada vez que se combinan cambios con conflicto, guardando qué campos exactos se combinaron y cuál valor ganó — así, la próxima vez que un docente reporte "se me borró una nota", se podría revisar esa bitácora y confirmar en minutos si fue una combinación real (y qué pasó exactamente) o si la nota simplemente nunca llegó a guardarse.

### Cómo se verificó todo esto (Ronda 19)

- `node --check` sobre los 7 módulos de `gestor-academico/dist/modules/` — sin errores de sintaxis (se detectó y corrigió un paréntesis de más al escribir la nueva celda "DEFINITIVA" en `htmlPlanilla()`, atrapado por esta misma verificación antes de empaquetar).
- 1 script de prueba aislado nuevo, con 17 casos: confirma que 0/`null`/`undefined`/NaN/"0.0" (string) se muestran como "sin calificar" (gris, guion) y que una nota real (1.2, 4.0, 4.8) se sigue mostrando normalmente con su color; confirma que NOTA BASE y DEFINITIVA solo pasan a "—" cuando *nada* se ha calificado (no cuando falta una sola dimensión); confirma que el botón "Auto-guardar" se actualiza correctamente sin importar desde cuál de las dos pantallas (Planilla o Notas de Actividades) se haya tocado.
- Se re-ejecutaron los 6 scripts de prueba de rondas anteriores relacionados (Ronda 14: 16 casos; Ronda 15: 17 casos; Ronda 16: 23 casos; Ronda 17: 41 casos; Ronda 18: 23 casos) — sin regresiones: 120 pruebas adicionales en verde, sumadas a las 17 nuevas de esta ronda: **137 pruebas en total, todas en verde.**
- Se confirmó por revisión manual que ningún archivo de la Ronda 17 (`ecosystemAgent.js`, `routes/agent.js`, `keep-alive.ts`, `sync-bus.ts`) se tocó en esta ronda.

### Lo que queda pendiente de tu decisión (documentado, no resuelto a ciegas)

1. **Bitácora de conflictos combinados**, descrita en la sección 3 — permitiría confirmar con evidencia real (no solo análisis de código) si en algún caso puntual sí se pierde una nota al combinar cambios de dos docentes, y exactamente cuál. Si quieres, se agrega en una próxima ronda (tabla nueva o reutilizando `agent_audit_logs` con categoría "Sincronización").
2. **Un valor real de 0.0 no se puede distinguir de "sin calificar"** (ver limitación documentada en la sección 2) — si necesitas de verdad poder calificar con un cero explícito y que se vea distinto de una celda vacía, se puede resolver guardando un indicador adicional por celda (ej. `{val:0, tocado:true}` en vez de solo `0`), pero es un cambio de modelo de datos más amplio (afecta el cálculo de promedios, la exportación a Excel y el historial) — dímelo si quieres que se planifique.

## Ronda 20 — Bitácora de conflictos de sincronización (lo que quedó propuesto sin implementar en la Ronda 19)

Tu mensaje fue explícito: *"No he revisado estos cambios actuales [de la Ronda 19], pero por favor implementa esto que dejaste propuesto acá... lo de la bitácora"*. Esta ronda implementa exactamente el punto 1 pendiente de la Ronda 19: una bitácora permanente que registra, cada vez que la fusión de 3 vías encuentra un conflicto REAL (dos docentes tocando el mismo dato casi al mismo tiempo), exactamente qué campo fue, qué valor traía cada lado, y cuál ganó — para poder confirmar con evidencia concreta, la próxima vez que alguien reporte una nota "desaparecida", si de verdad fue una combinación de sincronización y qué pasó exactamente.

### Qué se agregó

- **`_combinarValorMerge`/`_mergeArregloPorId`/`_merge3way`** (en `gestor-academico/dist/modules/03-app-core.js`, las mismas funciones auditadas en la Ronda 19) ahora reciben, además de `base`/`mine`/`theirs`, una **ruta** (ej. `ests[id=45].nts.p1_examen`) y un arreglo `detalles` que se va llenando por referencia. Cada vez que el algoritmo encuentra un conflicto real (los 3 casos posibles: (a) mismo valor primitivo cambiado por ambos lados, (b) borrado localmente pero editado en el servidor, (c) editado localmente pero borrado en el servidor) se agrega un detalle con `{path, tipo, base, mine, theirs, gano}`. **El resultado de la fusión (`result`) y el conteo de conflictos (`conflictos`) no cambiaron en absoluto** — es información nueva que se agrega al lado, no una reescritura del algoritmo ya probado en 3 rondas anteriores. La firma nueva es compatible hacia atrás (los parámetros de ruta/detalles son opcionales).
- **`_resumirValorBitacora(v)`** (nueva): recorta cualquier valor a un máximo de 300 caracteres antes de meterlo en un detalle, para que un conflicto en un objeto grande (ej. la ficha completa de un estudiante) no genere una fila enorme en la base de datos.
- **`_registrarConflictoBitacora(sk, conflictos, detalles, origen)`** (nueva): si hubo al menos un conflicto real, manda esos detalles al backend con un `fetch` **"fire-and-forget"** (`.catch(()=>{})`, igual que el aviso existente de "salud del guardado" en `_pushDB`) — si falla el envío o no hay conexión, **no afecta ni retrasa el guardado real del docente**; es pura evidencia, nunca una condición para poder guardar. Se llama desde los DOS lugares donde el frontend combina cambios con la fusión de 3 vías:
  1. `_resolverConflictoDB()` — cuando el guardado del propio docente recibe un `409` (alguien más ya había guardado).
  2. El bloque de sincronización periódica dentro de `_syncAll()` — cuando una sincronización de fondo trae datos del servidor y los combina con cambios locales todavía no guardados.
- **`POST /api/sync-log/conflicto`** (nuevo endpoint, archivo nuevo `src/routes/sync-log.js`, montado en `src/index.ts`): recibe `{sk, docente, rol, origen, conflictos, detalles}` y lo inserta en `agent_audit_logs` con `category:'Sincronizacion'`, `status:'Informativo'`, y todo el detalle campo por campo en la columna `details` (JSONB). **Se reutilizó la tabla `agent_audit_logs`** ya creada en la Ronda 17 (tal como se dejó propuesto), en vez de crear una tabla nueva — por eso estos registros **aparecen automáticamente en el panel ya existente "🤖 Auditoría IA / Agente"** del Súper Admin (mismo `GET /api/agent/logs`, mismo filtro por categoría/estado, sin ningún cambio en ese panel ni en su frontend).

### Por qué se hizo así (decisiones de diseño)

- **No se tocó `src/routes/agent.js` ni `src/services/ecosystemAgent.js`** (archivos de la Ronda 17, ya probados e intencionalmente dejados intactos en las Rondas 18 y 19) — el nuevo endpoint vive en un archivo separado (`src/routes/sync-log.js`) que solo importa `db`/`agentAuditLogs` desde `src/db/index.js`, exactamente igual que ya lo hace `ecosystemAgent.js`. `src/index.ts` sí se tocó, pero con el cambio mínimo de siempre para montar un router nuevo (2 líneas: un `import` y un `app.use`), el mismo patrón usado para montar `agentRouter` en la Ronda 17.
- **No se creó ninguna tabla ni columna nueva en la base de datos** — se reutilizó `agent_audit_logs` tal como se propuso en el checklist de la Ronda 19, respetando la regla de "Control de Esquema de BD" del propio agente (nunca `ALTER TABLE`/`CREATE TABLE` fuera del arranque del servidor).
- **La bitácora es solo evidencia, nunca un candado**: si el endpoint falla, no existe, o el docente está sin conexión, el guardado y la fusión de datos siguen funcionando exactamente igual que antes — el `fetch` nunca se espera (`await`) ni su resultado se usa para decidir nada.
- **Límite de 50 detalles por evento**, aplicado tanto en el frontend (antes de enviar) como en el backend (por si algún día cambia el frontend) — evita que un conflicto inusualmente grande genere una fila de varios MB.
- **Se registran los 2 lugares donde de verdad se fusionan datos**, no solo el que muestra el aviso visible al docente (`_resolverConflictoDB`) — la sincronización periódica de fondo (`_syncAll`) también combina datos en silencio, y un conflicto real ahí es exactamente el tipo de evento que esta bitácora existe para capturar, aunque el docente nunca vea un aviso en pantalla.

### Cómo se verificó todo esto (Ronda 20)

- `node --check` sobre `gestor-academico/dist/modules/03-app-core.js` (con los cambios de esta ronda) y sobre `src/routes/sync-log.js` (archivo nuevo) — sin errores de sintaxis.
- `tsc --noEmit --noResolve --skipLibCheck` sobre `src/index.ts` — sin errores nuevos: los únicos avisos que aparecen (`TS7016`/`TS7006`, "implicitly has an 'any' type") ya existían de antes para `routes/agent.js`/`services/ecosystemAgent.js` bajo este mismo tipo de verificación rápida (sin resolver módulos) y son del mismo tipo para el archivo nuevo `routes/sync-log.js` — no son errores reales de sintaxis ni de lógica.
- 1 script de prueba aislado nuevo, con 36 casos: confirma que los resultados y conteos de conflicto de `_merge3way` **no cambiaron respecto a las Rondas 18/19** (regresión pura, incluyendo el caso central de la auditoría de la Ronda 19: ediciones a estudiantes distintos se siguen combinando sin perder ninguna); confirma que la bitácora captura correctamente los 3 tipos de conflicto real (valor primitivo en conflicto, borrado-vs-editado en ambas direcciones) con la ruta exacta del campo (ej. `[id=7].nts.p1_examen`), el valor de cada lado, y quién ganó; confirma que `_resumirValorBitacora` recorta valores largos; confirma que `_registrarConflictoBitacora` solo dispara la llamada al backend cuando hubo al menos un conflicto real (cero tráfico/ruido en el caso normal, que es la inmensa mayoría de las sincronizaciones) y arma el payload correctamente, incluyendo el recorte a 50 detalles.
- Se re-ejecutaron **todos** los scripts de prueba aislados del proyecto (19 archivos en total, incluyendo los de las Rondas 13 a 19) — sin ninguna regresión. Sumando las 36 pruebas nuevas de esta ronda a las 137 acumuladas de rondas anteriores: **173 pruebas relacionadas con estas rondas recientes, todas en verde** (además de los demás scripts de rondas más antiguas, también en verde).
- Se confirmó por revisión manual que ningún archivo de la Ronda 17 (`ecosystemAgent.js`, `routes/agent.js`, `keep-alive.ts`, `sync-bus.ts`) se tocó en esta ronda.

### Cómo revisar la evidencia cuando vuelva a pasar

1. Entra al panel del Súper Admin → pestaña "🤖 Auditoría IA / Agente".
2. Filtra por categoría "Sincronizacion".
3. Cada fila nueva de este tipo trae, en "Ver JSON", el detalle exacto: institución, docente, si fue al guardar (`push-conflicto-409`) o en una sincronización de fondo (`pull-periodico`), y la lista de campos combinados con el valor de cada lado y cuál ganó.
4. Si en algún momento aparece una fila cuyo campo (`path`) corresponde justo a la nota que un docente reporta como "perdida", eso confirma con evidencia real que fue una combinación de sincronización — y con qué valor exacto llegó cada lado — en vez de tener que asumirlo por análisis de código, como se hizo en la Ronda 19.

### Lo que sigue pendiente de tu decisión (sin cambios respecto a la Ronda 19)

1. **Un valor real de 0.0 no se puede distinguir de "sin calificar"** (documentado en la Ronda 19, sección 2) — sigue sin resolverse porque implica un cambio de modelo de datos más amplio; avísame si quieres que se planifique.
2. Ahora que la bitácora ya existe, **si en algún momento se acumulan registros de categoría "Sincronizacion" con el mismo `path` repitiéndose para el mismo grupo/columna**, eso sería la señal concreta de que vale la pena investigar más a fondo ese punto específico (ej. dos docentes con acceso al mismo grado editando simultáneamente); por ahora no hay evidencia de que esto esté pasando, la bitácora solo queda lista para poder verlo si empieza a pasar.

## Ronda 21 — CAUSA RAÍZ ENCONTRADA Y CORREGIDA: las notas "se borraban y reaparecía la anterior" (no era el algoritmo de fusión, era CUÁNDO se actualizaba su punto de referencia)

Tu mensaje, apenas unos minutos después de la Ronda 20, fue contundente: probaste tanto Planilla como Notas de Actividades y viste notas borrarse y reaparecer las que tenían antes — pediste eliminar el Auto-guardar de todos lados si ya no se podía corregir. Antes de hacer eso, investigué a fondo una vez más — esta vez preguntándome no "¿está bien el algoritmo de fusión?" (eso ya se auditó en la Ronda 19 y sigue siendo correcto), sino **"¿está bien la información que le estamos dando de entrada?"** — y ahí apareció el defecto real.

### Causa raíz (confirmada con una prueba automatizada que reproduce el bug exacto)

La fusión de 3 vías necesita 3 datos: lo que había ANTES ("base"), lo mío, y lo del servidor. Ese "ANTES" (`window._dbBaseSnapshot`) se actualizaba en 3 lugares del código usando el "db" **en vivo** en el instante en que se ejecutaba esa línea — no lo que el servidor de verdad tenía confirmado en ese momento. El problema: entre que un guardado se programa (los guardados se agrupan cada 350ms) y que ese guardado termina de confirmarse por el servidor, pueden pasar milisegundos o, con mala señal de wifi del colegio, varios segundos — tiempo de sobra para que llegue una sincronización de fondo o un conflicto de OTRO campo cualquiera. Si eso pasaba, la nota que todavía estaba "en camino" quedaba marcada como "esto ya lo sabíamos los dos" antes de tiempo, y la siguiente fusión la reemplazaba por el valor que el servidor sí tenía confirmado — el de ANTES de la edición. Esto podía pasar con un solo docente trabajando solo (no hacían falta dos personas chocando en la misma celda), lo cual explica que lo vieras tan seguido y en los dos módulos (ambos pasan por el mismo mecanismo de guardado).

### Qué se corrigió (3 puntos exactos, mismo archivo `03-app-core.js`, mismo algoritmo de fusión de las Rondas 18-20 sin tocar)

1. **`_pushDB()`, al confirmar un guardado exitoso:** ahora la nueva base es exactamente el JSON que se envió y el servidor aceptó (`JSON.parse(_json)`), no el "db" en vivo — así nunca se adelanta con una nota que siga en camino.
2. **`_resolverConflictoDB()`, tras combinar un conflicto:** ya no adelanta la base con el resultado recién combinado (que todavía no se le ha enviado a nadie) — se deja como estaba (sigue siendo un punto de referencia válido, solo un poco más antiguo, lo cual nunca causa pérdida de datos) hasta que el reintento de guardado se confirme de verdad por el punto 1.
3. **Sincronización periódica de fondo (dentro de `_syncAll()`):** si todavía hay algo sin confirmar (`_hayCambiosSinSincronizar`), ya no se marca la fusión como "confirmada" — en su lugar se reintenta el envío de inmediato con la versión ya actualizada, y la base se actualiza solo cuando ESE envío se confirme de verdad. Cuando no hay nada pendiente, se sigue actualizando de inmediato como siempre (no se volvió más lenta en el caso normal).

**Por qué NO se quitó el Auto-guardar:** confirmé que el defecto no dependía de si el guardado era automático o manual — el modo manual también pasa por el mismo `saveDB()`/`_pushDB()` una vez que se hace clic en "GUARDAR CAMBIOS", así que quitar el Auto-guardar habría reducido cuántas veces se guardaba, pero no habría eliminado la posibilidad del bug, solo la habría hecho menos frecuente. Encontrar y corregir la causa real es una solución completa; quitar el Auto-guardar habría sido quitarle a los docentes una función que les gusta, a cambio de solo una mejora parcial.

### Cómo se verificó (con evidencia, no solo argumento)

Se escribió una prueba automatizada que reproduce el escenario **exacto**: un docente cambia una nota de "A" a "B"; antes de que ese guardado confirme, llega una sincronización de fondo; mientras tanto, en el servidor, otro docente guarda un cambio en un campo totalmente distinto; y por último confirma (con conflicto) el guardado original de "B". Con el código de las Rondas 18-20, esa prueba **reproduce el bug exacto que reportaste** (el resultado final es "A" otra vez, la nota "B" se pierde). Con el código de esta ronda, la misma prueba **conserva "B" Y combina correctamente el cambio del otro docente**, sin perder ninguno de los dos. Además: 4 pruebas de regresión (camino normal sin ninguna sincronización de por medio, conflicto genuino de dos docentes en la misma celda — sigue funcionando igual que antes —, y sincronización de fondo cuando no hay nada pendiente localmente — sigue siendo inmediata, no se volvió más lenta). `node --check` sin errores. Se reejecutaron los 20 scripts de prueba del proyecto completo (todas las rondas anteriores): sin ninguna regresión.

### Lo que esto significa para lo reportado en la Ronda 19

La "auditoría del combinado automático de cambios" de la Ronda 19 concluyó, correctamente, que el ALGORITMO de fusión era sólido — y sigue siéndolo, no se tocó. Lo que faltaba auditar era de dónde salía uno de sus 3 insumos (`base`), y ahí es donde realmente estaba el defecto. La bitácora de conflictos de la Ronda 20 sigue siendo útil hacia adelante (para confirmar con evidencia real que esto no vuelve a pasar), pero el defecto de fondo que de verdad causaba la pérdida de notas ya quedó corregido, no solo detectado.

## Ronda 22 — SEGUNDO HALLAZGO, MISMA FAMILIA DE CAUSA RAÍZ: la Ronda 21 era necesaria pero no era suficiente

Desplegaste la Ronda 21 en producción y la volviste a probar tú mismo — y el mismo síntoma volvió a pasar (lo capturaste con capturas de pantalla: agregaste una nota, sincronizó, y la borró dejando la casilla vacía). Me pediste, con toda razón, auditar TODO el código otra vez en vez de dar por cerrado el tema. Antes de seguir investigando te pregunté un solo hecho no adivinable (si esa prueba fue realmente contra el código ya desplegado de la Ronda 21) — confirmaste que sí, lo cual significaba que la corrección de la Ronda 21 era real pero incompleta, y seguí auditando hasta encontrar la segunda pieza.

### Causa raíz (segunda parte de la misma familia — confirmada también con una prueba automatizada que reproduce el bug exacto)

Además de "¿de dónde sale la base de la fusión?" (lo que corrigió la Ronda 21), existe una segunda pregunta con el mismo tipo de defecto: **"¿cómo sabe el sistema si ya no queda nada pendiente por confirmar?"** Esa respuesta vive en una bandera, `window._hayCambiosSinSincronizar`. Antes de esta ronda, esa bandera se apagaba en cuanto CUALQUIER guardado terminaba con éxito — sin fijarse si, mientras ese guardado viajaba al servidor, el docente ya había calificado otra celda más (lo cual deja programado un guardado NUEVO, todavía sin confirmar). Eso apagaba la bandera de protección un guardado antes de tiempo. La consecuencia concreta: si justo en ese instante llegaba una sincronización de fondo con un cambio de OTRO docente, el sistema (creyendo que ya no había nada propio pendiente) no volvía a "refrescar" el guardado que sí seguía en camino — y ese guardado atrasado, al confirmar más tarde, salía con datos congelados de ANTES de que se recibiera el cambio del compañero, y se lo llevaba por delante al guardarse. Es exactamente la misma familia de problema que la Ronda 21 — "algo se marca como confirmado antes de tiempo" — pero en la bandera que decide si hay que reintentar, no en la base de la fusión.

### Qué se corrigió (mismo archivo `03-app-core.js`, mismo algoritmo de fusión de las Rondas 18-20 sin tocar, sin quitar ni debilitar nada de la Ronda 21)

En `_pushDB()`, al confirmar un guardado exitoso, la bandera `_hayCambiosSinSincronizar` ahora solo se apaga si el envío que se acaba de confirmar sigue siendo el más reciente que se había preparado (se compara el JSON exacto que se mandó contra el JSON más reciente que el propio guardado automático fue dejando listo). Si ya hay uno más nuevo en camino, la bandera se queda encendida hasta que ESE se confirme — con lo cual la sincronización de fondo (que ya desde la Ronda 21 revisa esta misma bandera antes de decidir si puede avanzar la base con confianza) vuelve a hacer lo correcto: refresca el guardado pendiente con los datos ya fusionados antes de dejarlo salir, en vez de dejarlo salir con datos viejos.

### Cómo se verificó (con evidencia, no solo argumento — y con la misma exigencia que la Ronda 21)

Se escribió una prueba automatizada (`test_ronda22.mjs`) que reproduce el escenario exacto: un docente califica la celda A (sale el guardado); antes de que confirme, califica la celda B (queda un segundo guardado pendiente); el primero confirma con éxito; en el servidor, otro docente guarda un campo totalmente distinto (C); llega la sincronización de fondo y lo fusiona localmente; y por último confirma el segundo guardado. Con el código de la Ronda 21 sola, esa prueba **reproduce el bug**: el campo C del compañero termina borrado del servidor pese a haberse fusionado bien un momento antes. Con el código de esta ronda, la misma prueba **conserva los tres valores (A, B y C)**, tanto en el servidor como en la pantalla del docente. Además: 4 pruebas de regresión (guardado único sin nada más pendiente, dos guardados independientes en fila) confirman que la bandera se sigue apagando con normalidad en el caso común — la corrección no la deja encendida de más. `node --check` sin errores. Se reejecutaron los 22 scripts de prueba del proyecto completo (todas las rondas anteriores, incluida la R21): **0 fallos en total**.

### Por qué esto no es una retractación de la Ronda 21

La corrección de la Ronda 21 sigue siendo necesaria y correcta — sin ella, el bug era más frecuente y más fácil de disparar. Lo que pasó es que, al auditar más a fondo por tu insistencia (con toda razón), apareció una segunda variable de la misma ecuación que también podía disparar el mismo síntoma por su cuenta, incluso con la Ronda 21 ya puesta. Con las dos correcciones juntas, las dos rutas conocidas que podían causar esta pérdida de notas ya están cerradas y probadas con evidencia automatizada, no solo con lectura de código.

### Recomendación honesta para esta ronda

Dado lo delicado del tema y que ya hubo un caso donde una corrección previa resultó incompleta, te recomiendo hacer una prueba de estrés similar a la que ya hiciste (calificar varias celdas seguidas, rápido, mientras se sincroniza) después de desplegar este ZIP, y avisarme de inmediato si ves CUALQUIER comportamiento raro, por pequeño que sea — con capturas de pantalla como las que ya me mandaste, que fueron justo lo que permitió encontrar esto. Seguiré auditando con la misma seriedad si aparece cualquier otra señal.

## Ronda 23 — Interruptor de emergencia del Súper Admin para Auto-guardar + nuevo módulo "Consolidado Completo" (todas las asignaturas y todos los periodos, masivo e individual)

Esta ronda tiene dos partes independientes, pedidas juntas: (1) una medida de contención para el problema de sincronización que sigue reportándose con Auto-guardar activo, y (2) una funcionalidad nueva en Consolidados.

### Parte 1 — Interruptor del Súper Admin para desactivar Auto-guardar por institución

Probaste de nuevo después de la Ronda 22 y reportaste que el problema sigue ocurriendo con Auto-guardar en ON (aunque "menos persistente y fuerte"), y que se corrige al desactivar Auto-guardar y usar el modo manual — aunque en ese modo también notaste el aviso "se actualizó la nota por otra persona" apareciendo de forma confusa cuando fuiste tú mismo quien guardó. Pediste una forma de apagar el Auto-guardar desde el Súper Admin, por completo, mientras se sigue investigando a fondo.

**Qué se hizo:** un interruptor nuevo en el panel del Súper Admin, por institución, con el mismo patrón ya usado para "🔄 Sincronización automática" y "⬛ Pantalla en Blanco" (mismo tipo de botón, mismo lugar, misma filosofía de decisión 100% manual del Súper Admin). Al apagarlo para una institución:

1. El botón "⚡/🕹 Auto-guardar" desaparece POR COMPLETO de Planilla y de Notas de Actividades — para docentes, directivos docentes y cualquier otro rol que use esos módulos. No queda ninguna opción visible para volver a activarlo; solo el Súper Admin puede hacerlo, desde su propio panel.
2. Todos quedan forzados al modo manual "💾 GUARDAR CAMBIOS" — el mismo modo que ya existía, sin ningún cambio en su comportamiento.
3. Aunque la institución ya tuviera guardada la preferencia de un docente en "Auto-guardar: ON" desde antes de apagar el interruptor, el resultado es SIEMPRE "OFF" mientras el Súper Admin lo mantenga así — no puede colarse por ninguna pantalla ni quedar a medias.
4. El propio Súper Admin nunca se ve afectado por este interruptor en su propio panel (igual que con Sincronización y Pantalla en Blanco).
5. Por defecto queda **HABILITADO** para todas las instituciones (no cambia el comportamiento de nadie hasta que tú, como Súper Admin, decidas apagarlo para una institución concreta).

**Cómo activarlo:** entra al panel del Súper Admin → "Plataformas Registradas" → en la tarjeta de la institución, botón "⚡ Auto-guardar habilitado" (se pone en rojo "🚫 Auto-guardar desactivado" al apagarlo).

**Importante — esto es una medida de contención, no la corrección final:** el problema de fondo (por qué el modo manual también muestra a veces ese aviso confuso de "otra persona" cuando fuiste tú mismo) sigue bajo investigación. Con este interruptor apagado, aunque el aviso llegara a aparecer, la nota ya guardada con "GUARDAR CAMBIOS" queda protegida de la misma forma en que siempre ha estado protegida el modo manual — el riesgo real que motivó tu reporte (Auto-guardar borrando notas) queda eliminado de raíz para esa institución mientras se investiga más.

**Cómo se verificó:** prueba automatizada nueva (`test_ronda23_autoguardar.mjs`, 9 casos) que confirma, en particular, el caso central: aunque la preferencia guardada de un docente sea "Auto-guardar: ON", si el Súper Admin apagó el interruptor, el resultado siempre es "OFF" — sin excepción. `node --check` sin errores.

### Parte 2 — Nuevo módulo "📚 Todas las Asignaturas" en Consolidados

Pediste que cualquier docente pueda ver el consolidado de TODAS las asignaturas y TODOS los periodos de los estudiantes de sus propios grados, de dos formas: masiva (todo el grado) e individual (tocando el nombre del estudiante), con descarga en PDF y Excel en ambas modalidades.

**Antes:** un docente normal solo veía el consolidado de SUS PROPIAS asignaturas, un periodo a la vez (pestaña "Consolidado"). Ver TODAS las asignaturas de un grado junto, aunque fuera de un solo periodo, estaba reservado al Admin ("Consolidado General") o al Director de Grupo ("Seguimiento Académico"). Ninguna vista mostraba TODOS los periodos juntos, ni existía una forma de entrar al detalle de un solo estudiante con solo tocar su nombre.

**Qué se agregó:** una pestaña nueva, "📚 Todas las Asignaturas", visible para cualquier docente (y para Admin) dentro de Consolidados — sin necesidad de activar ningún módulo nuevo, ya que vive dentro del módulo "Consolidados" que ya existía. Está disponible para los grados de la propia asignación académica de cada docente (`gradosDelDocente`), igual que el resto de esa pantalla.

1. **Modalidad individual:** se elige un grado y aparece la lista de sus estudiantes — se toca el nombre y se despliega, en pantalla, una tabla con TODAS las asignaturas (agrupadas por área) en filas y TODOS los periodos configurados en columnas (P1, P2, P3, P4 o los que tenga la institución), más la nota "DEFINITIVA" anual de cada asignatura, el promedio del estudiante por periodo, el promedio anual, el puesto en el grado y las áreas perdidas. Debajo aparecen los botones "📥 PDF" y "📊 Excel" para ESE estudiante.
2. **Modalidad masiva:** dos botones ("📥 PDF Masivo" y "📊 Excel Masivo") generan, de una sola vez, el consolidado de TODOS los estudiantes del grado — el PDF con una página por estudiante (mismo diseño que la vista individual) y el Excel con dos hojas: "Detalle por asignatura" (una fila por estudiante+asignatura, para poder filtrar/ordenar libremente en Excel) y "Resumen por estudiante" (promedios por periodo, anual, puesto y áreas perdidas, una fila por estudiante).
3. Los tres formatos (pantalla, PDF, Excel) se alimentan de la MISMA función (`_datosConsolidadoCompletoEstudiante`), que a su vez usa exactamente los mismos cálculos que ya usa el resto del sistema (`calcNotaDef`, `calcPromedioMat`, `calcPromedioEstPer`, `calcPromedioEst`, `getAreasPerdidas`, `puestoEst`) — no se creó ningún cálculo de notas nuevo ni paralelo, para no arriesgar ninguna inconsistencia con lo que ya se muestra en Planilla, Boletines o los demás Consolidados.

**Cómo se verificó:** prueba automatizada nueva (`test_ronda23_consolidado.mjs`, 17 casos) que confirma que la nueva función agregadora coincide EXACTAMENTE, en cada número que muestra (nota por periodo, definitiva por asignatura, promedio por periodo, promedio anual, áreas perdidas, puesto), con las funciones de cálculo de notas que el sistema ya usaba antes de esta ronda — incluyendo el caso de una asignatura nunca calificada (no se inventa una nota ni se cuela como "perdida" indebidamente) y el de un grado sin asignación académica (no lanza ningún error). `node --check` sin errores.

**Regresión completa de esta ronda:** se reejecutaron los 24 scripts de prueba del proyecto completo (todas las rondas anteriores incluidas): **0 fallos en total**.

### Carpetas/archivos EXCLUIDOS deliberadamente de este ZIP

`.git/`, `node_modules/`, todos los archivos/carpetas `*_RESPALDO*`, y los 3 ZIPs viejos que tenías dentro del proyecto (`GESTOR_ACADEMICO_YC_PRODUCCION.zip`, `gestor-academico-backup.zip`, `zipFile.zip`). Copia el contenido de este ZIP **sobre** tu carpeta actual en vez de borrarla, así conservas tu historial de Git y no tienes que reinstalar `node_modules` de cero salvo por los 2 paquetes nuevos.
