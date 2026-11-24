# Mantenimiento y validación

[Índice de documentación](README.md) · Revisión: 24 de noviembre de 2026.

## Entorno de desarrollo

Leer [AGENTS.md](../AGENTS.md) antes de cambiar reglas o permisos. Instalar con `bun install --frozen-lockfile` y utilizar la configuración de [instalación](instalacion-y-operacion.md). El servidor de desarrollo escucha en `127.0.0.1:8080`; no ejecutarlo simultáneamente con el servidor local de producción en el mismo puerto.

| Comando                         | Propósito                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `bun run dev`                   | Desarrollo con Vite; requiere configuración válida de Supabase                           |
| `bun run typecheck`             | TypeScript sin emitir archivos                                                           |
| `bun run lint`                  | ESLint                                                                                   |
| `bun run test:unit`             | Pruebas unitarias de servidor y lógica compartida                                        |
| `bun run test:rls`              | Migraciones, RLS, triggers y RPC en PGlite                                               |
| `bun run test`                  | Conjunto Vitest completo                                                                 |
| `bun run test:runtime`          | Pruebas de scripts locales con el runner de Node                                         |
| `bun run build:check`           | Compilación aislada de validación en `.cache/check-build`                                |
| `bun run check`                 | Tipos, lint, Vitest, scripts y compilación de validación                                 |
| `node scripts/local.mjs build`  | Compilación operativa con las variables de la instalación                                |
| `node scripts/local.mjs verify` | Comprobación contra servicios locales activos; realiza una escritura temporal de archivo |

`bun run format` formatea el proyecto completo. Para un cambio documental o acotado, pasar solo los archivos editados a Prettier y evitar ruido en otros cambios. No editar manualmente `src/routeTree.gen.ts`.

El workflow en [`.github/workflows`](../.github/workflows/) ejecuta `bun run check` en Windows y Linux con Node 24 y Bun 1.4.4. Su existencia no implica que una revisión determinada haya pasado; consultar el resultado del commit o ejecutar las comprobaciones correspondientes.

## Cobertura y límites

| Área                | Evidencia automatizada disponible                                                           |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Identidad y cuenta  | Sesión verificada, caché, permisos, PIN, usuarios y middleware                              |
| Firma y archivos    | Validación PNG, generación de PDF, servidor de firma, rutas, hash y recuperación de errores |
| Reglas SQL          | Ecosistemas, roles, series, estados, portal, auditoría, reservas y operaciones atómicas     |
| Interfaz compartida | Fechas, paginación, tema, errores de consulta, Realtime y aislamiento de carga por sesión   |
| Instalación local   | Detección de runtime, Docker, disponibilidad, reutilización y checksum de migraciones       |

Las pruebas unitarias usan dependencias simuladas donde corresponde. PGlite valida SQL en PostgreSQL embebido; no reemplaza un ensayo con Auth, gateway, Storage, Realtime, Docker y navegadores reales. La compilación valida el empaquetado, pero no demuestra que una cuenta pueda iniciar sesión en el despliegue.

## Validación funcional de una entrega

Realizar los escenarios en un entorno de prueba con datos identificables. Registrar versión o commit, fecha, responsable, resultado esperado, resultado observado y evidencia sin credenciales. Esta lista es un procedimiento propuesto; no representa pruebas ejecutadas durante la elaboración de estos documentos.

| Escenario                           | Resultado a comprobar                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Ingreso de administrador y auxiliar | Cuenta activa accede a sus módulos; cuenta suspendida no opera                                                |
| Permiso retirado                    | El auxiliar no puede ejecutar la operación aunque conozca la URL                                              |
| Empleado A y empleado B             | Cada empleado consulta y firma únicamente sus propios registros                                               |
| Alta y duplicados                   | Se registra un equipo válido; serie, placa o identificación duplicada se rechazan                             |
| Entrega pendiente                   | Se crea acta y reserva, sin asignar todavía el equipo                                                         |
| Firma presencial                    | Se confirma una vez, cambia inventario y queda PDF descargable                                                |
| Enlace remoto                       | Se firma desde una red autorizada; se rechaza enlace vencido o acceso no autorizado                           |
| Firma desde portal                  | El empleado confirma su acta y consulta el documento                                                          |
| Devolución y cambio                 | Se aplican los destinos correctos y ambas direcciones del cambio                                              |
| Préstamo y reparación               | Se registra vencimiento y se limpia al devolver; finalización conserva o libera al responsable según elección |
| Anulación                           | Se conserva motivo y evidencia; no se presupone reversión del inventario                                      |
| Retiro de empleado                  | Se rechaza si incumple paz y salvo y se permite cuando cumple las condiciones                                 |
| Pedido parcial y completo           | La cantidad y el stock coinciden; una recepción excesiva no se aplica                                         |
| Carga masiva                        | Se identifican filas nuevas, omitidas y fallidas; reintento no supone rollback total                          |
| Reporte de falla y certificación    | Solo se opera sobre activos y campañas autorizados                                                            |
| Cambio de sesión y reconexión       | No se muestran datos de la cuenta anterior y se actualizan consultas al reconectar                            |
| Respaldo y recuperación             | Se recuperan usuarios, inventario, claves y archivos en un ensayo aislado                                     |

Para cambios solo documentales basta contrastar afirmaciones con sus fuentes, comprobar enlaces locales y formato y revisar el diff. No es necesario reiniciar servicios ni ejecutar operaciones de negocio sobre datos reales.

## Cómo extender el sistema

1. Identificar la regla de negocio y su permiso; definir la validación en SQL/servidor además de la interfaz.
2. Agregar una migración si cambia el esquema o las políticas. Conservar los archivos ya aplicados y sus checksums.
3. Mantener los tipos de Supabase alineados con el esquema y los validadores de funciones alineados con sus consumidores.
4. Actualizar consultas, claves e invalidaciones afectadas; contemplar errores temporales y cambios de cuenta.
5. Agregar pruebas del comportamiento nuevo cuando exista una regla o riesgo que lo justifique.
6. Ejecutar las comprobaciones pertinentes y el conjunto requerido para la entrega; documentar fallos o comprobaciones pendientes.
7. Actualizar las guías afectadas y respaldar antes de desplegar migraciones.

## Restricciones y pendientes documentados

- La administración completa desde otros equipos no está resuelta por la configuración de firma LAN: el cliente Supabase sigue apuntando a loopback.
- La configuración local captura correo en Mailpit; el correo real requiere una configuración de servicio distinta.
- No hay restaurador automático ni evidencia de un ensayo nuevo de recuperación en esta revisión documental.
- No se ha definido aquí un objetivo de tiempo de recuperación, pérdida máxima de datos o capacidad de usuarios simultáneos; requieren medición y acuerdo operativo.
- No existe sincronización offline de inventario. La PWA precarga únicamente recursos estáticos básicos.
- Las importaciones por lotes pueden tener resultados parciales y no actualizan todos los registros existentes.
- Los informes históricos y el roadmap deben interpretarse según su fecha; el código local puede incorporar cambios posteriores.

**Fuentes:** [scripts de paquete](../package.json), [configuración Vitest](../vitest.config.ts), [pruebas](../tests/), [scripts](../scripts/) y [workflow](../.github/workflows/).
