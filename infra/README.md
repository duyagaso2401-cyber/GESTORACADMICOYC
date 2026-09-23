# Cómo desplegar GESTOR ACADÉMICO YC en su propio servidor (VPS)

Esta guía es para quien **NO** es programador pero sabe abrir una terminal
y copiar/pegar comandos. Explica cómo poner a funcionar el sistema en un
servidor propio (un VPS — "Servidor Privado Virtual"), con su propia base
de datos PostgreSQL, su propio dominio y HTTPS gratis — sin depender de
Neon (base de datos) ni de Render (servidor), los proveedores que el
proyecto usa por defecto.

> Los comandos de esta guía usan los archivos reales de la carpeta `infra/`
> de este mismo proyecto (`Dockerfile`, `docker-compose.yml`, `nginx.conf`).
> Nada de lo que se pide aquí es inventado — puede abrir esos archivos y
> comparar.

Si en cambio prefiere seguir usando Neon (la base de datos que el proyecto
trae configurada por defecto) y solo quiere cambiar dónde corre el
**servidor**, puede saltarse la sección 2.4 (el Postgres del propio
`docker-compose.yml`) y usar directamente su cadena de conexión de Neon —
todo lo demás de esta guía aplica igual.

---

## 1. Requisitos previos

1. **Un VPS con Linux Ubuntu 22.04 o 24.04** (Debian también funciona,
   los comandos son los mismos). Cualquier proveedor sirve (DigitalOcean,
   Hetzner, Vultr, AWS Lightsail, etc.) — con 2 GB de RAM y 1 núcleo de CPU
   alcanza para una institución pequeña/mediana; para varias instituciones
   grandes, considere 4 GB o más.
2. **Un nombre de dominio propio** (ej. `micolegio.com`), apuntando a la
   dirección IP de su VPS. Esto se hace en el panel de su proveedor de
   dominio (GoDaddy, Namecheap, etc.): cree un registro **A** con el nombre
   `@` (o `www`) apuntando a la IP pública de su VPS. Este cambio puede
   tardar hasta un par de horas en propagarse.
3. **Acceso por SSH a su VPS** (usuario y contraseña, o llave SSH — lo que
   le haya dado su proveedor de VPS al crearlo).

No necesita saber programar. Todos los comandos de esta guía se ejecutan
tal cual, copiando y pegando en la terminal conectada a su VPS.

---

## 2. Despliegue en el VPS con Docker

### 2.1 Conectarse al VPS

Desde su computador, abra una terminal y conéctese (cambie
`SU_IP_DEL_VPS` por la IP real que le dio su proveedor):

```bash
ssh root@SU_IP_DEL_VPS
```

Todo lo que sigue se ejecuta **dentro** de esa conexión SSH, ya en el VPS.

### 2.2 Instalar Docker y Docker Compose

Docker es el programa que empaqueta y corre la aplicación de forma
aislada, sin que usted tenga que instalar Node.js, PostgreSQL ni nada más
a mano. Ejecute, uno por uno:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

Esto instala Docker y **Docker Compose** juntos (la versión moderna de
Docker ya incluye `docker compose` como parte del mismo programa, sin
necesidad de instalar nada aparte). Verifique que quedó instalado:

```bash
docker --version
docker compose version
```

Ambos comandos deben imprimir un número de versión, no un error.

### 2.3 Subir el proyecto al VPS

Si tiene el proyecto en un repositorio Git (GitHub, GitLab, etc.):

```bash
git clone SU_URL_DEL_REPOSITORIO.git gestor-academico
cd gestor-academico
```

Si en cambio tiene el proyecto como un archivo `.zip` en su computador
(como el que descargó de esta conversación), súbalo con `scp` desde su
**propio computador** (no desde el VPS):

```bash
scp GESTOR_ACADEMICO_YC_INTEGRADO.zip root@SU_IP_DEL_VPS:~/
```

Y luego, ya conectado por SSH al VPS, descomprímalo:

```bash
sudo apt-get update && sudo apt-get install -y unzip
unzip GESTOR_ACADEMICO_YC_INTEGRADO.zip -d gestor-academico-yc
cd gestor-academico-yc
```

A partir de aquí, todos los comandos de esta guía asumen que usted está
**dentro de la carpeta raíz del proyecto** (la que contiene, entre otras,
las carpetas `src/` e `infra/`).

### 2.4 Configurar el archivo `.env` de producción

El proyecto trae un archivo de ejemplo, `.env.example`, con TODAS las
variables que existen y una explicación de cada una. Cópielo a `.env` (el
archivo real que sí se usa) y edítelo:

```bash
cp .env.example .env
nano .env
```

(`nano` es un editor de texto simple dentro de la terminal — para guardar
y salir: `Ctrl+O`, `Enter`, luego `Ctrl+X`.)

Como mínimo, complete estas variables (todas están explicadas con más
detalle dentro del propio `.env.example`):

- **`DATABASE_URL`** — la cadena de conexión a su base de datos.
  - **Si va a usar el Postgres que trae el propio `docker-compose.yml`**
    de este proyecto (la opción más sencilla, todo en el mismo VPS, sin
    contratar nada aparte): dentro de `docker-compose.yml`, el servicio
    `backend` YA tiene un valor por defecto para esto
    (`postgres://gestor:gestor@postgres:5432/gestor_academico?sslmode=disable`)
    que apunta automáticamente al servicio `postgres` del mismo archivo —
    **puede dejar `DATABASE_URL` vacía en su `.env`** y funcionará sola.
    Si prefiere poner una contraseña propia en vez de `gestor`/`gestor`
    (recomendado), cambie `POSTGRES_USER`/`POSTGRES_PASSWORD` dentro de
    `infra/docker-compose.yml` (servicio `postgres`) Y el valor de
    `DATABASE_URL` para que coincidan.
    - **Sobre el `?sslmode=disable` al final:** esto es intencional y
      necesario. El Postgres del propio `docker-compose.yml` no trae
      cifrado (TLS/SSL) configurado — es una comunicación interna entre
      contenedores del mismo servidor, nunca sale a Internet, así que no
      hace falta cifrarla. Si quitara ese `?sslmode=disable`, el servidor
      fallaría al arrancar con el error *"The server does not support SSL
      connections"*, porque el código (`src/db/index.ts` /
      `src/lib/db-ssl.ts`) intentaría activar TLS contra un Postgres que
      no lo tiene. No necesita tocar código para esto — ya está resuelto
      en el valor por defecto de `docker-compose.yml`.
  - **Si prefiere un Postgres EXTERNO** (un proveedor administrado
    distinto de Neon, por ejemplo Supabase, Railway, o un Postgres que ya
    tenga en otro servidor): la ÚNICA diferencia es poner en `DATABASE_URL`
    la cadena de conexión que le dé ese proveedor (con su propio
    `sslmode`, normalmente `require`). El código no necesita ningún cambio
    — es exactamente el mismo mecanismo agnóstico de proveedor que ya usa
    el proyecto con Neon. En ese caso, el servicio `postgres` de
    `infra/docker-compose.yml` queda sin usarse — puede dejarlo encendido
    sin problema (no interfiere con nada) o, si prefiere no gastar RAM del
    VPS en un Postgres que no va a usar, comente por completo el bloque
    `postgres:` de ese archivo y quite también la sección
    `depends_on: postgres: condition: service_healthy` del servicio
    `backend` (el propio `docker-compose.yml` ya trae esta indicación en
    un comentario junto al servicio `postgres`).
- **`GEMINI_API_KEY`** — su clave de Google AI Studio, si quiere que
  funcione el Asistente Adán (IA). Puede dejarla vacía si no la necesita
  todavía; el resto del sistema funciona igual.
- **`JWT_SECRET`** y **`JWT_RESET_SECRET`** — genere un valor propio y
  aleatorio para cada una (el propio `.env.example` trae el comando exacto
  para generarlos con `node`).
- **`RESCATE_SUPER_ADMIN_HASH`** — opcional pero recomendado; ver la
  explicación dentro de `.env.example`.

Guarde el archivo cuando termine.

### 2.5 Encender la aplicación

Desde la carpeta raíz del proyecto (donde está la carpeta `infra/`),
ejecute:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Este es el comando exacto que enciende los 4 servicios definidos en
`infra/docker-compose.yml`: `backend` (la aplicación), `postgres` (la base
de datos, si la está usando), `nginx` (la puerta de entrada pública) y
`certbot` (que se queda en espera, solo para cuando lo necesite en la
sección 3). El `-d` significa que quedan corriendo en segundo plano — puede
cerrar la terminal y seguirán funcionando.

La primera vez tardará unos minutos (Docker construye la imagen de la
aplicación siguiendo `infra/Dockerfile`, descarga Postgres y Nginx). Al
terminar, verifique que los 3 primeros servicios están "Up":

```bash
docker compose -f infra/docker-compose.yml ps
```

Ya puede abrir `http://SU_IP_DEL_VPS` (o `http://SU_DOMINIO`, si el DNS ya
propagó) en un navegador y debería ver la pantalla de acceso del sistema.
Es HTTP normal (sin candado) todavía — HTTPS se activa en la sección 3.

---

## 3. Dominio y SSL gratuito (HTTPS)

Esta sección usa **Certbot** (la herramienta oficial de Let's Encrypt para
emitir certificados SSL gratuitos) junto con el servicio `certbot` que ya
viene definido en `infra/docker-compose.yml` — no se instala nada nuevo a
mano.

**Antes de empezar:** confirme que su dominio YA apunta a la IP del VPS
(sección 1, punto 2) — Let's Encrypt necesita poder alcanzar su servidor
por ese dominio para verificar que es suyo. Puede comprobarlo así:

```bash
ping -c 2 SU_DOMINIO_AQUI
```

Debe responder con la misma IP de su VPS.

### 3.1 Obtener el primer certificado

Con el sistema ya encendido (sección 2.5), pida el certificado (cambie
`SU_DOMINIO_AQUI` por su dominio real y `su-correo@ejemplo.com` por un
correo suyo — Let's Encrypt lo usa solo para avisarle si un certificado
está por vencer):

```bash
docker compose -f infra/docker-compose.yml run --rm certbot certonly \
  --webroot --webroot-path /var/www/certbot \
  -d SU_DOMINIO_AQUI \
  --email su-correo@ejemplo.com --agree-tos --no-eff-email
```

Si todo sale bien, verá un mensaje de éxito indicando dónde quedó guardado
el certificado (dentro del volumen `certbot-etc`, que Nginx ya tiene
montado).

### 3.2 Activar HTTPS en Nginx

El proyecto trae una plantilla lista, `infra/nginx-ssl.conf.example`, con
el bloque HTTPS ya armado. Ábrala y reemplace **todas** las apariciones de
`SU_DOMINIO_AQUI` por su dominio real:

```bash
nano infra/nginx-ssl.conf.example
```

Guarde, y luego reemplace el `nginx.conf` que está en uso por esta
versión:

```bash
cp infra/nginx.conf infra/nginx.conf.backup-sin-ssl
cp infra/nginx-ssl.conf.example infra/nginx.conf
docker compose -f infra/docker-compose.yml restart nginx
```

(El primer comando guarda una copia del `nginx.conf` original sin SSL, por
si necesita volver atrás.)

Abra ahora `https://SU_DOMINIO_AQUI` — debería ver el candado de conexión
segura en el navegador. Cualquier visita a la versión `http://` (sin la
"s") se redirige automáticamente a `https://`.

### 3.3 Renovación del certificado

Los certificados de Let's Encrypt duran 90 días. Renovarlo es un solo
comando:

```bash
docker compose -f infra/docker-compose.yml run --rm certbot renew
docker compose -f infra/docker-compose.yml restart nginx
```

Para no tener que acordarse de hacerlo a mano, puede programarlo para que
se ejecute solo una vez al mes con `cron` (el programador de tareas de
Linux). Ejecute:

```bash
crontab -e
```

Y agregue esta línea al final del archivo que se abre (ajuste la ruta
`/root/gestor-academico-yc` a la carpeta real de su proyecto):

```
0 3 1 * * cd /root/gestor-academico-yc && docker compose -f infra/docker-compose.yml run --rm certbot renew && docker compose -f infra/docker-compose.yml restart nginx
```

Esto intenta renovar el primer día de cada mes a las 3:00 a.m. — Certbot
internamente ya sabe que solo debe renovar de verdad cuando falten menos
de 30 días para el vencimiento, así que no hay riesgo de que falle por
"renovar antes de tiempo".

### 3.4 Alternativa: Traefik

Si prefiere no usar Nginx+Certbot manual y ya conoce **Traefik** (otro
proxy reverso, más automático con Docker), es una alternativa válida —
pero fuera del alcance de los archivos que trae este proyecto por defecto
(`infra/nginx.conf` seguiría sirviendo si no lo usa). No se incluye una
configuración de Traefik lista porque agregaría una herramienta nueva no
usada en el resto del proyecto; si la necesita, el patrón estándar es
reemplazar el servicio `nginx` de `infra/docker-compose.yml` por un
servicio `traefik` con sus propias etiquetas de Docker para el
descubrimiento automático de certificados.

---

## 4. Mantenimiento y respaldos

### 4.1 Respaldo manual de la base de datos (`pg_dump`)

Si está usando el Postgres del propio `docker-compose.yml` (servicio
`postgres`), puede sacar una copia completa de la base de datos así (crea
un archivo `respaldo.sql` en la carpeta actual):

```bash
docker compose -f infra/docker-compose.yml exec postgres pg_dump -U gestor gestor_academico > respaldo-$(date +%Y%m%d).sql
```

Esto genera un archivo con fecha (ej. `respaldo-20260315.sql`) que puede
descargar a su computador con `scp` (ejecute esto desde su computador, no
desde el VPS):

```bash
scp root@SU_IP_DEL_VPS:~/gestor-academico-yc/respaldo-20260315.sql .
```

Para restaurar un respaldo (en caso de necesitarlo), el comando inverso
es:

```bash
cat respaldo-20260315.sql | docker compose -f infra/docker-compose.yml exec -T postgres psql -U gestor -d gestor_academico
```

> Si en cambio está usando Neon o cualquier otro Postgres externo, use la
> herramienta de respaldos de ese proveedor (Neon, por ejemplo, tiene
> respaldos automáticos y "branching" incluidos en su panel) — `pg_dump`
> también funciona igual contra un Postgres externo, cambiando el comando
> por uno que apunte a esa cadena de conexión en vez de al contenedor
> local.

### 4.2 Ver los logs del servidor

Para ver qué está haciendo la aplicación en tiempo real (útil para
diagnosticar un problema):

```bash
docker compose -f infra/docker-compose.yml logs -f
```

(`Ctrl+C` para salir de la vista en tiempo real — esto no detiene la
aplicación, solo dejar de ver los logs.)

Para ver los logs de un solo servicio (ej. solo el backend, sin el ruido
de Nginx/Postgres):

```bash
docker compose -f infra/docker-compose.yml logs -f backend
```

### 4.3 Reiniciar o actualizar la aplicación

Reiniciar (por ejemplo, si la aplicación empezó a responder lento):

```bash
docker compose -f infra/docker-compose.yml restart backend
```

Actualizar a una versión nueva del código (después de reemplazar los
archivos del proyecto con una versión más reciente):

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

El `--build` le dice a Docker que vuelva a construir la imagen con el
código nuevo, en vez de reusar la anterior.

### 4.4 Monitoreo de infraestructura desde el propio panel

Desde la Ronda 49, el sistema incluye un panel de monitoreo en vivo —
**"🖥️ Estado del Servidor & Infraestructura"**, dentro del Panel de Súper
Admin — que muestra el uso de RAM, CPU, disco y conexiones a la base de
datos, y avisa automáticamente (dentro del panel, y por correo si
configuró `SUPERADMIN_ALERT_EMAIL` en su `.env`) si alguno se acerca a su
límite. Revíselo periódicamente en vez de tener que conectarse por SSH
solo para ver si el servidor está saludable.

---

## Resumen de comandos más usados

| Qué quiero hacer | Comando |
|---|---|
| Encender todo | `docker compose -f infra/docker-compose.yml up -d` |
| Apagar todo | `docker compose -f infra/docker-compose.yml down` |
| Ver logs en vivo | `docker compose -f infra/docker-compose.yml logs -f` |
| Reiniciar solo el backend | `docker compose -f infra/docker-compose.yml restart backend` |
| Actualizar tras subir código nuevo | `docker compose -f infra/docker-compose.yml up -d --build` |
| Respaldo de la base de datos | `docker compose -f infra/docker-compose.yml exec postgres pg_dump -U gestor gestor_academico > respaldo.sql` |
| Renovar el certificado SSL | `docker compose -f infra/docker-compose.yml run --rm certbot renew` |

---

**Nota de transparencia:** estos archivos (`Dockerfile`, `docker-compose.yml`,
`nginx.conf`) se entregaron en la Ronda 44 y se ajustaron en la Ronda 49
como entregables de infraestructura, validados por estructura/sintaxis
(YAML bien formado, instrucciones válidas) — el entorno de trabajo donde
se escribió este proyecto no tiene Docker Engine real para probar un
`docker compose up` de principio a fin. Se recomienda seguir esta guía en
un VPS de prueba antes de un despliegue con usuarios reales, y avisar si
algún paso no coincide exactamente con lo que ve en pantalla.
