### Changelog

## [12.0.0] - 2026-08-17

### Añadido
- Panel de filtros (6 botones + descripción) reubicado en vista móvil: ahora aparece entre el texto "Ventana XX/XX/XXXX" y el bloque de KPIs, en vez de tras ellos.
- Textos operativos de instrucciones para el Guardián al pulsar los KPIs "Avisos", "Errores" y "Pdte. Comprobación":
  - Avisos → "Backups con estado Warning" + pasos según tipo de backup (Veeam/VDC/Barracuda).
  - Errores → "Backups con estado fallido" + pasos según tipo de backup (Veeam/VDC/Barracuda).
  - Pdte. Comprobación → "Backups AS400 pendientes de confirmar, revisando su log" + procedimiento de revisión de log y marcado manual como Success.

## [11.0.0] - 2026-08-17

### Añadido
- Botón circular de actualización (⟳) en la topbar móvil, entre "Actualizado a HH:mm" y el badge de login Entra ID.
- Separación visual de los KPIs en dos bloques para guardias: "Sin intervención del Guardián" (Jobs hoy, Éxitos, En curso) y "Requieren intervención" (Avisos, Errores, Pdte. Comprobación).

### Cambiado
- Formato de "Actualizado" en móvil: se elimina el campo de segundos, mostrando solo HH:mm.
- Textos descriptivos de los filtros (Todos, Veeam Backup, VDC, Barracuda, AS400, NOK) ampliados y clarificados para guardias.
- Alineación del título "SITUACIÓN BACKUP DEL DÍA..." corregida para quedar exactamente debajo de "Backup Monitor Pro".

### Eliminado
- Eliminada en vista móvil la fila de Buscar/Actualizar/Enviar/Exportar/Planificador de la toolbar (el refresco pasa a la topbar).

### Corregido
- Corregido el bloqueo de scroll en navegadores móviles (Edge/Chrome Android): `.app` usaba `height: 100vh` fijo, lo que ocultaba los botones "Ver log"/"Editar" del último job bajo la barra de navegación del móvil. Sustituido por `height: auto` + `min-height: 100dvh` en `.app`, y añadido `padding-bottom` de colchón en `.content`.

#### [10.0.0] - 2026-08-13

##### 🚀 Versión mayor
- Sesión de correcciones de fiabilidad en KPIs y en el Historial de ejecuciones, detectadas tras el cierre de v9.0.0.

##### 🐛 Corregido
- **KPIs duplicados en Dashboard y correo diario (17:00) para jobs relanzados**: cuando un job fallaba (o tenía avisos) y se relanzaba quedando actualmente EN CURSO dentro de la misma ventana operacional, `applyRelaunchLogic` (en `electron/modules/engine.cjs`) devolvía una fila por cada estado distinto detectado entre los reintentos (p. ej. `failed` + `running`, o `warning` + `running`), por lo que el job se contabilizaba simultáneamente en Errores/Avisos **y** en En Curso.
- Se añadió una comprobación previa: si existe alguna ejecución `running`/`pending` dentro del grupo de reintentos, solo se conserva esa ejecución (la más reciente), ya que el resultado final aún no se conoce. Los casos `hasSuccess` y `allFailed` (ya existentes) no se modificaron. La corrección afecta tanto al Dashboard como al correo diario, ya que ambos consumen el mismo snapshot (`lastPayload`).
- **Filas fantasma en el Historial de ejecuciones AS400**: algunos jobs AS400 (detectado en RR, aunque el mecanismo aplica a cualquiera) reciben más de un correo con idéntico asunto y remitente (`Log Backup RR` / `QSYSOPR.rr@UCI.COM`) para la misma ejecución real; uno de ellos trae el log completo y parseable, y otro no, generando una fila adicional en el Historial con INICIO = hora de recepción del correo y DURACIÓN vacía (`—`), justo coincidiendo con la hora de finalización real del job.
- `getJobExecutionsFromEmailHistory` (en `electron/modules/graph.cjs`) ahora deduplica las ejecuciones agrupando por día calendario (según `start`, con fallback a `end`/`receivedDateTime`): cuando dos o más ejecuciones caen en el mismo día, se conserva la que tiene datos realmente parseados (`parsed === true`); si ninguna se pudo parsear, se conserva la más reciente de ese día para no perder el rastro. Esta deduplicación aplica a las 3 fuentes que usan el Historial (AS400, Barracuda, VDC), no solo a AS400.

##### 🔧 Interno
- Cambios principales en:
- `electron/modules/engine.cjs` (`applyRelaunchLogic`: nuevo caso `running`/`pending` con prioridad sobre `failed`/`warning`).
- `electron/modules/graph.cjs` (`getJobExecutionsFromEmailHistory`: nueva lógica de deduplicación por día con `getDayKey`/`bestByDay`).
- Validado en producción en DASHBOARD el 13/08/2026: Historial de "Backup AS400 RR" ya no muestra filas duplicadas con duración vacía.

##### ⚠️ Pendiente conocido (acumulado, no solo de esta sesión)
- Confirmar en el próximo caso real de relanzamiento (fallo/aviso → reintento en curso) que el correo de las 17:00 y el Dashboard ya no duplican el KPI.
- Auditar el estado PDTE COMPROBACIÓN (AS400) en HistoryTab.tsx/ExecutionsTab.tsx (arrastrado desde v7.0.0/v8.0.0).
- Asignar un badge/color propio a PDTE COMPROBACIÓN en la tabla (actualmente usa estilo neutro).
- Revisar el doble login de Microsoft/Entra ID observado en producción (arrastrado desde v8.0.0).
- Evolución pendiente de destinatarios del informe diario desde la UI (S-5): persistencia en config-shared.json y gestión de Para/CC/CCO (definida pero no completada).
- Valorar quitar o silenciar el log de diagnóstico [REFRESH:ROWS] si genera demasiado ruido en producción (arrastrado desde v7.0.0).
- Automatizar la sincronización de CHANGELOG.md hacia public/CHANGELOG.md (por ejemplo con un script prebuild en package.json), ya que el modal de versiones lee /CHANGELOG.md desde public/dist, no desde la raíz del repo (detectado en v9.0.0).

#### [9.0.0] - 2026-08-11

##### 🚀 Versión mayor
- Sesión dedicada a corregir INICIO/FIN/DURACION reales para los backups que no son Veeam SQL: Barracuda, VDC (Veeam Data Cloud) y AS400.
- Cierre de 4 incidencias encadenadas detectadas y corregidas en cascada durante la validación en producción.

##### 🐛 Corregido
- **Barracuda mostraba la ventana operacional en vez de la hora real de INICIO**: el Dashboard usaba `evaluateEmailRule` (generico) para Barracuda, que nunca leia el cuerpo del correo y dejaba `startTime`/`endTime`/`durationMs` en null, mostrando `receivedDateTime`/`nextRun` en su lugar.
- Nueva funcion `evaluateBarracudaRule` (async) en `electron/modules/rules.cjs`: descarga el cuerpo del correo con `getMessageBody`, aplica `cleanBarracudaFooter` + `parseBarracudaBody` y usa los campos reales `Start Date`/`End Date`/`Duration` del log (con fallback a `errorWord`/`successWord` si falla la descarga).
- `buildBarracudaRows` paso a ser `async` y recibe `cfg`; `server.js` actualizado para `await` y pasar `cfg`.
- **Columna INICIO priorizaba `nextRun` sobre `startTime`**: en `src/components/JobTable.tsx`, tanto la vista de escritorio como la movil usaban `r.nextRun ?? r.startTime`, por lo que Barracuda (y cualquier fuente con `nextRun` siempre relleno) nunca llegaba a mostrar su `startTime` real. Invertido a `r.startTime ?? r.nextRun`.
- **Duracion de Barracuda vacia**: `evaluateBarracudaRule` calculaba `durationMs` correctamente pero dejaba `duration: ''` sin formatear. Ahora usa `formatDurationMs(durationMs)`, igual que el resto de fuentes.
- **VDC no calculaba tiempos reales**: `parseVdcBody` solo miraba `subject`/`bodyPreview` y siempre devolvia `startTime`/`endTime`/`durationMs` en null (limitacion documentada en v2.2).
- `parseVdcBody` ahora acepta un segundo parametro `bodyContent` y extrae la hora de finalizacion real del correo mediante el patron `finished on ... UTC`.
- Nueva funcion `evaluateVdcRule` (async) en `electron/modules/rules.cjs` con horario fijo por tipo de backup (`VDC_FIXED_SCHEDULE`): VDC Exchange 01:30, VDC OneDrive 02:30, VDC Sharepoint y Teams 22:00. El dia se calcula segun `computeVdcFixedStart`, ajustando a la ventana operacional que arranca a las 18:00.
- `buildVdcRows` paso a ser `async` y recibe `cfg`; `server.js` actualizado para `await` y pasar `cfg`.
- **AS400 no calculaba tiempos reales en el Dashboard en vivo**: `evaluateAs400Rule` obtenia el adjunto (`as400LogContent`) pero nunca lo parseaba, dejando `startTime: null` y usando `receivedDateTime` como aproximacion de FIN (a diferencia del Historico, que si usa `parseAs400Attachment` desde v2.2).
- Ademas, `buildAs400Rows` descargaba el adjunto real (via `fetchAs400Attachment`) **despues** de que `evaluateAs400Rule` ya hubiera construido la fila, por lo que aunque se intentara parsear en el sitio equivocado, el contenido real llegaba demasiado tarde.
- Se añadio un segundo paso en `buildAs400Rows` que reparsea con `parseAs400Attachment` tras la descarga del adjunto y sobreescribe `startTime`/`endTime`/`durationMs`/`duration` en la fila ya construida, sin tocar `status`/`reason` (para no afectar la logica de **PDTE COMPROBACIÓN**).
- **Colision de subject entre "Backup AS400 SD" y "Backup AS400 SDB/TGT"**: el patron `"LOG Backup SD"` es substring literal de `"LOG Backup SDB/TGT"`, y el matching con `includesCI` (simple `.includes`) no respeta bordes de palabra, por lo que ambas reglas devolvian el mismo correo y, por tanto, los mismos tiempos.
- Añadido `patternRegex` con bordes de palabra `(^|[^a-z0-9])patron([^a-z0-9]|$)` en `evaluateAs400Rule`, replicando el mismo criterio ya validado desde v2.2 en el Historico (`getJobExecutionsFromEmailHistory` en `graph.cjs`).

##### ✨ Añadido
- **Regla funcional exclusiva de VDC**: solo se considera la primera ejecucion (primer correo cronologico) de cada ventana operacional para cada uno de los 3 backups VDC, ignorando correos posteriores del mismo job en esa misma ventana independientemente de su resultado. El `sort` de `evaluateVdcRule` se invirtio de mas-reciente-primero a mas-antiguo-primero para reflejar esta regla.

##### 🔧 Interno
- Cambios principales en:
- `electron/modules/graph.cjs` (`parseVdcBody` con extraccion de `endTime` real).
- `electron/modules/rules.cjs` (`evaluateBarracudaRule`, `evaluateVdcRule`, `VDC_FIXED_SCHEDULE`, `computeVdcFixedStart`, `buildBarracudaRows`/`buildVdcRows` ahora async; reparseo de AS400 en `buildAs400Rows`; `patternRegex` con bordes de palabra en `evaluateAs400Rule`).
- `server.js` (llamadas a `buildBarracudaRows`/`buildVdcRows` actualizadas con `await` y `cfg`).
- `src/components/JobTable.tsx` (prioridad `startTime` sobre `nextRun` en INICIO, vista escritorio y movil).
- Validado en produccion en DASHBOARD el 05/08/2026 con los 3 jobs Barracuda (Exchange, Sharepoint, OneDrive) mostrando INICIO/FIN/DURACION correctos.
- Validado visualmente en produccion que INICIO de VDC ya muestra las 3 horas fijas correctas.
- Validado en produccion en DASHBOARD el 11/08/2026 con los 4 jobs AS400 (SD, SDB/TGT, PR, RR) mostrando INICIO/FIN/DURACION correctos y distintos entre si.

##### ⚠️ Pendiente conocido (acumulado, no solo de esta sesión)
- Validar FIN y DURACION de VDC con ejecuciones reales (Sharepoint y Teams 22:00, Exchange 01:30 y OneDrive 02:30).
- Auditar el estado PDTE COMPROBACIÓN (AS400) en HistoryTab.tsx/ExecutionsTab.tsx (arrastrado desde v7.0.0/v8.0.0).
- Asignar un badge/color propio a PDTE COMPROBACIÓN en la tabla (actualmente usa estilo neutro).
- Revisar el doble login de Microsoft/Entra ID observado en producción (arrastrado desde v8.0.0).
- Evolución pendiente de destinatarios del informe diario desde la UI (S-5): persistencia en config-shared.json y gestión de Para/CC/CCO (definida pero no completada).
- Valorar quitar o silenciar el log de diagnóstico [REFRESH:ROWS] si genera demasiado ruido en producción (arrastrado desde v7.0.0).

#### [8.0.0] - 2026-08-04

##### 🚀 Versión mayor
- Cierre del bloque de fiabilidad de KPIs para jobs AS400 de comprobación manual (Backup AS400 SD/PR/RR/SDB-TGT), tras detectar que un override manual de un día anterior podía "heredarse" indebidamente al día en curso.

##### 🐛 Corregido
- **Override manual de AS400 sin caducidad**: `hasManualOverrideFor` solo comprobaba si existía una entrada en `manualOverrides` para el job, sin importar su fecha. Esto provocaba que una revisión manual de ayer (p. ej. "Backup AS400 SD" marcado como éxito el 03/08) siguiera aplicando hoy, ocultando que la ejecución del día en curso no había sido revisada todavía. Efecto observado: de los 4 jobs AS400, 2 se mostraban como `SUCCESS` (heredando el override antiguo) y 2 como `PDTE COMPROBACIÓN` (sin override previo).
- `hasManualOverrideFor` ahora recibe la ventana operacional (`windowStart`) y solo respeta el override si su `timestamp` cae dentro de la ventana actual (arranca cada día a las 18:00). Un override de una ventana anterior deja de aplicarse automáticamente, exigiendo nueva revisión manual cada día.
- `applyAs400PendingReview` y el `useMemo` de `dashboardRows` propagan `windowStart` a esta validación.

##### ✨ Añadido
- **Nuevo KPI "Pdte. Comprobación"** en el dashboard: contabiliza los jobs AS400 en estado `PDTE COMPROBACIÓN`, para que el operador vea de un vistazo cuántos backups AS400 están a la espera de revisión manual del log ese día.
- A diferencia de la v7.0.0 (donde estos jobs quedaban excluidos de todos los KPIs, incluido el total), en v8.0.0 **sí se contabilizan en el total "Jobs hoy"** (por decisión de negocio: son ejecuciones reales del día, solo que aún sin validar). Siguen excluidos de Éxitos/Avisos/Errores/En curso hasta que se confirme su resultado real.
- Nuevo valor `"as400-pending"` en el tipo `DashboardKpiFilter` (`types/ui.ts`), permitiendo filtrar la tabla al hacer clic en el nuevo KPI, igual que el resto de tarjetas.

##### 🎨 UI
- Ajuste de rejilla de KPIs en escritorio (`styles.css`): `.kpis` pasa de `repeat(5, 1fr)` a `repeat(6, 1fr)` para acomodar el nuevo KPI en una sola fila.
- Ajuste en vista móvil (`mobile.css`): eliminada la regla `.kpis .kpi-card:nth-child(5) { grid-column: 1 / -1 }`, que forzaba a la 5ª tarjeta a ocupar la fila completa cuando sobraba en una rejilla de 2 columnas con 5 elementos. Con 6 tarjetas, la rejilla de 2 columnas encaja de forma natural en 3 filas sin necesidad de ese ajuste.

##### 🔧 Interno
- Cambios principales en:
  - `src/App.tsx` (`hasManualOverrideFor`, `applyAs400PendingReview`, `computeB2Kpis`, `dashboardRows`, nuevo bloque `<Kpi>` "Pdte. Comprobación").
  - `src/types/ui.ts` (`DashboardKpiFilter` incluye `"as400-pending"`).
  - `src/styles.css` (rejilla `.kpis` a 6 columnas).
  - `src/mobile.css` (eliminada regla `nth-child(5)` obsoleta).
- Descartada una hipótesis intermedia que modificaba `server.js` para forzar `status: 'pending'` en los 4 jobs AS400 desde el backend; se revirtió por interferir con la lógica ya existente en frontend (`applyAs400PendingReview`), que resultó ser el punto correcto de intervención.

##### ✅ Cierres
- Pendiente conocido de v7.0.0 ("Revisar si PDTE COMPROBACIÓN debe reflejarse también en HistoryTab.tsx/ExecutionsTab.tsx") sigue abierto, no auditado en esta sesión.
- Pendiente conocido de v7.0.0 ("dar un color/badge propio a PDTE COMPROBACIÓN en styles.css") sigue abierto; el KPI nuevo usa color propio (#a78bfa), pero el badge de estado en la tabla continúa con el estilo neutro `unknown`.

#### [7.0.0] - 2026-08-03

##### 🚀 Versión mayor
- Sesión de estabilización del bloque AS400 tras la unificación de nombres de jobs (Backup SD/PR/RR/SDB-TGT → Backup AS400 SD/PR/RR/SDB-TGT).
- Cierre de 6 incidencias encadenadas detectadas y corregidas en cascada durante la validación en producción.

##### 🐛 Corregido
- **Filtro VDC vacío**: el filtro de categoría VDC exigía literalmente la palabra "veeam" en el nombre del job, por lo que jobs como "VDC OneDrive" no se detectaban y quedaban erróneamente clasificados dentro de AS400.
- Ahora el filtro reconoce "vdc" en el nombre, y el filtro AS400 excluye explícitamente "vdc" en su fallback.
- **Codificación rota (acentos e iconos)**: JobTable.tsx sufría una doble codificación UTF-8 → Latin1 → UTF-8, mostrando textos tipo DuraciÃ³n y el icono de log corrupto.
- Revertida la doble codificación en cabeceras de tabla, tooltips y el icono 📋, preservando BOM/CRLF del archivo.
- **Colores del modal LOG BACKUP perdidos**: tras unificar los nombres de jobs AS400, getAs400LogColor dejó de reconocer "Backup AS400 SD/PR/RR" (buscaba el patrón antiguo sin "AS400"), mostrando todos los logs en gris.
- Añadidas las variantes con "as400" intercalado; colores restaurados (SD verde, PR rojo, RR oliva, SDB/TGT azul).
- **Exclusión de fin de semana no aplicaba con los nombres nuevos**: isBackupPrRrRow solo reconocía "backup pr"/"backup rr" exactos; tras el renombrado a "Backup AS400 PR/RR" dejaban de excluirse en sábado/domingo.
- Además, el cálculo de fin de semana usaba la fecha del sistema (new Date()) en vez de la ventana operacional mostrada, por lo que el filtro no aplicaba si se consultaba en un día distinto al de la ventana (p. ej. lunes viendo la ventana del domingo).
- Corregido en dos pasos: se añadieron los nombres nuevos a isBackupPrRrRow, y el cálculo de fin de semana pasa a basarse en windowStart (la ventana mostrada), no en el reloj del sistema.
- **Duplicación de jobs AS400 ("Backup SD"/"Backup SDB/TGT" fantasma)**: el catálogo obligatorio forcedAs400Jobs en server.js seguía con los 4 nombres antiguos, sin actualizar tras la unificación de as400Rules. Esto generaba una segunda fila "Pendiente recepción" duplicada para SD y SDB/TGT, inflando el KPI "En curso" y descuadrando "Éxitos".
- Actualizado forcedAs400Jobs a los 4 nombres unificados ("Backup AS400 SD/PR/RR/SDB-TGT"). KPIs validados en producción tras el fix (En curso: 0, Éxitos: 58).
- Refactor menor en buildRefreshPayloadForWindow (server.js): extracción de vdcRules/barracudaRules/as400Rules a constantes, y se fuerza explícitamente source/category/type en las filas VDC, Barracuda y AS400 tras aplicar el override manual, para mayor consistencia de categorización.

##### ✨ Añadido
- **Nuevo estado "PDTE COMPROBACIÓN" para jobs AS400**: los backups AS400 requieren siempre revisión manual del log antes de darse por buenos. Ahora, si un job AS400 llega marcado automáticamente como SUCCESS (correo recibido sin errores/avisos detectados) pero el operador aún no ha revisado el log, se muestra como **PDTE COMPROBACIÓN** en lugar de SUCCESS.
- Excluido de todos los KPIs (Total, Éxitos, Avisos, Errores, En curso), igual que los jobs NO-RUN.
- El job permanece visible en la tabla para que el operador pueda entrar a "Editar", revisar el log y fijar manualmente el estado real.
- En cuanto existe un manualOverride guardado para el job, se respeta siempre la decisión del operador y deja de mostrarse como pendiente.

##### 🔧 Interno
- Cambios principales en:
- src/App.tsx (filtro de categorías, getAs400LogColor, isBackupPrRrRow, detectIsAs400Job, computeB2Kpis, dashboardRows, nuevas funciones applyAs400PendingReview/hasManualOverrideFor/isAs400PendingReviewRow).
- src/components/JobTable.tsx (corrección de codificación).
- server.js (forcedAs400Jobs, refactor de reglas VDC/Barracuda/AS400, log de diagnóstico [REFRESH:ROWS]).
- Añadido log de diagnóstico console.log('[REFRESH:ROWS]', ...) en cada refresco, con contadores de reglas y filas por fuente (VDC, Barracuda, AS400, SQL, emails) para facilitar futura depuración.

##### ⚠️ Pendiente conocido
- Revisar si "PDTE COMPROBACIÓN" debe reflejarse también en HistoryTab.tsx/ExecutionsTab.tsx (pendiente de auditoría, no incluidos en esta sesión).
- Valorar dar un color/badge propio a "PDTE COMPROBACIÓN" en styles.css (actualmente usa el estilo neutro unknown).
- Log de diagnóstico [REFRESH:ROWS] queda activo en producción; valorar quitarlo o pasarlo a un nivel de log más silencioso si genera demasiado ruido.

#### [5.1.0] - 2026-06-30

##### ✨ Añadido
- B-2.2: Porcentaje real de progreso en jobs SQL/Veeam.
- Cuando Veeam expone processed_size / total_size, el detalle muestra En ejecución (xx%).
- Cuando aún no hay tamaño reportado, el detalle queda como En ejecución.

##### 🔧 Interno
- electron/modules/sql.cjs: cálculo de progressPct ya consolidado en query principal.
- electron/modules/engine.cjs:
- pct se calcula al inicio de buildRow.
- Se propaga progress y progressPct al row final.
- Sin cambios en server.js para B-2.2 (ya soportaba progress desde v5.0.0).
- Sin cambios en frontend ni en correo (consumen detail ya enriquecido).

##### ✅ Cierres
- Pendiente menor de v5.0.0 sobre porcentaje queda cerrado

#### [5.0.0] - 2026-06-29

##### ✨ Añadido / Mejorado
- B-2: Unificación funcional de estados running + pending como **EN CURSO**.
- El dashboard deja de mostrar estados técnicos RUNNING / PENDING al usuario.
- El estado visible pasa a ser **EN CURSO** para jobs en ejecución o pendientes técnicos.
- B-2.1: Detalle inteligente por tipo de fuente:
- Jobs SQL/Veeam en curso se muestran como **En ejecución**.
- Jobs por email/AS400/Barracuda/VDC pendientes se muestran como **Pendiente recepción**.
- Jobs NO-RUN se muestran como **Sin ejecución** y quedan fuera de KPIs/NOK.
- El filtro NOK queda restringido a incidencias reales: WARNING / ERROR.
- KPIs ajustados para contar **EN CURSO** como running + pending técnico.
- Correo diario alineado con el nuevo modelo de estados:
- RUNNING/PENDING técnico → **EN CURSO**
- NO-RUN fuera de KPIs
- banner rojo solo con WARNING / ERROR
- Export JSON móvil enriquecido con:
- status global
- raw_status
- detail

##### 🖥️ UI / Logs
- UI-1 cerrado: iconos de log visibles y operativos para jobs por email:
- AS400
- Veeam Data Cloud
- Barracuda
- UI-2 cerrado: mejora visual del formato de logs AS400 en el modal **LOG BACKUP**.
- Colores AS400 aplicados por tipo de job:
- Backup SD → verde #00FF00
- Backup PR → rojo #F01818
- Backup RR → amarillo #A0A000
- Backup SDB/TGT → azul #7890F0
- UI-3 cerrado: limpieza visual de logs Barracuda/VDC:
- eliminado footer comercial de Barracuda
- eliminado bloque VDC Please view your backup logs... / View logs / N
- Modal de logs renombrado a **LOG BACKUP**.
- Validación visual OK en https://dashboard tras refresco/caché.

##### 🐛 Corregido
- Jobs SQL/Veeam que ya existen en BBDD no muestran ya **Pendiente ejecución**.
- El detalle para jobs SQL/Veeam pasa a ser **En ejecución** cuando están en curso.
- El componente JobTable deja de pintar estados técnicos y usa etiquetas visibles normalizadas.
- El correo deja de mostrar PENDING / RUNNING como texto técnico.
- Los jobs NO-RUN quedan fuera de KPIs y fuera del filtro NOK.

##### ⚠️ Pendiente conocido
- Recuperar y mostrar el porcentaje real de progreso en jobs SQL/Veeam cuando Veeam lo exponga en la fila disponible.
- Actualmente, si no llega porcentaje, el detalle queda como **En ejecución**.

##### 🔧 Interno
- Cambios principales en:
- server.js
- src/App.tsx
- src/components/JobTable.tsx
- electron/modules/emailBuilder.cjs
- electron/modules/graph.cjs
- Modelo B-2/B-2.1 consolidado como base para futura versión móvil/PWA.
- UI-1/UI-2/UI-3 quedan incorporados oficialmente al cierre funcional de v5.0.0.

#### v4.0.0 - 2026-06-28

##### Cerrado
- S-1 cerrado definitivamente: envío automático diario de informe a las 17:00 validado en producción.
- El correo automático usa el mismo snapshot que el dashboard, forzando refresh previo antes de generar el informe.
- KPIs del correo alineados con los KPIs visibles en https://dashboard.
- Asunto y título del informe basados en el día de inicio de la ventana operacional.
- Ventana operacional validada: 18:00 del día N a 17:59 del día N+1.
- Banner del informe ajustado a la regla funcional definitiva:
- success, running y pending se consideran backups correctos del día.
- warning, error y failed generan banner de errores.
- Confirmado en producción: mail automático recibido a las 17:00 con 6 jobs en ejecución, banner verde correcto, asunto/título correctos y KPIs coherentes con dashboard.

##### Mejoras
- Mejora de trazabilidad en logs del envío diario.
- Refuerzo de consistencia entre backend, dashboard y correo.
- Preparación mantenida para autenticación Entra ID sin activar aún el login productivo por Entra.

##### Notas
- logs/ queda como carpeta runtime local y no debe subirse al repositorio.

#### [3.2] - 2026-06-26

##### ✨ Añadido
- 🔐 **S-2: Autenticación de API mediante BM_AUTH_TOKEN**
- Todas las rutas /api/* quedan protegidas cuando BM_AUTH_TOKEN está definido.
- El backend devuelve 401 / No autorizado si no se envía token.
- El frontend envía el token mediante header Authorization: Bearer .
- Nuevo componente TokenGate para introducir el token desde el navegador.
- El token se guarda localmente en localStorage con clave bm.authToken.
- La UI detecta respuestas 401 y vuelve a mostrar el panel de acceso.

##### 🐛 Corregido
- **Backup Copy de Veeam ya no aparece duplicado** cuando existen fila parent y fila child.
- El dashboard conserva el nombre largo real de la sesión de Veeam.
- Ejemplo: BackupCopy\JobOrigen.
- Se evita mostrar simultáneamente el parent y el child como dos jobs distintos.
- **S-4 validado:** el botón Planificador descarga correctamente el Excel de próximos 30 días en modo web.

##### 🔧 Interno
- src/utils/api.ts centraliza el envío del token Bearer y detecta 401.
- Nuevo src/components/TokenGate.tsx.
- src/App.tsx integra TokenGate y escucha el evento bm:unauthorized.
- electron/modules/engine.cjs ajustado para colapsar duplicados de Backup Copy mostrando el nombre largo.

#### [3.1] - 2026-06-26

##### ✨ Mejorado
- B-1.1: Persistencia y migración automática de comentarios manuales con timestamp.
- validateConfigInput añade automáticamente timestamp a cualquier override sin fecha al guardar.
- loadConfig migra en memoria los overrides antiguos para que dejen de ignorarse por la limpieza por ventana.
- Compatibilidad con campos legacy: updatedAt, updated, modifiedAt, createdAt, ts, date, manualAt.
- Compatibilidad con overrides legacy guardados como string plano: se convierten a objeto { comment, timestamp }.

##### 🐛 Corregido
- Comentarios manuales antiguos se ignoraban para siempre tras la limpieza por ventana de v3.0.
- Tras este fix, los comentarios manuales se respetan dentro de su ventana operacional y se descartan correctamente al cambiar de ventana.

##### 🔧 Interno
- No se modifica server.js (la limpieza por ventana ya respetaba timestamp desde v3.0).
- No se modifica el frontend (ya guardaba timestamp al editar comentario).
- Cambios localizados en electron/modules/config.cjs.

#### [3.0] - 2026-06-25

##### 🚀 Versión mayor
- Consolidación de BackupMonitor como herramienta estable de monitorización.
- Cierre del bloque principal de monitorización multi-fuente: Veeam SQL, Veeam Data Cloud, Barracuda y AS400.

##### ✨ Añadido / Mejorado
- Limpieza de estado y comentarios por ventana operacional.
- Los jobs sin evidencia real de ejecución/recepción dentro de la ventana pasan a pending.
- Se evita arrastrar estados y comentarios de ventanas anteriores.
- nextRun ya no se usa como evidencia de ejecución real.
- Mejora visual de KPI del dashboard.
- Fondos suavemente tintados por color de estado.
- Números y bordes más visibles.
- Mejor lectura visual de éxitos, avisos, errores y jobs en curso.
- Email diario consolidado.
- Diseño profesional unificado.
- Tabla de detalle con anchos fijos.
- Asunto normalizado: Informe Backup DD DE MES DE AAAA.

##### 🐛 Corregido
- Restaurado HTTPS en puerto 443 tras reponer el certificado DASHBOARD.pfx.
- Corregido fallback involuntario a HTTP 3100 cuando faltaba el PFX.
- Corregida limpieza de comentarios antiguos en jobs por email.
- Corregido uso incorrecto de nextRun para determinar si un job pertenecía a la ventana actual.

##### 🔧 Interno
- server.js mantiene la limpieza en buildRefreshPayloadForWindow.
- La evidencia real de ejecución se basa en lastRun, start, end, lastEmailDate, emailReceivedDate o receivedDateTime.
- Validado en DASHBOARD con POST /api/refresh.

#### [2.3] - 2026-06-24

##### ✨ Mejorado
- 🎨 **S-3: Cabecera del correo simplificada**
- Eliminado círculo del % de éxito de la cabecera
- KPIs (TOTAL/ÉXITOS/AVISOS/ERRORES/EN CURSO) intactos
- 📏 **Tabla de detalle del correo con anchos fijos**
- Tabla principal: 820px → 1000px
- Estado: 90px
- Job: 280px (antes flexible y se rompía en varias líneas)
- Fuente: 110px
- Inicio: 140px
- Dur.: 80px (texto "4m 27s" en 1 línea)
- Detalle: 300px (texto "Correo Recibido, revisar manualmente el log" en 1 línea)
- 🛡 table-layout:fixed para garantizar que Outlook respete los anchos

##### 🔧 Interno
- ✅ Builder HTML actualizado en ambos archivos (.cjs backend + .ts frontend)
- ✅ Coherencia visual entre botón Enviar y envío automático S-1

#### [2.2] - 2026-06-24

##### ✨ Añadido
- 📜 **B-1: Histórico de jobs por email (AS400, Barracuda, VDC)**
- Parser AS400 desde adjunto .txt → extrae arranque, finalización y código
- Parser Barracuda desde body del correo → extrae Start/End/Duration/Size/Items/Result
- VDC con status inferido del subject (Start/End no disponibles sin login)
- Procesamiento por lotes (8 en paralelo) para no saturar Graph
- 📊 **Modal Historial muestra "Inicio" (HH:MM:SS) y "Duración" (Xh Ym Zs)**
- 🛡 **Filtrado exacto del subject**: regex con bordes de palabra para evitar que jobs con nombre similar se mezclen (ej. "Backup SD" ya no captura "Backup SDB/TGT")

##### 🐛 Corregido
- 🐞 Duración AS400: ahora se calcula como end - start (tiempo de reloj real)
- Se ignora el campo "se utilizaron N segundos" del log (es CPU time)
- 🐞 Eliminada confusión entre jobs por prefijo de nombre en histórico
- 🐞 Backup SD ya no incluye ejecuciones de Backup SDB/TGT (eran 40 mezcladas, ahora 20 + 20 separadas)

##### 🔧 Interno
- ✅ Nueva función getMessageBody(cfg, messageId) para descargar body completo
- ✅ Nueva función detectRuleSource(rule) para tipar la regla (AS400/Barracuda/VDC)
- ✅ Parsers exportados desde graph.cjs para testing futuro
- ✅ Cada execution incluye parserSource y parsed (true/false) para diagnóstico

#### [2.1] - 2026-06-23

##### ✨ Añadido
- 📧 **S-1: Envío automático de informe diario a las 17:00**
- Scheduler robusto con control anti-duplicado (fichero marker persistente)
- Endpoint manual de prueba: POST /api/email/daily-report/test
- Health check ahora incluye dailyReportLastSent
- 🎨 **Diseño del correo automático unificado con el botón Enviar**
- Tema oscuro azulado (Backup Monitor Pro)
- KPIs grandes con colores (Total / Éxitos / Avisos / Errores / En curso)
- Banner verde "TODOS LOS BACKUPS DEL DÍA SON CORRECTOS" / rojo si hay incidencias
- % éxito en círculo (cabecera)
- Tabla de jobs con badges de estado y criticidad
- 📩 **Asunto unificado**: "Informe Backup DD DE MES DE AAAA"
- 👥 **Destinatarios configurables** vía variable de entorno BM_DAILY_REPORT_TO (soporta múltiples separados por ; o ,)
- 🔐 **Arranque HTTPS robusto** con logs claros, validación PFX y fallback HTTP

##### 🐛 Corregido
- 🐞 sendDailyReport ahora usa bodyHtml (firma correcta de sendGraphEmail)
- 🐞 Eliminada función duplicada sendDailyReport que usaba global.lastStatusData inexistente
- 🐞 SPA fallback con app.use() (evita errores path-to-regexp con app.get('*'))
- 🐞 Importación de emailBuilder movida de TypeScript (src/utils/emailBuilder.ts) a CommonJS (electron/modules/emailBuilder.cjs) para compatibilidad Node

##### 🔧 Interno / Infraestructura
- ✅ Builder HTML compartido y reutilizable (electron/modules/emailBuilder.cjs)
- ✅ Helpers integrados en backend: escapeHtml, safeLower, sourceLabel, formatLocal, formatDuration, computeKpis
- ✅ Logs [S-1] para trazabilidad del scheduler diario
- ✅ Variable BM_DAILY_REPORT_TO documentada en NSSM

#### [2.0.0] - 2026-06-20

##### ✨ Mejoras
- 🔒 Migración completa a HTTPS en entorno productivo (acceso seguro mediante certificado interno CA)
- 🌐 Servidor Express funcionando 24/7 como servicio Windows (NSSM)
- 🔁 Redirección automática HTTP → HTTPS

##### 🐛 Corregido
- 🐞 Jobs de Barracuda no visibles en "TODOS" durante fin de semana
→ causa: filtro por texto (includes("pr")  ("rr")) afectaba a "Barracuda" y "Sharepoint"
- 🐞 Filtro de fin de semana mejorado
→ ahora solo afecta a jobs SQL (Veeam PR/RR)
→ NO oculta jobs por email (Barracuda, VDC, AS400)
- 🐞 Error mac verify failure en HTTPS
→ causa: variables de entorno no cargadas en ejecución manual
→ validación correcta del PFX y passphrase
- 🐞 Problemas de routing en Express
→ /api/refresh devolvía index.html
→ orden de middlewares corregido
- 🐞 Error en fallback de rutas (path-to-regexp)
→ sustituido app.get('*') por app.use(...)

##### 🔧 Interno / Infraestructura
- ✅ Validación completa del flujo:
- Frontend ↔ API ↔ Motor
- ✅ Separación correcta entre rows y fullRows
- ✅ Sistema de refresco y cache estabilizado
- ✅ Logs y diagnóstico mejorados

#### [1.0.2] - 2026-06-20

##### Añadido
- 📊 Porcentaje de progreso en jobs en ejecución (En ejecución (X%))
- 🧩 Descripción específica para Backup Configuration Job en ejecución

##### Corregido
- 🐛 Jobs en ejecución se mostraban como SUCCESS en algunos casos (B-3)
- 🐛 Duplicado de jobs: se mostraba el job padre junto al Backup Copy hijo (B-4)
- 📉 KPI "En curso" y "Éxitos" inconsistentes debido a clasificación incorrecta

#### [1.0.1] - 2026-06-18

##### Corregido
- 🐛 Botón "Planificador" daba error en modo web (scheduleExcel.ts llamaba directamente a window.api)

#### [1.0.0] - 2026-06-18

Primera versión estable en producción 24/7 como aplicación web multi-usuario.
