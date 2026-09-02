### Changelog

## [14.0.0] - 2026-09-02

### 🚀 VERSIÓN MAYOR

- Consolidado el nuevo criterio de profundidad del Historial de Ejecuciones según el origen del backup.
- Los históricos alimentados mediante correo, correspondientes a VDC, Barracuda y AS400, muestran una ventana móvil de 30 fechas.
- Los jobs de Veeam Backup & Replication mantienen una profundidad independiente de 90 ejecuciones.

### 🐛 CORREGIDO

- Corregida la primera visualización incompleta del historial de determinados backups alimentados mediante correo.
- En algunos jobs AS400, y potencialmente también en VDC y Barracuda, determinadas ejecuciones reales podían aparecer inicialmente como SIN EJECUCIÓN y mostrarse correctamente solo después de actualizar la página o pulsar F5.
- La construcción del historial espera ahora a completar el procesamiento y la deduplicación de las ejecuciones antes de generar las filas SIN EJECUCIÓN.
- Corregida la deduplicación de ejecuciones por ventana operacional para evitar que una ejecución real quede desplazada o sustituida por una fila sintética durante la primera apertura del historial.
- Validada en producción la primera apertura de Backup AS400 RR, incluyendo correctamente las ejecuciones del 26/08/2026 y del 14/08/2026 sin necesidad de actualizar.
- Validada también la primera apertura de históricos VDC y Barracuda con 30 fechas.
- Confirmado que el cambio no afecta a los históricos de Veeam Backup & Replication, que continúan mostrando 90 ejecuciones.

### 🔧 INTERNO

- Actualizada la lógica de `electron/modules/graph.cjs` para deduplicar las ejecuciones de correo por ventana operacional antes de construir el histórico definitivo.
- Se mantiene la asignación de las ejecuciones AS400 a su fecha operativa correcta cuando comienzan antes de medianoche y terminan durante la madrugada del día siguiente.
- Se conserva una única ejecución representativa por fecha o ventana operacional antes de ordenar, rellenar los días sin ejecución y limitar el resultado.
- Cambio principal incorporado en el commit `4b936bc`.

### ✅ VALIDADO

- AS400: 30 fechas y primera visualización correcta.
- VDC: 30 fechas y primera visualización correcta.
- Barracuda: 30 fechas y primera visualización correcta.
- Veeam Backup & Replication: 90 ejecuciones, sin regresiones.
- Los días sin ejecución de Barracuda Exchange se mantienen como datos potencialmente válidos, debido a que este backup puede no ejecutarse en determinadas ventanas de 24 horas.

## [13.0.0] - 2026-08-29

### AÑADIDO
- Columna **Fin** en el Historial de Ejecuciones (antes solo mostraba Fecha, Inicio, Duración y Estado), disponible para todos los orígenes (Veeam, VDC, Barracuda, AS400).
- VDC (Veeam Data Cloud): horario de inicio **fijo** por tipo de política, calculado sobre la ventana operacional (18:00), ya que el correo de Veeam Data Cloud nunca informa de la hora de inicio real:
  - VDC Exchange → 01:30
  - VDC OneDrive → 02:30
  - VDC Sharepoint y Teams → 22:00 (día anterior de la ventana)
- Historial de Ejecuciones: objetivo de mostrar hasta 30 ejecuciones para jobs VDC, Barracuda y AS400 (antes limitado a 200 sin garantía real de cobertura de días).

### CORREGIDO
- Historial de Ejecuciones: la **Duración** aparecía vacía ("—") en múltiples casos porque el fallback de cálculo (Fin − Inicio) no se disparaba cuando el backend enviaba el campo `duration` como cadena vacía (`""`) en vez de `null`/`undefined`. Corregido para detectar explícitamente ambos casos.
- Historial de Ejecuciones: anchos de columna incorrectos y margen lateral inconsistente. Causa: `table-layout: fixed` con anchos de `colgroup` en píxeles dentro de un contenedor más ancho que la suma de columnas, lo que volcaba todo el espacio sobrante en la última columna (Estado). Corregido usando anchos en porcentaje y panel centrado con ancho máximo fijo.
- VDC: el cálculo de Fin/Estado partía siempre de `receivedDateTime` (hora de recepción del correo) en vez de la hora real de finalización, porque `parseVdcBody` se invocaba sin pasarle el cuerpo del correo. Corregido pasando el cuerpo real al parser.
- VDC: Veeam Data Cloud cambió el formato del **asunto** de sus correos el 19/08/2026 (de `Backup run of the policy "X"` a `"X" policy run`). La regla de coincidencia exigía el asunto como string literal con un orden fijo de palabras, por lo que todo el histórico anterior al cambio se descartaba en silencio aunque fueran backups reales. Corregido comparando por palabras sueltas (sin exigir orden), válido para ambos formatos.
- VDC: el patrón de fecha de finalización solo reconocía el formato nuevo de correo (`"...on August 28, 2026 at 00:57:03 UTC"`). El formato real de la ejecución automática/programada (`"...finished on Tue Aug 11 2026 23:45:01 UTC..."`, con día de la semana) no se reconocía, dejando Inicio = Fin y Duración vacía. Corregido para reconocer ambos formatos.
- VDC: el estado de la ejecución se marcaba incorrectamente como **ERROR** en correos que en realidad eran WARNING. Causa: el disclaimer legal presente en todos los correos de Veeam Data Cloud ("Warning and error messages are often informational...") contiene la palabra "error", y al no coincidir el texto exacto esperado (`"completed with warnings"` en plural) con el real (`"completed with warning"` en singular), el código caía en un fallback que detectaba esa palabra suelta del disclaimer. Corregido con detección por frase completa (con "s" opcional) y eliminación del fallback de palabra suelta.
- Historial AS400/Barracuda: la deduplicación de correos por día podía descartar, antes de intentar parsear, el único correo del día que sí contenía un adjunto/log válido (caso real detectado: correo "LOG Backup SD" recibido antes que el correo con el log parseable del mismo día). Corregido para conservar todos los correos candidatos de cada día y dejar que la deduplicación posterior elija el que sí se pudo parsear.
- VDC: un correo real del 16/08/2026 seguía mostrando Inicio = Fin a pesar de que el patrón de fecha era correcto, porque el cuerpo completo del mensaje llegaba vacío en la petición a Microsoft Graph. Corregido con un fallback: si no se puede extraer la fecha desde el cuerpo completo, se reintenta contra el `bodyPreview` (ya disponible sin petición adicional).
- Historial de Ejecuciones: la deduplicación "primer correo del día" para Barracuda agrupaba por día calendario natural, mezclando correos de ventanas operacionales distintas cuando la ejecución o el correo llegaban pasada la medianoche. Corregido agrupando por ventana operacional real (18:00 → 18:00).
- Historial de Ejecuciones: el relleno de ventanas sin ejecución ("SIN EJECUCIÓN") calculaba las ventanas candidatas a partir de la hora variable del momento de la consulta, lo que podía generar una fila duplicada (una real y otra "SIN EJECUCIÓN") para el mismo día. Corregido anclando el cálculo a las 18:00:00 exactas.

### AÑADIDO (continuación)
- Historial de Ejecuciones: relleno automático con filas "SIN EJECUCIÓN" para VDC, Barracuda y AS400, de forma que el histórico siempre muestre las últimas 30 ventanas operacionales, aunque no haya habido ejecución real en alguna de ellas.

### PENDIENTE CONOCIDO
- Verificar periódicamente que VDC, Barracuda y AS400 mantienen las 30 ejecuciones objetivo en el Historial (o el máximo real disponible si algún job lleva menos de 90 días activo).
- Unificar formato visual (colores/títulos) del propio modal de Historial de versiones para versiones anteriores a la v10.0.0 (en progreso).

## [12.0.0] - 2026-08-17

### AÑADIDO
- Panel de filtros (6 botones + descripción) reubicado en vista móvil: ahora aparece entre el texto "Ventana XX/XX/XXXX" y el bloque de KPIs, en vez de tras ellos.
- Textos operativos de instrucciones para el Guardián al pulsar los KPIs "Avisos", "Errores" y "Pdte. Comprobación":
  - Avisos → "Backups con estado Warning" + pasos según tipo de backup (Veeam/VDC/Barracuda).
  - Errores → "Backups con estado fallido" + pasos según tipo de backup (Veeam/VDC/Barracuda).
  - Pdte. Comprobación → "Backups AS400 pendientes de confirmar, revisando su log" + procedimiento de revisión de log y marcado manual como Success.

## [11.0.0] - 2026-08-17

### AÑADIDO
- Botón circular de actualización (⟳) en la topbar móvil, entre "Actualizado a HH:mm" y el badge de login Entra ID.
- Separación visual de los KPIs en dos bloques para guardias: "Sin intervención del Guardián" (Jobs hoy, Éxitos, En curso) y "Requieren intervención" (Avisos, Errores, Pdte. Comprobación).

### CAMBIADO
- Formato de "Actualizado" en móvil: se elimina el campo de segundos, mostrando solo HH:mm.
- Textos descriptivos de los filtros (Todos, Veeam Backup, VDC, Barracuda, AS400, NOK) ampliados y clarificados para guardias.
- Alineación del título "SITUACIÓN BACKUP DEL DÍA..." corregida para quedar exactamente debajo de "Backup Monitor Pro".

### ELIMINADO
- Eliminada en vista móvil la fila de Buscar/Actualizar/Enviar/Exportar/Planificador de la toolbar (el refresco pasa a la topbar).

### CORREGIDO
- Corregido el bloqueo de scroll en navegadores móviles (Edge/Chrome Android): `.app` usaba `height: 100vh` fijo, lo que ocultaba los botones "Ver log"/"Editar" del último job bajo la barra de navegación del móvil. Sustituido por `height: auto` + `min-height: 100dvh` en `.app`, y añadido `padding-bottom` de colchón en `.content`.

## [10.0.0] - 2026-08-13

### AÑADIDO
- Sesión de correcciones de fiabilidad en KPIs y en el Historial de ejecuciones, detectadas tras el cierre de v9.0.0.

### CORREGIDO
- **KPIs duplicados en Dashboard y correo diario (17:00) para jobs relanzados**: cuando un job fallaba (o tenía avisos) y se relanzaba quedando actualmente EN CURSO dentro de la misma ventana operacional, `applyRelaunchLogic` (en `electron/modules/engine.cjs`) devolvía una fila por cada estado distinto detectado entre los reintentos (p. ej. `failed` + `running`, o `warning` + `running`), por lo que el job se contabilizaba simultáneamente en Errores/Avisos y en En Curso. Se añadió una comprobación previa: si existe alguna ejecución `running`/`pending` dentro del grupo de reintentos, solo se conserva esa ejecución (la más reciente), ya que el resultado final aún no se conoce. Los casos `hasSuccess` y `allFailed` (ya existentes) no se modificaron. La corrección afecta tanto al Dashboard como al correo diario, ya que ambos consumen el mismo snapshot (`lastPayload`).
- **Filas fantasma en el Historial de ejecuciones AS400**: algunos jobs AS400 (detectado en RR, aunque el mecanismo aplica a cualquiera) reciben más de un correo con idéntico asunto y remitente (`Log Backup RR` / `QSYSOPR.rr@UCI.COM`) para la misma ejecución real; uno de ellos trae el log completo y parseable, y otro no, generando una fila adicional en el Historial con INICIO = hora de recepción del correo y DURACIÓN vacía ("—"), justo coincidiendo con la hora de finalización real del job.

## [9.0.0] - 2026-08-11

### AÑADIDO
- Cálculo de INICIO/FIN/DURACIÓN reales para los tres tipos de backup por correo (Barracuda, VDC y AS400):
  - Barracuda: INICIO/FIN/DURACIÓN reales desde el log del correo mediante `evaluateBarracudaRule`, `parseBarracudaBody` y `formatDurationMs`.
  - VDC: INICIO mediante horarios fijos por tipo de backup ajustados a la ventana operacional; FIN obtenido desde el cuerpo del correo. Solo se considera la primera ejecución cronológica de cada ventana operacional para cada job VDC.
  - AS400: INICIO/FIN/DURACIÓN reales desde el log adjunto; corregidos el reprocesado de adjuntos y la colisión de subjects entre SD y SDB/TGT.

### CORREGIDO
- Documentadas reglas de housekeeping de versión: el modal de historial carga `public/CHANGELOG.md` en runtime, por lo que cada modificación de `CHANGELOG.md` debe copiarse también a `public/CHANGELOG.md` antes de commitear o desplegar; la versión mostrada en badge y modal proviene de `APP_VERSION` en `src/version.ts` y debe actualizarse manualmente en cada cambio de versión; y antes de insertar una nueva entrada en `CHANGELOG.md` debe verificarse cuál es la versión más reciente existente para mantener el orden cronológico correcto.

## [7.0.0] - 2026-08-03

### AÑADIDO
- Nuevo estado "PDTE COMPROBACIÓN" para jobs AS400: los backups AS400 requieren siempre revisión manual del log antes de darse por buenos. Si un job AS400 llega marcado automáticamente como SUCCESS (correo recibido sin errores/avisos detectados) pero el operador aún no ha revisado el log, se muestra como PDTE COMPROBACIÓN en lugar de SUCCESS. Excluido de todos los KPIs (Total, Éxitos, Avisos, Errores, En curso), igual que los jobs NO-RUN. El job permanece visible en la tabla para que el operador pueda entrar a "Editar", revisar el log y fijar manualmente el estado real. En cuanto existe un `manualOverride` guardado para el job, se respeta siempre la decisión del operador y deja de mostrarse como pendiente.

### CORREGIDO
- Sesión de estabilización del bloque AS400 tras la unificación de nombres de jobs (Backup SD/PR/RR/SDB-TGT → Backup AS400 SD/PR/RR/SDB-TGT). Cierre de 6 incidencias encadenadas detectadas y corregidas en cascada durante la validación en producción.
- **Filtro VDC vacío**: el filtro de categoría VDC exigía literalmente la palabra "veeam" en el nombre del job, por lo que jobs como "VDC OneDrive" no se detectaban y quedaban erróneamente clasificados dentro de AS400. Ahora el filtro reconoce "vdc" en el nombre, y el filtro AS400 excluye explícitamente "vdc" en su fallback.
- **Codificación rota (acentos e iconos)**: `JobTable.tsx` sufría una doble codificación UTF-8 → Latin1 → UTF-8, mostrando textos tipo "DuraciÃ³n" y el icono de log corrupto. Revertida la doble codificación en cabeceras de tabla, tooltips y el icono 📋, preservando BOM/CRLF del archivo.
- **Colores del modal LOG BACKUP perdidos**: tras unificar los nombres de jobs AS400, `getAs400LogColor` dejó de reconocer "Backup AS400 SD/PR/RR" (buscaba el patrón antiguo sin "AS400"), mostrando todos los logs en gris. Añadidas las variantes con "as400" intercalado; colores restaurados (SD verde, PR rojo, RR oliva, SDB/TGT azul).
- **Exclusión de fin de semana no aplicaba con los nombres nuevos**: `isBackupPrRrRow` solo reconocía "backup pr"/"backup rr" exactos; tras el renombrado a "Backup AS400 PR/RR" dejaban de excluirse en sábado/domingo. Además, el cálculo de fin de semana usaba la fecha del sistema (`new Date()`) en vez de la ventana operacional mostrada, por lo que el filtro no aplicaba si se consultaba en un día distinto al de la ventana (p. ej. lunes viendo la ventana del domingo). Corregido en dos pasos: se añadieron los nombres nuevos a `isBackupPrRrRow`, y el cálculo de fin de semana pasa a basarse en `windowStart` (la ventana mostrada), no en el reloj del sistema.
- **Duplicación de jobs AS400 ("Backup SD"/"Backup SDB/TGT" fantasma)**: el catálogo obligatorio `forcedAs400Jobs` en `server.js` seguía con los 4 nombres antiguos, sin actualizar tras la unificación de `as400Rules`. Esto generaba una segunda fila "Pendiente recepción" duplicada para SD y SDB/TGT, inflando el KPI "En curso" y descuadrando "Éxitos". Actualizado `forcedAs400Jobs` a los 4 nombres unificados ("Backup AS400 SD/PR/RR/SDB-TGT"). KPIs validados en producción tras el fix (En curso: 0, Éxitos: 58).
- Refactor menor en `buildRefreshPayloadForWindow` (`server.js`): extracción de `vdcRules`/`barracudaRules`/`as400Rules` a constantes, y se fuerza explícitamente `source`/`category`/`type` en las filas VDC, Barracuda y AS400 tras aplicar el override manual, para mayor consistencia de categorización.

### PENDIENTE CONOCIDO
- Revisar si "PDTE COMPROBACIÓN" debe reflejarse también en `HistoryTab.tsx`/`ExecutionsTab.tsx` (pendiente de auditoría, no incluido en esta sesión).
- Valorar dar un color/badge propio a "PDTE COMPROBACIÓN" en `styles.css` (actualmente usa el estilo neutro `unknown`).
- Log de diagnóstico `[REFRESH:ROWS]` queda activo en producción; valorar quitarlo o pasarlo a un nivel de log más silencioso si genera demasiado ruido.

## [5.1.0] - 2026-06-30

### AÑADIDO
- B-2.2: Porcentaje real de progreso en jobs SQL/Veeam. Cuando Veeam expone `processed_size` / `total_size`, el detalle muestra "En ejecución (xx%)". Cuando aún no hay tamaño reportado, el detalle queda como "En ejecución".

### CORREGIDO
- Pendiente menor de v5.0.0 sobre porcentaje queda cerrado.

## [5.0.0] - 2026-06-29

### AÑADIDO
- B-2: Unificación funcional de estados `running` + `pending` como **EN CURSO**. El dashboard deja de mostrar estados técnicos RUNNING / PENDING al usuario.
- B-2.1: Detalle inteligente por tipo de fuente:
  - Jobs SQL/Veeam en curso se muestran como "En ejecución".
  - Jobs por email/AS400/Barracuda/VDC pendientes se muestran como "Pendiente recepción".
  - Jobs NO-RUN se muestran como "Sin ejecución" y quedan fuera de KPIs/NOK.
- El filtro NOK queda restringido a incidencias reales: WARNING / ERROR. KPIs ajustados para contar EN CURSO como running + pending técnico.
- Correo diario alineado con el nuevo modelo de estados (RUNNING/PENDING técnico → EN CURSO; NO-RUN fuera de KPIs; banner rojo solo con WARNING / ERROR).
- Export JSON móvil enriquecido con status global, raw_status y detail.
- UI-1: iconos de log visibles y operativos para jobs por email (AS400, Veeam Data Cloud, Barracuda).
- UI-2: mejora visual del formato de logs AS400 en el modal LOG BACKUP. Colores AS400 aplicados por tipo de job (Backup SD verde, Backup PR rojo, Backup RR amarillo, Backup SDB/TGT azul).
- UI-3: limpieza visual de logs Barracuda/VDC (eliminado footer comercial de Barracuda; eliminado bloque VDC "Please view your backup logs... / View logs / N"). Modal de logs renombrado a "LOG BACKUP".

### CORREGIDO
- Jobs SQL/Veeam que ya existen en BBDD no muestran ya "Pendiente ejecución"; el detalle pasa a ser "En ejecución" cuando están en curso.
- El componente `JobTable` deja de pintar estados técnicos y usa etiquetas visibles normalizadas.
- El correo deja de mostrar PENDING / RUNNING como texto técnico.
- Los jobs NO-RUN quedan fuera de KPIs y fuera del filtro NOK.

### PENDIENTE CONOCIDO
- Recuperar y mostrar el porcentaje real de progreso en jobs SQL/Veeam cuando Veeam lo exponga en la fila disponible. Actualmente, si no llega porcentaje, el detalle queda como "En ejecución".

## [4.0.0] - 2026-06-28

### AÑADIDO
- S-1 cerrado definitivamente: envío automático diario de informe a las 17:00 validado en producción. El correo automático usa el mismo snapshot que el dashboard, forzando refresh previo antes de generar el informe. KPIs del correo alineados con los KPIs visibles en producción. Asunto y título del informe basados en el día de inicio de la ventana operacional. Ventana operacional validada: 18:00 del día N a 17:59 del día N+1. Banner del informe ajustado a la regla funcional definitiva (success/running/pending = correcto; warning/error/failed = banner de errores). Confirmado en producción: mail automático recibido a las 17:00 con KPIs coherentes con dashboard.

### CAMBIADO
- Mejora de trazabilidad en logs del envío diario.
- Refuerzo de consistencia entre backend, dashboard y correo.
- Preparación mantenida para autenticación Entra ID sin activar aún el login productivo por Entra.

## [3.2.0] - 2026-06-26

### AÑADIDO
- S-2: Autenticación de API mediante `BM_AUTH_TOKEN`. Todas las rutas `/api/*` quedan protegidas cuando `BM_AUTH_TOKEN` está definido. El backend devuelve 401/No autorizado si no se envía token. El frontend envía el token mediante header `Authorization: Bearer`. Nuevo componente `TokenGate` para introducir el token desde el navegador; se guarda localmente en `localStorage` con clave `bm.authToken`. La UI detecta respuestas 401 y vuelve a mostrar el panel de acceso.

### CORREGIDO
- Backup Copy de Veeam ya no aparece duplicado cuando existen fila parent y fila child. El dashboard conserva el nombre largo real de la sesión de Veeam (ej. `BackupCopy\JobOrigen`), evitando mostrar simultáneamente el parent y el child como dos jobs distintos.
- S-4 validado: el botón Planificador descarga correctamente el Excel de próximos 30 días en modo web.

## [3.1.0] - 2026-06-26

### CAMBIADO
- B-1.1: Persistencia y migración automática de comentarios manuales con timestamp. `validateConfigInput` añade automáticamente timestamp a cualquier override sin fecha al guardar. `loadConfig` migra en memoria los overrides antiguos para que dejen de ignorarse por la limpieza por ventana. Compatibilidad con campos legacy (`updatedAt`, `updated`, `modifiedAt`, `createdAt`, `ts`, `date`, `manualAt`) y con overrides legacy guardados como string plano (se convierten a objeto `{ comment, timestamp }`).

### CORREGIDO
- Comentarios manuales antiguos se ignoraban para siempre tras la limpieza por ventana de v3.0.0. Tras este fix, los comentarios manuales se respetan dentro de su ventana operacional y se descartan correctamente al cambiar de ventana.

## [3.0.0] - 2026-06-25

### AÑADIDO
- Consolidación de BackupMonitor como herramienta estable de monitorización. Cierre del bloque principal de monitorización multi-fuente: Veeam SQL, Veeam Data Cloud, Barracuda y AS400.
- Limpieza de estado y comentarios por ventana operacional: los jobs sin evidencia real de ejecución/recepción dentro de la ventana pasan a pending. `nextRun` ya no se usa como evidencia de ejecución real.
- Mejora visual de KPI del dashboard: fondos suavemente tintados por color de estado, números y bordes más visibles.
- Email diario consolidado: diseño profesional unificado, tabla de detalle con anchos fijos, asunto normalizado "Informe Backup DD DE MES DE AAAA".

### CORREGIDO
- Restaurado HTTPS en puerto 443 tras reponer el certificado `DASHBOARD.pfx`.
- Corregido fallback involuntario a HTTP 3100 cuando faltaba el PFX.
- Corregida limpieza de comentarios antiguos en jobs por email.
- Corregido uso incorrecto de `nextRun` para determinar si un job pertenecía a la ventana actual.

## [2.3.0] - 2026-06-24

### CAMBIADO
- S-3: cabecera del correo simplificada. Eliminado círculo del % de éxito de la cabecera; KPIs (TOTAL/ÉXITOS/AVISOS/ERRORES/EN CURSO) intactos.
- Tabla de detalle del correo con anchos fijos (tabla principal 820px → 1000px; Estado 90px; Job 280px; Fuente 110px; Inicio 140px; Dur. 80px; Detalle 300px). `table-layout: fixed` para garantizar que Outlook respete los anchos.

## [2.2.0] - 2026-06-24

### AÑADIDO
- B-1: Histórico de jobs por email (AS400, Barracuda, VDC). Parser AS400 desde adjunto .txt (extrae arranque, finalización y código). Parser Barracuda desde el cuerpo del correo (extrae Start/End/Duration/Size/Items/Result). VDC con estado inferido del asunto (Start/End no disponibles sin login). Procesamiento por lotes (8 en paralelo) para no saturar Graph.
- Modal Historial muestra "Inicio" (HH:MM:SS) y "Duración" (Xh Ym Zs).
- Filtrado exacto del asunto: regex con bordes de palabra para evitar que jobs con nombre similar se mezclen (ej. "Backup SD" ya no captura "Backup SDB/TGT").

### CORREGIDO
- Duración AS400: ahora se calcula como end − start (tiempo de reloj real). Se ignora el campo "se utilizaron N segundos" del log (es tiempo de CPU).
- Eliminada confusión entre jobs por prefijo de nombre en histórico: "Backup SD" ya no incluye ejecuciones de "Backup SDB/TGT".

## [2.1.0] - 2026-06-23

### AÑADIDO
- S-1: envío automático de informe diario a las 17:00. Scheduler robusto con control anti-duplicado (fichero marker persistente). Endpoint manual de prueba `POST /api/email/daily-report/test`. Health check incluye `dailyReportLastSent`.
- Diseño del correo automático unificado con el botón Enviar: tema oscuro azulado, KPIs grandes con colores, banner verde/rojo según incidencias, % de éxito en círculo, tabla de jobs con badges de estado y criticidad.
- Asunto unificado "Informe Backup DD DE MES DE AAAA". Destinatarios configurables vía variable de entorno `BM_DAILY_REPORT_TO`. Arranque HTTPS robusto con logs claros, validación PFX y fallback HTTP.

### CORREGIDO
- `sendDailyReport` ahora usa `bodyHtml` (firma correcta de `sendGraphEmail`).
- Eliminada función duplicada `sendDailyReport` que usaba `global.lastStatusData` inexistente.
- SPA fallback con `app.use()` (evita errores path-to-regexp con `app.get('*')`).
- Importación de `emailBuilder` movida de TypeScript (`src/utils/emailBuilder.ts`) a CommonJS (`electron/modules/emailBuilder.cjs`) para compatibilidad Node.

## [2.0.0] - 2026-06-20

### CAMBIADO
- Migración completa a HTTPS en entorno productivo (acceso seguro mediante certificado interno CA). Servidor Express funcionando 24/7 como servicio Windows (NSSM). Redirección automática HTTP → HTTPS.

### CORREGIDO
- Jobs de Barracuda no visibles en "TODOS" durante fin de semana (causa: filtro por texto `includes("pr"|"rr")` afectaba a "Barracuda" y "Sharepoint"). Filtro de fin de semana mejorado para afectar solo a jobs SQL (Veeam PR/RR), sin ocultar jobs por email (Barracuda, VDC, AS400).
- Error "mac verify failure" en HTTPS (causa: variables de entorno no cargadas en ejecución manual); validación correcta del PFX y passphrase.
- Problemas de routing en Express: `/api/refresh` devolvía `index.html`; orden de middlewares corregido.
- Error en fallback de rutas (path-to-regexp): sustituido `app.get('*')` por `app.use(...)`.

## [1.0.2] - 2026-06-20

### AÑADIDO
- Porcentaje de progreso en jobs en ejecución ("En ejecución (X%)").
- Descripción específica para "Backup Configuration Job" en ejecución.

### CORREGIDO
- Jobs en ejecución se mostraban como SUCCESS en algunos casos (B-3).
- Duplicado de jobs: se mostraba el job padre junto al Backup Copy hijo (B-4).
- KPI "En curso" y "Éxitos" inconsistentes debido a clasificación incorrecta.

## [1.0.1] - 2026-06-18

### CORREGIDO
- Botón "Planificador" daba error en modo web (`scheduleExcel.ts` llamaba directamente a `window.api`).

## [1.0.0] - 2026-06-18

### AÑADIDO
- Primera versión estable en producción 24/7 como aplicación web multi-usuario.
