# Documentación de Finesa — Inventario TI y Actas Digitales

Documentación funcional y técnica del código local revisado el **24 de noviembre de 2026**. Incluye los cambios presentes en el directorio de trabajo, aunque todavía no estén confirmados en Git. Está dirigida a la mesa de servicios, administradores, empleados y responsables de mantenimiento.

## Guías

| Documento                                                   | Contenido                                                                   | Público                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------ |
| [Manual de usuario](manual-usuario.md)                      | Acceso, equipos, empleados, actas, firmas, compras, importación y consultas | Mesa de servicios y empleados        |
| [Roles y seguridad](roles-y-seguridad.md)                   | Permisos, alcance de cada cuenta y controles de protección                  | Administradores y TI                 |
| [Instalación y operación](instalacion-y-operacion.md)       | Instalación local, arranque, actualización, respaldo, red y diagnóstico     | Operación de TI                      |
| [Arquitectura](arquitectura.md)                             | Componentes, autenticación, firma, rutas y estructura del código            | Desarrollo y soporte                 |
| [Modelo de datos](modelo-de-datos.md)                       | Entidades, relaciones, estados, RPC y migraciones                           | Desarrollo y bases de datos          |
| [Mantenimiento y validación](mantenimiento-y-validacion.md) | Comandos de desarrollo, pruebas, comprobación funcional y límites           | Desarrollo y responsables de entrega |

## Alcance

Finesa administra equipos tecnológicos, sus responsables, movimientos mediante actas, firmas, proveedores, pedidos, fallas y certificaciones. La implementación utiliza React y TanStack Start con Supabase para autenticación, PostgreSQL y almacenamiento privado.

La instalación descrita es la modalidad local Windows con Docker. El acceso remoto configurado para la prueba interna permite firmar por enlace; no equivale a un despliegue completo de todos los módulos en la red. La administración utiliza el navegador del equipo servidor.

El sistema maneja aislamiento por `owner_id`, pero impone **un único administrador global**. El portal del empleado requiere habilitación y una cuenta vinculada al empleado. No existe registro público de administradores.

## Lectura recomendada

1. Para comenzar a operar: [instalación](instalacion-y-operacion.md) y luego [manual de usuario](manual-usuario.md).
2. Para habilitar auxiliares: [roles y seguridad](roles-y-seguridad.md).
3. Para cambiar el código: [arquitectura](arquitectura.md), [datos](modelo-de-datos.md) y [mantenimiento](mantenimiento-y-validacion.md).

## Fuentes y vigencia

Se contrastaron rutas, componentes, funciones de servidor, scripts locales, configuración de pruebas y las seis migraciones disponibles hasta `20261123011416_optimizar_consultas_rls.sql`. Los enlaces al código en cada guía permiten comprobar el comportamiento descrito.

Esta revisión documental no certifica una nueva ejecución de pruebas, una restauración ni el estado de la instalación en funcionamiento. Los [informes históricos](informes/) conservan evidencia de sus propias fechas. El [roadmap](../roadmap.md) es un registro de planificación y puede contener pendientes históricos; no sustituye la verificación del código y del entorno.

Al cambiar un flujo, permiso, variable, migración o procedimiento operativo, actualizar la guía correspondiente junto con el código. No incluir contraseñas, PIN, tokens, archivos de empleados ni copias de respaldo en la documentación.
