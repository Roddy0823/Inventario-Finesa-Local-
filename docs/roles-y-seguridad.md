# Roles y seguridad

[Índice de documentación](README.md) · Revisión: 24 de noviembre de 2026.

## Identidades y alcance

| Rol        | Acceso                                                                     | Administración                                                                     |
| ---------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `admin`    | Módulos de personal y todas las acciones habilitadas para el administrador | Solo se asigna por SQL; existe un índice que permite un único administrador global |
| `auxiliar` | Panel, consulta de equipos/empleados y módulos según permisos              | El administrador crea y gestiona su cuenta                                         |
| `empleado` | `/mi-portal` y `/ajustes`; datos vinculados al empleado                    | El personal autorizado habilita o regenera su PIN                                  |

Una cuenta inactiva o sin rol válido no obtiene acceso funcional. El personal usa correo y contraseña; el empleado ingresa mediante una función de servidor que transforma cédula y PIN en la credencial interna de Auth.

Los registros de negocio se aíslan por `owner_id`. `my_owner_id()` resuelve el ámbito del personal; el empleado accede mediante su vínculo particular. Aunque el modelo contempla ecosistemas, el límite actual de administrador único sigue vigente. No describir esta instalación como una plataforma con múltiples administradores simultáneos.

## Permisos del auxiliar

| Identificador                | Alcance principal                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `equipos_editar`             | Alta y edición de equipos, cambios autorizados de estado, alistamiento y atención de fallas    |
| `reabastecimiento_gestionar` | Pedidos, recepción y mínimos de stock                                                          |
| `proveedores_editar`         | Proveedores, artículos asociados y recepción directa                                           |
| `cargas_masivas`             | Acceso a cargas Excel/CSV; las escrituras además quedan sujetas a los permisos de cada entidad |
| `empleados_editar`           | Gestión de empleados, retiro/reactivación y acceso por PIN                                     |
| `actas_entrega`              | Creación de entregas y préstamos                                                               |
| `actas_devolucion`           | Creación de devoluciones                                                                       |
| `firmas_capturar`            | Firma presencial y emisión de enlaces remotos                                                  |
| `repositorio_ver`            | Repositorio y descarga de actas                                                                |
| `estadisticas_ver`           | Estadísticas y sus exportaciones                                                               |
| `reportes_exportar`          | Reportes y exportaciones                                                                       |
| `catalogos_editar`           | Gestión de catálogos maestros                                                                  |

Un cambio requiere entrega y devolución. Poder entrar al formulario de actas no concede ambas acciones. Los detalles de acta admiten acceso del personal con alguno de los permisos de repositorio, entrega, devolución o captura; cada operación conserva su propia autorización.

Usuarios y auditoría son exclusivos del administrador. También lo son la corrección de series, la baja de equipos y la anulación de actas. La visibilidad de botones no sustituye las comprobaciones en servidor y base de datos.

Los permisos se obtienen de `user_permisos` y, para permisos adicionales, de `auth.users.app_metadata.permisos_extra`. La RPC `reemplazar_permisos_usuario` mantiene ambas representaciones. No modificar únicamente una fuente ni colocar permisos en metadatos editables por el propio usuario.

## Controles implementados

- **Sesiones:** `getUser()` valida la identidad; la consulta del perfil y permisos se reutiliza durante 30 segundos para navegación. El cambio de cuenta y el cierre de sesión limpian las consultas. Las operaciones vuelven a comprobar autorización.
- **Servidor:** las funciones protegidas reciben un Bearer token y aplican `requireSupabaseAuth`. El cliente administrativo se utiliza solo en servidor, con comprobaciones de alcance antes de actuar.
- **PostgreSQL:** RLS, triggers y RPC controlan acceso, referencias entre ecosistemas, estados, documentos e integridad transaccional. No basta con usar `is_staff()` para filtrar datos de negocio.
- **PIN:** se deriva una contraseña mediante HMAC-SHA256 con `SUPABASE_SERVICE_ROLE_KEY`. Hay reservas serializadas de intento y bloqueo de 15 minutos tras cinco fallos. La clave original debe conservarse durante una recuperación.
- **Red:** el servidor usa la dirección TCP real y los CIDR autorizados; no concede acceso por `X-Forwarded-For` o `X-Real-IP`. Sin redes configuradas permite solo loopback; configuración inválida o IP ausente produce 403.
- **Firmas:** los tokens no se consultan directamente desde el cliente de base de datos. La función de emisión devuelve el enlace al personal autorizado. La vigencia es de 15 minutos y el consumo se confirma junto con la firma.
- **Archivos:** los buckets son privados y las descargas utilizan mecanismos autorizados y enlaces temporales. Las imágenes de firma se validan por formato PNG, estructura, dimensiones y límites de tamaño.
- **Evidencia:** auditoría bloquea UPDATE/DELETE; las actas firmadas conservan documento y hash. Las operaciones administrativas registran explícitamente al actor cuando corresponde.

## Límites operativos

La política de inmutabilidad protege las operaciones contempladas por la aplicación y sus roles; no equivale a un servicio externo de custodia ni elimina la capacidad de administración de infraestructura. El hash identifica el contenido del PDF; no debe describirse como certificado digital emitido por una autoridad certificadora.

La prueba de firma LAN utiliza HTTP y acceso directo al servidor. El despliegue definitivo necesita una configuración de HTTPS y red validada para ese entorno. La restricción por IP debe revisarse antes de introducir proxies, balanceadores o túneles. El rango de VPN no se deduce de que una dirección sea privada.

No guardar claves de servicio en variables `VITE_`, Git o documentación. Proteger también respaldos y `administrador-local.json`, ya que contienen credenciales. Una rotación de la clave de servicio requiere evaluar el impacto sobre las contraseñas derivadas de los PIN.

**Fuentes:** [permisos](../src/lib/constantes.ts), [acceso por ruta](../src/lib/route-access.ts), [identidad](../src/lib/me.ts), [middleware](../src/integrations/supabase/auth-middleware.ts), [PIN](../src/lib/acceso-empleado.server.ts), [red](../src/lib/network-access.server.ts) y [migraciones](../supabase/migrations/).
