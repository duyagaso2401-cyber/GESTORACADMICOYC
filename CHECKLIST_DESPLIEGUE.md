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

### Carpetas/archivos EXCLUIDOS deliberadamente de este ZIP

`.git/`, `node_modules/`, todos los archivos/carpetas `*_RESPALDO*`, y los 3 ZIPs viejos que tenías dentro del proyecto (`GESTOR_ACADEMICO_YC_PRODUCCION.zip`, `gestor-academico-backup.zip`, `zipFile.zip`). Copia el contenido de este ZIP **sobre** tu carpeta actual en vez de borrarla, así conservas tu historial de Git y no tienes que reinstalar `node_modules` de cero salvo por los 2 paquetes nuevos.
