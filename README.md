# Finesa — Inventario TI y Actas Digitales

Plataforma corporativa integral para la gestión del ciclo de vida de activos tecnológicos, control de inventario de equipos de cómputo, generación y firma electrónica de actas digitales, administración de proveedores y portal de autoservicio para **Finesa S.A.**

## Documentación de la aplicación

Consulte el [índice de documentación](docs/README.md), revisado contra el código local el 24 de noviembre de 2026:

- [Manual de usuario](docs/manual-usuario.md).
- [Roles y seguridad](docs/roles-y-seguridad.md).
- [Instalación y operación](docs/instalacion-y-operacion.md).
- [Arquitectura](docs/arquitectura.md).
- [Modelo de datos](docs/modelo-de-datos.md).
- [Mantenimiento y validación](docs/mantenimiento-y-validacion.md).

---

## Características Principales

### 1. Gestión de Activos y Equipos de Cómputo

- **Ciclo de vida completo**: Estados disponible, asignado, en alistamiento, en reparación y de baja. Los préstamos se representan como entregas temporales con fecha límite, no como un estado adicional.
- **Flujo de baja con soporte adjunto**: Proceso formal de desincorporación de activos fijos con soporte técnico o acta pericial adjunta (`baja_documento_path`), trazabilidad contable y enlaces firmados de consulta.
- **Trazabilidad total**: Historial inmutable de movimientos auditado automáticamente mediante triggers en base de datos.
- **Series y activos**: Verificación única de número de serie y placa de inventario corporativa con corrección auditada exclusiva para el Administrador (`corregir_serie`).
- **Gestión de garantías y proveedores**: Vinculación de equipos con órdenes de compra, contratos y fechas de cobertura.
- **Paginación en servidor**: Consultas paginadas por rango (`.range()`) con conteos exactos y sincronización reactiva en la URL (búsqueda, estado, sede, marca, tipo y página).

### 2. Actas Digitales con Firma Electrónica y Blindaje Criptográfico

- **Tipos de acta soportados**:
  - **Entrega**: Asignación formal de equipos a empleados.
  - **Devolución**: Reintegro de equipos con liberación automática de responsabilidades.
  - **Cambio**: Movimiento bidireccional atómico (entrega de equipo nuevo y devolución del reemplazado bajo una misma firma).
  - **Préstamo / Contingencia**: Asignación temporal con fecha de vencimiento y alertas de mora.
- **Firma electrónica y sellado criptográfico**:
  - Captura táctil / canvas para firma presencial de técnico y empleado con validación estricta de Magic Bytes PNG en servidor.
  - Enlaces de firma remota con token criptográfico protegido en servidor.
  - Generación de PDF oficial 100% en servidor mediante `pdf-lib` con marcas de tiempo, datos de auditoría e imagen de firmas incrustadas.
  - **Hash SHA-256 de integridad documental**: Sellado criptográfico del PDF firmado (`pdf_hash`), persistido en base de datos y registrado en auditoría.
  - **Políticas WORM en Storage**: Reglas de inmutabilidad estricta (Write Once, Read Many) que impiden modificaciones (`UPDATE`) o eliminaciones (`DELETE`) de actas en storage.

### 3. Portal de Autoservicio del Empleado

- **Autenticación sin fricción**: Ingreso seguro mediante número de cédula y PIN personal de 4 dígitos (protegido con HMAC y bloqueo tras 5 intentos fallidos).
- **Consulta de activos**: Visualización de equipos actualmente a cargo y especificaciones técnicas.
- **Repositorio personal de actas**: Descarga de actas firmadas en formato PDF.
- **Paz y salvo digital**: Consulta del estado de paz y salvo en tiempo real para procesos de desvinculación o traslado.
- **Reporte de incidencias**: Registro de fallas técnicas directamente a la mesa de soporte.

### 4. Reabastecimiento y Proveedores

- **Gestión de proveedores**: Directorio de aliados estratégicos y catálogo de artículos suministrados.
- **Pedidos de compra**: Registro en borrador o como pedido realizado, recepción parcial/completa y cancelación con motivo.
- **Recepción de stock**: Procesamiento atómico vía RPC en base de datos que ingresa los equipos y actualiza el pedido en una sola transacción segura.

### 5. Carga Masiva Inteligente

- Importación de empleados, equipos y asignaciones iniciales mediante plantillas Excel (`.xlsx`), con creación autorizada de catálogos faltantes.
- Validación previa de seriales, activos fijos y cédulas contra la base de datos y dentro del archivo. Los registros detectados como existentes se omiten.
- Vista previa de filas válidas, existentes y con error; inserción en lotes de 200. La importación puede dejar resultados parciales y no constituye una transacción única para todo el archivo.

### 6. Catálogos Maestros y Auditoría Ligera

- **Catálogos cerrados**: Estandarización de marcas, tipos de equipo, sedes, áreas y empresas. El modelo se registra en la ficha del equipo.
- **Bitácora de auditoría inmutable**: Registro de eventos críticos (inicios de sesión, cambios de estado, firmas, anulaciones) bloqueados contra eliminación o modificación.
- **Carga optimizada de auditoría**: Proyección en servidor de columnas ligeras con carga bajo demanda de diferencias `JSONB` (`antes` y `despues`) al expandir filas, eliminando transferencia masiva de datos en listas y exportación.

---

## Arquitectura y Seguridad

- **Multi-ecosistema (Aislamiento de datos)**: Filtrado estricto por `owner_id` en PostgreSQL mediante políticas RLS (Row Level Security).
- **Lógica de negocio en base de datos**: Reglas críticas (paz y salvo, transiciones de estado, inmutabilidad de series) residen en triggers y RPCs de Postgres para máxima seguridad.
- **Roles y permisos granulares**: Control de acceso basado en roles (`admin`, `auxiliar`, `empleado`) y permisos por acción en `user_permisos`.
- **Identidad de marca y modo oscuro/claro**:
  - Detección automática del tema del sistema con selector manual.
  - Logotipos vectoriales y rasterizados oficiales de Finesa que se alternan dinámicamente según el tema seleccionado.

---

## Tecnologías

- **Runtime:** [Bun](https://bun.sh/)
- **Frontend / SSR:** [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) + [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Estilos y UI:** [Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) + [Lucide Icons](https://lucide.dev/) + [Sonner](https://sonner.emilkowal.ski/)
- **Estado del servidor:** [TanStack Query](https://tanstack.com/query)
- **Base de datos y Storage:** [Supabase](https://supabase.com/) (PostgreSQL 15+, Auth, RLS, Storage)
- **Generación de documentos:** `pdf-lib`, `jspdf`, `xlsx`

---

## Puesta en Marcha Local

### Prueba autocontenida en Windows (sin Supabase Cloud)

La preparación de esta prueba está en `scripts/local.mjs` y `deploy/local.override.yml`.
Requiere Docker con contenedores Linux y Compose 2.24.4 o superior, Node 24 y Bun 1.4.4.
La configuración oficial de Supabase utilizada es `self-hosted/v0.8.3`, commit
`bc27d2661edd09a5d0b8d76ce33da6d4071a756e`. Descargarla en la carpeta hermana
`supabase-runtime` y obtener su subdirectorio `docker` antes de preparar el entorno.
Desde una carpeta nueva, estos comandos descargan el proyecto y esa dependencia
en la versión exacta utilizada por los scripts:

```sh
git clone https://github.com/Roddy0823/Inventario-Finesa-Local-.git Finesa-Project
git clone --filter=blob:none --no-checkout https://github.com/supabase/supabase.git supabase-runtime
git -C supabase-runtime sparse-checkout init --cone
git -C supabase-runtime sparse-checkout set docker
git -C supabase-runtime checkout bc27d2661edd09a5d0b8d76ce33da6d4071a756e
cd Finesa-Project
bun install --frozen-lockfile
node scripts/local.mjs prepare
node scripts/local.mjs up
node scripts/local.mjs migrate
node scripts/local.mjs admin
node scripts/local.mjs build
node scripts/local.mjs serve
```

El repositorio incluye el código, las migraciones, las pruebas, los scripts y la
configuración de despliegue. Cada instalación genera sus propias credenciales;
los datos de empleados, equipos, firmas, documentos y respaldos permanecen fuera
de Git. Supabase se descarga desde su repositorio oficial con la revisión fijada.

Los informes históricos de [análisis](docs/informes/analisis-proyecto-2026-11-11.html)
y [correcciones](docs/informes/correcciones-proyecto-2026-11-18.html), junto con sus
datos JSON, están en `docs/informes`. Reflejan las verificaciones realizadas en
las fechas indicadas; los ajustes posteriores de enlaces de firma se documentan
en la sección de acceso por red de este archivo.

`prepare` genera claves únicas una sola vez en `%LOCALAPPDATA%/FinesaInventario`
(Linux: `~/.local/share/FinesaInventario`). No sobrescribe claves existentes.
Se puede elegir la ubicación mediante `FINESA_LOCAL_DIR`. Esa variable selecciona
la instalación existente: no crea una segunda instalación independiente. Los scripts
rechazan generar claves nuevas si ya existen volúmenes o contenedores de Finesa,
y comprueban que los servicios pertenecen a la misma configuración. No guardar esa carpeta
en OneDrive: contiene credenciales del entorno. Las variables del servidor se
inyectan al compilar/ejecutar; no hace falta crear un `.env` en el repositorio.

La prueba escucha exclusivamente en este equipo: aplicación `http://localhost:8080`,
Supabase `http://localhost:8000` y buzón de pruebas `http://localhost:8025`.
Todavía no habilita acceso LAN. El buzón captura recuperaciones de contraseña;
no entrega correos reales. La acción `admin` crea el primer usuario mediante Auth
Admin y le asigna `admin` mediante SQL directo. La contraseña aleatoria queda en
`administrador-local.json` dentro de la carpeta local de configuración.
Con la aplicación encendida, `node scripts/local.mjs verify` comprueba ingreso,
lecturas con RLS y carga/descarga de un archivo temporal de Storage que elimina al terminar.

Después de completar la instalación, en Windows abrir Docker Desktop y esperar a
que esté listo. Luego hacer doble clic en `Iniciar-Finesa.cmd` para iniciar los
servicios y la aplicación. Mantener esa ventana abierta y entrar en
`http://localhost:8080`. Desde PowerShell también se puede ejecutar
`node scripts/start-local.mjs`; `--check` comprueba el entorno sin iniciar servicios.
El lanzador evita una segunda instancia y conserva los errores en pantalla.

Los scripts detectan tanto la configuración habitual como la guardada por Codex
en `%LOCALAPPDATA%\Packages\OpenAI.Codex_*\LocalCache\Local\FinesaInventario`.
Resuelven la ruta física antes de entregarla a Docker, por lo que no es necesario
escribir esa ruta manualmente. `FINESA_LOCAL_DIR` sigue disponible para elegir
una instalación explícita. No se regeneran claves durante el inicio.
Si Docker devuelve un error `500` en `_ping`, reiniciar Docker Desktop y volver
a ejecutar el lanzador; ese error corresponde al motor de Docker.

Studio se abre en `http://localhost:8000/` desde Edge o Chrome, con
`DASHBOARD_USERNAME` y `DASHBOARD_PASSWORD` de la configuración local.
La preparación aplica `scripts/fix-studio-auth.mjs`: conserva Basic Auth y fija
su realm a `Finesa Studio` para que Envoy 1.39 no desafíe cada ruta con un realm
distinto (puede bloquear `_buildManifest.js` y dejar Studio cargando).
Para instalaciones previas, ejecutar ese script y reiniciar `supabase-envoy`.
Después, cerrar las pestañas de Studio y entrar desde la raíz en una ventana nueva.

`LOCAL_ONLY=true` y `VITE_LOCAL_ONLY=true` evitan consultas externas de IP.
Se usan fuentes disponibles en el sistema. Se necesita Internet para la instalación
inicial de dependencias e imágenes, no para esas funciones durante la operación.

Los datos de PostgreSQL y Storage usan volúmenes persistentes de Docker, fuera
del código y de OneDrive. `node scripts/local.mjs stop` conserva esos volúmenes;
`status` muestra el estado. No ejecutar `docker compose down -v`.
Las migraciones se aplican en orden con control de checksum; reiniciar no borra datos.

Antes del traslado a Finesa, hacer y probar un respaldo consistente de PostgreSQL
(incluidos Auth y metadatos de Storage), los archivos de Storage y las claves locales.
La clave del servidor también deriva los PIN de empleados: conservarla durante la
migración. El destino requerirá HTTPS, IP/DNS estable, configuración de URLs y
una nueva compilación del cliente, restricciones de red y prueba desde otro equipo.
No copiar archivos físicos de PostgreSQL mientras esté en ejecución.

### Actualizar una instalación existente

Cierre la aplicación y detenga los servicios antes de respaldar. El respaldo incluye
PostgreSQL, Storage, configuración de PostgreSQL y las claves originales; cada archivo
de volumen se comprueba como tar/gzip y se registra con SHA-256 en `manifest.json`.

```sh
node scripts/local.mjs stop
node scripts/backup-local.mjs
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run test:runtime
node scripts/local.mjs up
node scripts/local.mjs migrate
node scripts/local.mjs build
node scripts/start-local.mjs
```

`backup-local.mjs` exige servicios apagados y guarda el respaldo en la subcarpeta
`backups` de la configuración local. No lo suba al repositorio ni a OneDrive: contiene
credenciales. La comprobación de archivos no sustituye un ensayo de restauración.

La migración `20261111174151_seguridad_integridad_transaccional.sql` añade protección
de identidad, aislamiento de usuarios inactivos, reservas y confirmación atómica de
firmas, validación de equipos, intentos de PIN serializados y creación transaccional
de actas/pedidos/préstamos. Las migraciones anteriores conservan sus checksums.
Si una comprobación previa encuentra datos ambiguos, la migración aborta; corrija
explícitamente esos registros antes de reintentar. Nunca elimine datos para forzarla.

Las firmas y los PDF se guardan en rutas únicas por intento. El enlace solo se consume
al confirmar la transacción; los reintentos reconocen una firma ya confirmada. Las
imágenes se validan también por dimensiones, estructura y tamaño descomprimido, y
los PDF distribuyen textos y equipos entre páginas sin recortar contenido.

`bun run check` agrupa tipos, lint, pruebas, scripts y una compilación de validación
(`bun run build:check`) en `.cache/check-build`. Esa salida no sustituye la aplicación
local de `.output` y no está preparada para iniciar sesión. El workflow de GitHub
ejecuta esas comprobaciones en Windows y Linux.

Para compilar la instalación local utilice `node scripts/local.mjs build`: incorpora
la URL y la clave pública de Supabase que necesita el navegador. `bun run build`
sin esas variables se rechaza antes de reemplazar `.output`. Inyectarlas únicamente
al iniciar el servidor no corrige una compilación del navegador ya generada.
El servidor de desarrollo
escucha en `127.0.0.1`; el acceso LAN corresponde al servidor de producción y sus
restricciones de red.

### Requisitos Previos

- Node 24 y [Bun](https://bun.sh/) 1.4.4, versiones de referencia usadas por la configuración de comprobaciones del proyecto.
- Instancia de [Supabase](https://supabase.com/) configurada con las migraciones y RPCs del proyecto

### Configuración del Entorno

1. Clona el repositorio:

   ```sh
   git clone https://github.com/Roddy0823/Inventario-Finesa-Local-.git
   cd Inventario-Finesa-Local-
   ```

2. Copia la plantilla de variables de entorno y ajusta las credenciales:

   ```sh
   cp .env.example .env
   ```

3. Edita `.env` con los valores de tu proyecto Supabase:
   ```env
   VITE_SUPABASE_URL="https://tu-proyecto.supabase.co"
   VITE_SUPABASE_PUBLISHABLE_KEY="tu_publishable_key"
   SUPABASE_URL="https://tu-proyecto.supabase.co"
   SUPABASE_PUBLISHABLE_KEY="tu_publishable_key"
   SUPABASE_SERVICE_ROLE_KEY="tu_service_role_key"
   ```

### Auth y rutas protegidas

El personal ingresa con correo y contraseña de Supabase Auth; los empleados usan `ingresoEmpleado` con cédula y PIN. No hay registro público de administradores: su asignación se realiza exclusivamente por SQL.

Las rutas bajo `_authenticated` validan la identidad con `getUser()` y consultan el perfil, roles y permisos. Esa verificación se reutiliza durante 30 segundos para evitar peticiones duplicadas al navegar; la sesión local solo se consulta para detectar cambios de cuenta. `src/lib/route-access.ts` define el acceso por URL: los empleados usan `/mi-portal` y `/ajustes`, y el personal accede a los módulos según sus permisos. Las cuentas inactivas o sin rol ven la pantalla de cuenta sin acceso. Al cerrar sesión o cambiar de usuario se limpia la caché de consultas. Las RLS y las funciones de servidor verifican cada operación, independientemente de esa caché.

La sesión del navegador se mantiene en localStorage, y este grupo de rutas tiene SSR deshabilitado. Las funciones protegidas de servidor reciben un Bearer token, validan sus claims y el estado activo mediante `requireSupabaseAuth`. Las políticas RLS y las RPC siguen siendo responsables de autorizar los datos y operaciones.

Configura las variables `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` también en el servidor. La clave `SUPABASE_SERVICE_ROLE_KEY` es exclusiva del servidor y nunca debe llevar el prefijo `VITE_`.

### Instalación y Ejecución

```sh
# Instalar dependencias
bun install

# Iniciar servidor de desarrollo
bun run dev
```

La aplicación estará disponible en `http://localhost:8080`.

### Rendimiento y sincronización local

`Iniciar-Finesa.cmd` espera a que los contenedores estén saludables y comprueba las APIs de autenticación, datos y archivos. Los controles de salud se ejecutan cada segundo durante el arranque, manteniendo los intervalos habituales después. Si Docker Desktop está apagado, debe abrirlo y esperar a que esté listo; ese tiempo depende del equipo.

Cuando la aplicación ya responde, el iniciador comprueba las APIs y una conexión temporal a Realtime para reutilizarla sin volver a ejecutar Docker Compose. Si falla alguna comprobación, vuelve al arranque normal con sus controles de identidad. `--check` conserva la comprobación completa de Docker.

La migración `20261123011416_optimizar_consultas_rls.sql` evalúa identidad y permisos una vez por consulta, conservando las políticas de aislamiento. En una instalación existente se aplica con `node scripts/local.mjs migrate`, después de respaldar la base. No modifica las migraciones anteriores.

La interfaz agrupa cambios de Realtime durante 300 ms y vuelve a consultar después de una reconexión. Renovar el token de sesión ya no recarga todo el inventario. Si una actualización falla por un problema temporal, los listados conservan la última lectura y muestran un aviso para reintentar; los errores de autorización siguen bloqueando el acceso.

### Scripts Disponibles

- `bun run dev`: Inicia el servidor de desarrollo en Vite.
- `bun run build`: Genera la compilación de producción optimizada.
- `bun run preview`: Previsualiza la versión construida.
- `bun run lint`: Ejecuta el análisis estático de código con ESLint.
- `bun run format`: Aplica el formateador Prettier a los archivos del proyecto.
- `bun run test`: Ejecuta la suite completa de pruebas unitarias y RLS.
- `bun run test:unit`: Ejecuta las pruebas unitarias de funciones críticas de servidor (`firmas.server`, `acceso-empleado.server`, `usuarios.functions`, `security.server`).
- `bun run test:rls`: Ejecuta las pruebas de integración para políticas RLS, triggers y RPCs sobre Postgres en memoria (PGlite).
- `bun run test:runtime`: Comprueba la detección de la instalación local, sus claves y los checksums de migraciones.
- `bun run typecheck`: Verifica los tipos de TypeScript sin generar archivos.
- `bun run check`: Ejecuta tipos, lint, pruebas, comprobaciones del entorno y compilación.

---

## Suite de Pruebas Automatizadas

El proyecto cuenta con una batería de pruebas automatizadas configurada con [Vitest](https://vitest.dev/) y PostgreSQL embebido ([PGlite](https://pglite.dev/)):

1. **Pruebas Unitarias de Servidor (`tests/unit/`)**:
   - `firmas.server.test.ts`: Validación de DTOs de acta, generación de PDFs oficiales con `pdf-lib`, incrustación de firmas PNG y flujo completo de firma y auditoría.
   - `acceso-empleado.server.test.ts`: Normalización de cédula, generación segura de PIN criptográfico de 4 dígitos y derivación de contraseñas internas mediante HMAC-SHA256 con secreto de servidor.
   - `security.server.test.ts`: Rate limiting en memoria por IP/acción, política de contraseñas y validación estricta de Magic Bytes / chunks IHDR en imágenes de firmas.
   - `usuarios.functions.test.ts`: Acciones de servidor para creación y edición de auxiliares, asignación de permisos, suspensión/reactivación, gestión de catálogos y portal del empleado.
   - `ajustes.functions.test.ts`: Conservación de la firma técnica cuando se pierde la respuesta de una escritura.
   - `frontend-regressions.test.ts`: Fechas colombianas, paginación, exportaciones completas y aislamiento de cargas entre sesiones.
   - `theme.test.ts`: Igualdad del primer render de tema entre servidor y navegador.

2. **Pruebas de Integración de RLS y Triggers (`tests/rls/`)**:
   - `ecosistema.test.ts`: Aislamiento multi-ecosistema estricto vía `owner_id` y `my_owner_id()` (Admin A y Auxiliar A no ven ni modifican datos del Ecosistema B).
   - `permisos-roles.test.ts`: Protección del rol admin (`user_roles_guard_admin`, índice único `user_roles_un_solo_admin`) y permisos granulares de actas y equipos.
   - `equipos-triggers.test.ts`: Inmutabilidad del número de serie, bloqueo de transiciones de estado directas, generación automática de historial e imposición de regla de paz y salvo en el retiro de empleados.
   - `portal-empleado.test.ts`: Visibilidad restringida del empleado (únicamente sus equipos asignados, sus actas firmadas y reporte de fallas de sus activos).
   - `actas-auditoria.test.ts`: Inmutabilidad estricta de la bitácora de auditoría (bloqueo de `UPDATE`/`DELETE`), transiciones atómicas al firmar actas, sellado de `pdf_hash`, políticas WORM en storage y RPC `panel_conteos_actas`.
   - `integridad-transaccional.test.ts`: Identidades protegidas, suspensión efectiva, reservas de firma y PIN, documentos inmutables, recepción válida y rollback de operaciones compuestas.

---

## Licencia

Propiedad exclusiva de **Finesa S.A.** Todos los derechos reservados.

### Prueba de firma en la red interna

La configuración `lan.json` de la carpeta local detectada define `signatureOrigin`
con `http://IP-ACTUAL-DEL-EQUIPO:8080` y `allowedNetworks` con `["172.18.150.0/23"]`.
Use la IPv4 vigente del adaptador conectado a la red corporativa. Al iniciar con
`node scripts/local.mjs serve`, la app escucha en todas las interfaces y el botón
Copiar enlace usa ese origen, incluso desde localhost. El firewall de Windows
limita el puerto 8080 al perfil Dominio, IP local configurada y subred
172.18.150.0/23 (regla Finesa-Firmas-LAN). Supabase y Studio siguen en loopback.
Esta prueba habilita la firma por token; la administración continúa en localhost.
Los enlaces vencen en 15 minutos. El equipo debe estar encendido y conectado.
Si cambia la IP, actualizar lan.json y la regla, reiniciar la app y generar otro enlace.
La aplicación comprueba la IP antes de emitir un enlace y avisa si ya no pertenece
al equipo. Para ajustar únicamente la dirección local de la regla existente,
ejecute en PowerShell como administrador:

```powershell
.\scripts\repair-signature-firewall.ps1 -LocalAddress "IP-ACTUAL-DEL-EQUIPO"
```

El script conserva el puerto, el perfil y la red remota autorizada. Los enlaces
ya enviados conservan la IP anterior; deben generarse y enviarse nuevamente.
HTTP es solo para esta prueba interna; configurar HTTPS antes del despliegue definitivo.
Para volver al modo exclusivo del equipo, retirar lan.json, deshabilitar la regla
y reiniciar la aplicación. No se modifica la base de datos para habilitar la red.

### Restricción a redes internas

El servidor comprueba la IP de la conexión TCP antes de atender páginas y
funciones de servidor, incluidas la consulta y la firma por token. Permite el
equipo local y los rangos CIDR expresamente autorizados en `allowedNetworks`;
el iniciador los pasa como `INTERNAL_NETWORK_CIDRS`. Las cabeceras
`X-Forwarded-For`, `X-Real-IP` y similares no conceden acceso. Una IP ausente,
un rango no autorizado o una configuración inválida produce HTTP 403.
Sin rangos configurados, únicamente se permite el equipo local.

La red confirmada es `172.18.150.0/23`. El rango de la VPN todavía debe ser
confirmado por TI; no se autoriza cualquier IP privada de forma genérica.
Después de confirmar el origen que ve el servidor para la VPN, agregarlo a
`allowedNetworks` y a la regla de firewall correspondiente y reiniciar.
Esta configuración supone conexión directa al servidor Node; no publicar
mediante túneles ni agregar proxies sin revisar el control de acceso.
El firewall debe estar activo en su política efectiva para actuar como segunda
barrera. No se deben modificar políticas corporativas globales desde la app.
