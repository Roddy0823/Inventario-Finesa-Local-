# Instalación y operación local

[Índice de documentación](README.md) · Revisión: 24 de noviembre de 2026.

## 1. Requisitos y distribución

La configuración del proyecto utiliza **Node 24**, **Bun 1.4.4**, Git y Docker con contenedores Linux y Compose **2.24.4 o superior**. Estas son las versiones de referencia del proyecto, no una recomendación de versiones más recientes. Los comandos de esta guía se ejecutan desde `Finesa-Project`, salvo el bloque inicial de descarga.

Se necesita conexión a Internet para descargar repositorios, dependencias e imágenes. El funcionamiento local de inventario y firmas no requiere consultas externas de IP con la configuración `LOCAL_ONLY`. Docker y la aplicación deben seguir funcionando para utilizar el sistema.

| Ubicación                          | Contenido                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `Finesa-Project`                   | Código, migraciones, pruebas, scripts y documentación                       |
| Carpeta hermana `supabase-runtime` | Fuente oficial de la distribución Docker de Supabase fijada por el proyecto |
| `%LOCALAPPDATA%\FinesaInventario`  | Configuración de instalación y credenciales, fuera del repositorio          |
| Volúmenes de Docker                | PostgreSQL, archivos de Storage y configuración persistente                 |
| `.output`                          | Aplicación compilada para la instalación                                    |

En Linux la ubicación predeterminada es `~/.local/share/FinesaInventario`. En Windows el resolvedor también reconoce instalaciones bajo `%LOCALAPPDATA%\Packages\OpenAI.Codex_*\LocalCache\Local\FinesaInventario` y resuelve su ruta física para Docker.

`FINESA_LOCAL_DIR` permite elegir una instalación existente. No crea una segunda instalación independiente: se usan nombres fijos de contenedores y volúmenes y se verifica su correspondencia con las claves locales. No ubicar la configuración ni los respaldos en OneDrive.

## 2. Instalación desde cero

Ejecutar desde una carpeta que contendrá ambos repositorios. Si ya existe una instalación con datos, utilizar el procedimiento de actualización, no repetir la preparación.

```powershell
git clone https://github.com/Roddy0823/Inventario-Finesa-Local-.git Finesa-Project
git clone --filter=blob:none --no-checkout https://github.com/supabase/supabase.git supabase-runtime
git -C supabase-runtime sparse-checkout init --cone
git -C supabase-runtime sparse-checkout set docker
git -C supabase-runtime checkout bc27d2661edd09a5d0b8d76ce33da6d4071a756e
Set-Location Finesa-Project
bun install --frozen-lockfile
node scripts/local.mjs prepare
node scripts/local.mjs up
node scripts/local.mjs migrate
node scripts/local.mjs admin
node scripts/local.mjs build
node scripts/local.mjs serve
```

Supabase debe estar en `self-hosted/v0.8.3`, revisión `bc27d2661edd09a5d0b8d76ce33da6d4071a756e`. `prepare` comprueba esa revisión, genera claves y copia la configuración. Rechaza sobrescribir una instalación preparada o crear claves incompatibles con volúmenes existentes.

`admin` crea la cuenta inicial mediante Auth Admin y asigna el rol mediante SQL. Guarda sus credenciales en `administrador-local.json` dentro de la carpeta de instalación. Si ya hay usuarios y no están las credenciales esperadas, no crea un administrador nuevo automáticamente. No publicar el contenido de ese archivo.

`serve` permanece en primer plano. Abrir una segunda terminal para verificar:

```powershell
node scripts/local.mjs verify
```

Esta comprobación inicia sesión, lee tablas con RLS, comprueba buckets privados, sube/descarga/elimina un archivo temporal en `facturas` y verifica la respuesta HTTP de la aplicación. No es una prueba completa de todos los flujos de negocio. Si la contraseña inicial fue cambiada, las credenciales guardadas pueden dejar de servir para esta comprobación.

## 3. Inicio y apagado diario

1. Abrir Docker Desktop y esperar a que el motor esté listo.
2. Ejecutar `Iniciar-Finesa.cmd` o `node scripts/start-local.mjs`.
3. Mantener abierta la ventana del servidor y entrar en `http://localhost:8080`.

El iniciador comprueba servicios, APIs y Realtime; puede reutilizar una instancia saludable. Para diagnóstico previo sin iniciar servicios:

```powershell
node scripts/start-local.mjs --check
node scripts/local.mjs status
```

Para apagar, terminar primero el servidor de la aplicación con Ctrl+C en su ventana y luego ejecutar:

```powershell
node scripts/local.mjs stop
```

Los volúmenes se conservan. **No ejecutar `docker compose down -v`** para detener la instalación: elimina los volúmenes y puede destruir los datos.

| Dirección local          | Servicio                  | Acceso                                                                             |
| ------------------------ | ------------------------- | ---------------------------------------------------------------------------------- |
| `http://localhost:8080`  | Aplicación                | Cuenta del personal o portal habilitado                                            |
| `http://localhost:8000/` | Supabase Studio y gateway | Studio utiliza `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` de la configuración local |
| `http://localhost:8025`  | Mailpit                   | Buzón de pruebas local                                                             |

Las credenciales de Studio no son las de la aplicación. Mailpit captura correos de recuperación; no realiza entrega de correo real.

## 4. Variables de configuración

La modalidad local inyecta las variables al compilar e iniciar; no requiere crear `.env` en el repositorio. Para desarrollo con una configuración distinta, la plantilla es [`.env.example`](../.env.example).

| Variable                                   | Consumidor                   | Función                                                                            |
| ------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`                        | Cliente, durante compilación | Dirección de Supabase visible para el navegador                                    |
| `VITE_SUPABASE_PUBLISHABLE_KEY`            | Cliente, durante compilación | Clave pública de acceso sujeta a RLS                                               |
| `SUPABASE_URL`                             | Servidor                     | Dirección de Supabase                                                              |
| `SUPABASE_PUBLISHABLE_KEY`                 | Servidor                     | Cliente de acceso autenticado                                                      |
| `SUPABASE_SERVICE_ROLE_KEY`                | Solo servidor                | Operaciones administrativas y secreto para derivación del PIN                      |
| `LOCAL_ONLY`, `VITE_LOCAL_ONLY`            | Servidor/cliente             | Evitan consultas externas de IP en la modalidad local                              |
| `PUBLIC_SIGNATURE_ORIGIN`                  | Servidor                     | Origen usado al generar enlaces de firma; lo obtiene de `lan.json`                 |
| `INTERNAL_NETWORK_CIDRS`                   | Servidor                     | Redes autorizadas separadas por coma; vacío permite solo loopback                  |
| `FINESA_LOCAL_DIR`                         | Scripts                      | Ruta explícita de la instalación                                                   |
| `HOST`, `NITRO_HOST`, `PORT`, `NITRO_PORT` | Servidor local               | Escucha en loopback o todas las interfaces según la configuración LAN; puerto 8080 |

Cambiar variables del cliente requiere **recompilar**. Agregarlas solo al arrancar no corrige una compilación ya generada. Usar `node scripts/local.mjs build` para la instalación; `bun run build:check` produce una compilación de validación separada que no está preparada para iniciar sesión.

## 5. Actualización

Conservar una copia identificable del código anterior y obtener los cambios por el procedimiento de control de versiones del equipo. No sobrescribir modificaciones locales sin revisarlas.

1. Cerrar la aplicación, detener el stack y respaldar antes de aplicar la actualización.
2. Instalar las dependencias del lockfile y comprobar el código.
3. Iniciar servicios, aplicar migraciones pendientes, compilar y arrancar.

```powershell
node scripts/local.mjs stop
node scripts/backup-local.mjs
bun install --frozen-lockfile
bun run check
node scripts/local.mjs up
node scripts/local.mjs migrate
node scripts/local.mjs build
node scripts/start-local.mjs
```

`migrate` aplica los archivos en orden con control de checksum y registra cada migración en `finesa_local.migrations`. No editar una migración ya aplicada: agregar una nueva. Un conflicto de checksum o una validación de datos que falla debe investigarse; no borrar el historial ni datos para forzar el avance.

## 6. Respaldo y recuperación

El script de respaldo exige que los contenedores estén detenidos y PostgreSQL haya finalizado correctamente. Docker Desktop debe permanecer disponible para ejecutar los contenedores temporales de lectura.

```powershell
node scripts/local.mjs stop
node scripts/backup-local.mjs
```

El destino predeterminado es `backups/<marca-de-tiempo>` bajo la instalación. Se puede proporcionar una carpeta nueva explícita como argumento. El respaldo incluye configuración y claves, los volúmenes encontrados del proyecto y un `manifest.json` con los nombres, hashes SHA-256 e imagen de PostgreSQL. Comprueba la lectura completa de cada tar/gzip.

Conservar juntos `config`, los archivos `.tar.gz` y `manifest.json`. Mantener una copia protegida en otro medio conforme a la política de TI. Copiar el repositorio o la carpeta `.output` no respalda los equipos, empleados, documentos ni cuentas.

**No existe un comando de restauración automatizado en los scripts revisados.** La comprobación de archivos no demuestra que la base restaurada arranque. El responsable de infraestructura debe ensayar una recuperación en un entorno aislado antes de considerar el respaldo apto para continuidad:

1. Verificar hashes contra el manifiesto y disponer de la imagen/versiones originales.
2. Preparar un destino aislado, sin sobrescribir la instalación operativa. Los scripts locales no crean dos instalaciones independientes mediante un simple cambio de carpeta.
3. Recuperar la configuración original y los volúmenes con servicios detenidos, mediante un procedimiento de infraestructura revisado para ese destino.
4. Conservar propietarios, permisos, correspondencia de volúmenes y claves. No generar nuevas claves sobre los datos recuperados.
5. Iniciar y comprobar Auth, RLS, lectura de inventario, firmas/PDF, Storage, portal y recepción de prueba.
6. Registrar fecha, responsable, resultado y tiempo real de recuperación antes de autorizar un cambio de servicio.

Estos pasos definen la validación necesaria; no son instrucciones ejecutables de extracción de volúmenes. No se ha verificado un ensayo de restauración como parte de esta documentación. Volver al código anterior tampoco revierte automáticamente migraciones o datos.

## 7. Firma en red interna

La configuración opcional `lan.json` vive dentro de la carpeta de instalación. Su estructura es:

```json
{
  "signatureOrigin": "http://IP-ACTUAL-DEL-EQUIPO:8080",
  "allowedNetworks": ["172.18.150.0/23"]
}
```

El valor `IP-ACTUAL-DEL-EQUIPO` es un marcador que debe reemplazarse por la IPv4 del adaptador corporativo. La subred indicada corresponde a la prueba documentada del proyecto; TI debe validar su pertinencia en otro entorno. El rango VPN está pendiente de confirmación y no debe inventarse.

Con esa configuración el servidor escucha en todas las interfaces, pero acepta únicamente loopback y redes autorizadas. El origen de firma se verifica contra las direcciones locales antes de emitir el enlace. Supabase y Studio continúan vinculados a `127.0.0.1`; por eso esta modalidad no habilita el uso remoto completo de la administración o del portal.

La regla de Windows `Finesa-Firmas-LAN` restringe 8080 al perfil Dominio, dirección local y subred autorizada. Para actualizar únicamente la IP de una regla **ya existente**, ejecutar PowerShell como administrador:

```powershell
.\scripts\repair-signature-firewall.ps1 -LocalAddress "IP-ACTUAL-DEL-EQUIPO"
```

Actualizar también `lan.json`, reiniciar la aplicación y generar enlaces nuevos. La reparación no es un instalador general de firewall. Confirmar la política efectiva sin desactivar políticas corporativas. Para volver a operación exclusivamente local, retirar la configuración LAN, deshabilitar la regla y reiniciar.

Probar desde otro equipo autorizado que el enlace permite revisar y firmar, y desde una red no autorizada que el acceso se rechaza. HTTP corresponde solo a esta prueba interna. Un despliegue definitivo necesita HTTPS, dirección estable, URLs coherentes y revisión del control por IP si se agrega un proxy.

## 8. Diagnóstico

| Síntoma                                         | Comprobación y acción                                                                                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker devuelve `500` en `_ping`                | Reiniciar Docker Desktop, esperar disponibilidad y repetir `--check`                                                                                                                    |
| No abre el puerto 8080                          | Revisar la ventana del servidor y que no haya otra aplicación ocupando el puerto                                                                                                        |
| No encuentra la instalación                     | Usar el resolvedor del iniciador; verificar `FINESA_LOCAL_DIR` sin regenerar claves                                                                                                     |
| Credenciales/volúmenes no corresponden          | Detener el intento y localizar la configuración original; no preparar claves nuevas                                                                                                     |
| Studio queda cargando                           | Revisar Basic Auth; para instalaciones anteriores ejecutar `node scripts/fix-studio-auth.mjs` y reiniciar el contenedor `supabase-envoy`, después abrir una ventana nueva desde la raíz |
| No llega el correo de recuperación              | Consultar Mailpit local; la instalación no entrega correo corporativo                                                                                                                   |
| HTTP 403 desde otro equipo                      | Revisar IP TCP, CIDR, perfil de red y firewall; las cabeceras de proxy no autorizan acceso                                                                                              |
| Enlace remoto vencido o con IP anterior         | Revisar `lan.json` y dirección del adaptador; reiniciar y generar enlace nuevo                                                                                                          |
| Compilación rechaza variables públicas ausentes | Compilar con `node scripts/local.mjs build`                                                                                                                                             |
| Lista conserva información tras error           | Reintentar y revisar servicios; los datos mostrados pueden ser la última lectura exitosa                                                                                                |
| Migración rechazada                             | Leer el error, revisar checksum o datos incompatibles y corregir con un procedimiento trazable                                                                                          |

Para soporte, registrar fecha/hora, módulo, acción, mensaje exacto y resultado de `--check`/`status`. No adjuntar tokens de firma, PIN, claves ni archivos personales completos.

**Fuentes:** [scripts locales](../scripts/local.mjs), [iniciador](../scripts/start-local.mjs), [respaldo](../scripts/backup-local.mjs), [resolvedor](../scripts/local-runtime.mjs), [despliegue](../deploy/local.override.yml) y [control de red](../src/lib/network-access.server.ts).
