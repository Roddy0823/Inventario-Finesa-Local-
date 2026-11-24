# Manual de usuario

[Índice de documentación](README.md) · Revisión: 24 de noviembre de 2026.

## 1. Ingreso y preparación

Con la instalación encendida, abrir `http://localhost:8080` en el equipo servidor. La mesa de servicios ingresa con correo y contraseña; el empleado utiliza la opción de portal con cédula y PIN de cuatro dígitos cuando esté habilitada.

Si la cuenta está inactiva o carece de rol, la aplicación no habilita los módulos. Cinco intentos de PIN fallidos producen un bloqueo de 15 minutos. Para recuperar acceso de empleado, solicitar a la mesa de servicios que revise su estado y regenere el PIN cuando corresponda. La recuperación por correo pertenece al acceso del personal; en la instalación local los correos quedan en el buzón de pruebas y no se envían al correo corporativo.

En **Ajustes**, revisar nombre, apariencia y cierre por inactividad. El valor inicial de inactividad es 30 minutos; la configuración se guarda en el navegador. El personal puede registrar su firma técnica para las actas. Las opciones disponibles dependen del rol.

Antes de la primera operación, el administrador debe preparar los catálogos, habilitar los auxiliares con sus permisos y revisar el acceso al portal. La [matriz de permisos](roles-y-seguridad.md) explica qué acciones puede delegar.

## 2. Navegación

| Módulo                  | Uso principal                                                          |
| ----------------------- | ---------------------------------------------------------------------- |
| Panel                   | Resumen del inventario y alertas operativas                            |
| Equipos                 | Registro, búsqueda, ficha técnica, estados e historial                 |
| Empleados               | Datos del responsable, equipos, actas y acceso al portal               |
| Actas                   | Entrega, devolución, cambio, firma y repositorio documental            |
| Reabastecimiento        | Mínimos de stock, pedidos y recepción                                  |
| Proveedores             | Directorio, artículos asociados y recepción directa de stock           |
| Carga masiva            | Plantillas, validación e importación de inventario inicial             |
| Estadísticas y reportes | Indicadores y exportación de información                               |
| Catálogos               | Marcas, tipos de equipo, sedes, áreas y empresas                       |
| Usuarios y auditoría    | Administración de auxiliares y consulta de eventos, solo administrador |
| Mi portal               | Activos y actas del empleado, fallas y certificaciones                 |

En equipos, empleados y actas, utilizar los filtros y la paginación para localizar registros. Una pantalla sin resultados puede deberse a los filtros o al alcance de la cuenta. Si aparece un error de consulta, reintentar; una lista conservada tras un fallo temporal puede representar la última lectura disponible.

## 3. Catálogos y empleados

Los catálogos normalizan los valores utilizados en formularios e importaciones. **Modelo** es un dato de la ficha del equipo, no un catálogo independiente. Crear los valores necesarios y revisar su estado activo antes de importar o registrar información.

Para un empleado:

1. Abrir **Empleados** y registrar identificación, nombre y demás datos organizacionales.
2. Verificar la cédula: es única globalmente en la base.
3. Abrir su ficha para consultar equipos y movimientos.
4. Habilitar o regenerar el PIN de acceso si necesita el portal; entregar ese PIN al empleado por un canal apropiado.
5. Antes de retirar al empleado, completar las devoluciones y resolver sus pendientes. La base aplica la condición de paz y salvo y puede rechazar el retiro.

Registrar una persona no implica que ya tenga una cuenta habilitada para entrar al portal.

## 4. Gestión de equipos

Registrar el tipo, serie o código interno y los datos disponibles: marca, modelo, activo fijo, nombre de equipo, sistema operativo, sede, compra, proveedor y garantía. Los equipos sin serial pueden recibir un código interno `FIN-ACC`. La serie y la placa de activo fijo, cuando se diligencia, no deben duplicarse.

| Estado          | Significado y operación habitual                                           |
| --------------- | -------------------------------------------------------------------------- |
| Disponible      | Se puede seleccionar para una entrega                                      |
| Asignado        | Está a cargo de un empleado                                                |
| En alistamiento | Está en revisión o preparación; finalizar alistamiento lo deja disponible  |
| En reparación   | Tiene una intervención abierta y puede conservar el empleado relacionado   |
| De baja         | Salida definitiva; no admite volver a otro estado mediante el flujo normal |

La ficha permite consultar historial, actas relacionadas, información de compra y soportes. Para cambiar datos descriptivos, utilizar la edición de ficha. La corrección de serie es una acción exclusiva del administrador que exige motivo y queda registrada.

Para enviar un equipo a reparación, elegir el cambio de estado, registrar motivo y proveedor si aplica. Al finalizar la reparación, indicar si vuelve al empleado vinculado o queda disponible. Si se necesita un reemplazo temporal, el flujo de contingencia permite crear un acta de préstamo para un equipo disponible y una fecha límite.

La baja es exclusiva del administrador y requiere motivo. El soporte de baja es **opcional** en la interfaz actual y tiene un máximo de 10 MB. Conservar el soporte cuando el procedimiento interno de la empresa lo requiera.

## 5. Crear y firmar actas

La creación deja el acta **pendiente**. Los movimientos de entrega y devolución se aplican al confirmar su firma, no al guardar el formulario. Los equipos incluidos en actas pendientes quedan reservados frente a movimientos incompatibles.

### Entrega

1. Abrir **Nueva acta** y elegir **Entrega**.
2. Seleccionar un empleado activo y uno o varios equipos disponibles.
3. Registrar estado físico, accesorios, notas y observaciones.
4. Crear el acta y revisar el resumen.
5. Capturar la firma por uno de los medios disponibles.
6. Confirmar que el acta figura como firmada y que los equipos quedaron asignados al empleado.

Un préstamo se representa como una entrega marcada `es_prestamo` con fecha de vencimiento. No es un cuarto tipo de acta ni un sexto estado de equipo. Al firmarse, la fecha se copia al equipo; una devolución posterior la limpia.

### Devolución

Seleccionar **Devolución**, el empleado y los equipos asignados que reintegra. Para cada línea definir el destino: disponible, en alistamiento o en reparación. Registrar las condiciones y firmar. La confirmación libera al empleado de esos equipos y aplica el estado de destino.

### Cambio

Elegir **Cambio** y seleccionar al menos un equipo que el empleado devuelve y uno disponible que recibe. Revisar la dirección de cada línea y el destino de lo devuelto. Una sola firma aplica ambos movimientos. El auxiliar necesita los permisos de entrega y devolución.

### Medios de firma

| Medio         | Procedimiento                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Presencial    | En el detalle del acta, el empleado dibuja su firma y el personal confirma                                                   |
| Enlace remoto | El personal utiliza **Copiar enlace de firma** y comparte el enlace; el destinatario revisa y firma desde una red autorizada |
| Portal        | El empleado abre sus pendientes, revisa el acta y confirma su firma                                                          |

El enlace remoto vence en **15 minutos**. Si vence o cambia la dirección del servidor, generar uno nuevo. En la prueba LAN, el equipo servidor debe estar encendido y conectado; ver [operación de red](instalacion-y-operacion.md). Copiar un enlace no envía un correo ni un mensaje automáticamente.

Registrar la firma técnica en Ajustes antes de emitir actas. La aplicación intenta copiarla al documento; si muestra un aviso de que no pudo adjuntarla, revisar la firma y el acta antes de continuar. El cambio posterior de la firma personal no reemplaza la copia ya asociada a un acta.

Al completar la firma se genera un PDF en servidor con datos del movimiento, firmas disponibles y evidencia de la operación; se almacena su hash SHA-256. Para descargarlo, utilizar el detalle o el repositorio. Si una confirmación tarda o falla la respuesta, volver a consultar el estado antes de crear otra acta.

### Anulación

Solo el administrador puede anular, siempre indicando motivo. El acta conserva trazabilidad y sus enlaces pendientes quedan invalidados. **Anular un acta firmada no revierte los movimientos de los equipos**. Revisar el inventario y realizar la corrección operativa que corresponda; la propia pantalla advierte que puede ser necesario ajustar los estados.

## 6. Proveedores y reabastecimiento

Crear o actualizar los datos del proveedor y sus artículos asociados. Revisar mínimos de stock en reabastecimiento para identificar faltantes.

Para comprar y recibir:

1. Crear un pedido, seleccionar proveedor y agregar artículos, cantidades y precios de referencia.
2. Guardarlo como borrador o registrarlo como pedido realizado.
3. Al recibir una línea, indicar seriales o cantidad sin serial, datos de los equipos y las placas de activo fijo cuando aplique.
4. Confirmar la recepción: se crean los equipos disponibles y se actualizan las cantidades recibidas en una transacción.
5. Revisar el estado del pedido: puede quedar parcial o recibido. No se permite recibir más de lo pendiente.

Los estados son borrador, pedido, parcial, recibido y cancelado. La cancelación solicita motivo. El código no implementa un circuito separado de aprobación jerárquica de compras.

La recepción directa desde Proveedores registra un lote de equipos; no sustituye la recepción de una línea de pedido cuando se necesita actualizar sus cantidades.

## 7. Carga masiva

1. Abrir **Carga masiva** y descargar la plantilla generada por la aplicación para obtener los catálogos vigentes.
2. Diligenciar las hojas `Empleados`, `Inventario_Equipos` y `Asignaciones` necesarias, conservando sus encabezados. Mantener identificaciones, seriales y placas como texto para evitar que Excel cambie su formato.
3. Cargar el archivo y revisar las filas nuevas, existentes, inválidas y los avisos. El importador define límites de 15 MB y 5.000 filas por hoja.
4. Resolver los errores. Si faltan valores de catálogo, revisar la opción de creación y los permisos antes de autorizarla.
5. Confirmar y esperar el resultado. Revisar los registros insertados, omitidos y fallidos antes de repetir una carga.

Los registros detectados como existentes **se omiten**, no se actualizan de forma general. El procesamiento usa lotes de 200 y puede reintentar filas individualmente. **Todo el archivo no constituye una única transacción**: un fallo puede dejar registros anteriores correctamente cargados. Corregir y volver a validar antes de reintentar evita asumir que todo se deshizo.

Las asignaciones iniciales usan una RPC específica; son una carga de situación inicial y no una firma de entrega ordinaria. Los importadores CSV disponibles en las pantallas también exigen sus permisos correspondientes. Mantener la sesión durante la operación; cambiar de usuario invalida el trabajo pendiente del importador.

## 8. Portal del empleado

El empleado puede consultar sus equipos, incluidos los relacionados con reparación, revisar y firmar actas pendientes, consultar su historial y descargar documentos disponibles. También puede reportar una falla de sus equipos y responder campañas de certificación.

Para reportar una falla, seleccionar el equipo, describir el problema y enviar. Esto crea un reporte dentro de la aplicación; no presupone integración con un sistema externo de tickets. Para una certificación, indicar cuáles equipos conserva y explicar los faltantes antes de confirmar.

## 9. Reportes y auditoría

Aplicar los filtros del módulo antes de exportar y comprobar fecha, alcance y cantidad de registros del archivo. El repositorio ofrece documentos individuales y descarga agrupada; las opciones de CSV, Excel o PDF dependen de la pantalla. Los reportes de análisis no reemplazan el PDF firmado de un acta.

El administrador puede consultar auditoría y ampliar un evento para ver los cambios disponibles. La bitácora no se edita ni elimina desde la aplicación.

**Fuentes:** [rutas](../src/routes/_authenticated/), [constantes](../src/lib/constantes.ts), [importador](../src/components/ImportExcel.tsx), [pedidos](../src/components/Pedidos.tsx) y [firmas](../src/lib/firmas.functions.ts).
