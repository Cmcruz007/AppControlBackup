# Changelog

## [5.0.0] - 2026-06-29

### ✨ Añadido / Mejorado

- B-2: Unificación funcional de estados `running` + `pending` como **EN CURSO**.
- El dashboard deja de mostrar estados técnicos `RUNNING` / `PENDING` al usuario.
- El estado visible pasa a ser **EN CURSO** para jobs en ejecución o pendientes técnicos.
- B-2.1: Detalle inteligente por tipo de fuente:
  - Jobs SQL/Veeam en curso se muestran como **En ejecución**.
  - Jobs por email/AS400/Barracuda/VDC pendientes se muestran como **Pendiente recepción**.
  - Jobs `NO-RUN` se muestran como **Sin ejecución** y quedan fuera de KPIs/NOK.
- El filtro NOK queda restringido a incidencias reales: `WARNING` / `ERROR`.
- KPIs ajustados para contar **EN CURSO** como `running + pending técnico`.
- Correo diario alineado con el nuevo modelo de estados:
  - `RUNNING/PENDING` técnico → **EN CURSO**
  - `NO-RUN` fuera de KPIs
  - banner rojo solo con `WARNING` / `ERROR`
- Export JSON móvil enriquecido con:
  - `status` global
  - `raw_status`
  - `detail`

### 🖥️ UI / Logs

- UI-1 cerrado: iconos de log visibles y operativos para jobs por email:
  - AS400
  - Veeam Data Cloud
  - Barracuda
- UI-2 cerrado: mejora visual del formato de logs AS400 en el modal **LOG BACKUP**.
- Colores AS400 aplicados por tipo de job:
  - `Backup SD` → verde `#00FF00`
  - `Backup PR` → rojo `#F01818`
  - `Backup RR` → amarillo `#A0A000`
  - `Backup SDB/TGT` → azul `#7890F0`
- UI-3 cerrado: limpieza visual de logs Barracuda/VDC:
  - eliminado footer comercial de Barracuda
  - eliminado bloque VDC `Please view your backup logs... / View logs / N`
- Modal de logs renombrado a **LOG BACKUP**.
- Validación visual OK en `https://dashboard` tras refresco/caché.

### 🐛 Corregido

- Jobs SQL/Veeam que ya existen en BBDD no muestran ya **Pendiente ejecución**.
- El detalle para jobs SQL/Veeam pasa a ser **En ejecución** cuando están en curso.
- El componente `JobTable` deja de pintar estados técnicos y usa etiquetas visibles normalizadas.
- El correo deja de mostrar `PENDING` / `RUNNING` como texto técnico.
- Los jobs `NO-RUN` quedan fuera de KPIs y fuera del filtro NOK.

### ⚠️ Pendiente conocido

- Recuperar y mostrar el porcentaje real de progreso en jobs SQL/Veeam cuando Veeam lo exponga en la fila disponible.
- Actualmente, si no llega porcentaje, el detalle queda como **En ejecución**.

### 🔧 Interno

- Cambios principales en:
  - `server.js`
  - `src/App.tsx`
  - `src/components/JobTable.tsx`
  - `electron/modules/emailBuilder.cjs`
  - `electron/modules/graph.cjs`
- Modelo B-2/B-2.1 consolidado como base para futura versión móvil/PWA.
- UI-1/UI-2/UI-3 quedan incorporados oficialmente al cierre funcional de v5.0.0.


## v4.0.0 - 2026-06-28

### Cerrado
- S-1 cerrado definitivamente: envío automático diario de informe a las 17:00 validado en producción.
- El correo automático usa el mismo snapshot que el dashboard, forzando refresh previo antes de generar el informe.
- KPIs del correo alineados con los KPIs visibles en `https://dashboard`.
- Asunto y título del informe basados en el día de inicio de la ventana operacional.
- Ventana operacional validada: 18:00 del día N a 17:59 del día N+1.
- Banner del informe ajustado a la regla funcional definitiva:
  - `success`, `running` y `pending` se consideran backups correctos del día.
  - `warning`, `error` y `failed` generan banner de errores.
- Confirmado en producción: mail automático recibido a las 17:00 con 6 jobs en ejecución, banner verde correcto, asunto/título correctos y KPIs coherentes con dashboard.

### Mejoras
- Mejora de trazabilidad en logs del envío diario.
- Refuerzo de consistencia entre backend, dashboard y correo.
- Preparación mantenida para autenticación Entra ID sin activar aún el login productivo por Entra.

### Notas
- `logs/` queda como carpeta runtime local y no debe subirse al repositorio.


## [3.2] - 2026-06-26

### ✨ Añadido
- 🔐 **S-2: Autenticación de API mediante BM_AUTH_TOKEN**
  - Todas las rutas `/api/*` quedan protegidas cuando `BM_AUTH_TOKEN` está definido.
  - El backend devuelve `401 / No autorizado` si no se envía token.
  - El frontend envía el token mediante header `Authorization: Bearer <token>`.
  - Nuevo componente `TokenGate` para introducir el token desde el navegador.
  - El token se guarda localmente en `localStorage` con clave `bm.authToken`.
  - La UI detecta respuestas `401` y vuelve a mostrar el panel de acceso.

### 🐛 Corregido
- **Backup Copy de Veeam ya no aparece duplicado** cuando existen fila parent y fila child.
  - El dashboard conserva el nombre largo real de la sesión de Veeam.
  - Ejemplo: `BackupCopy\JobOrigen`.
  - Se evita mostrar simultáneamente el parent y el child como dos jobs distintos.
- **S-4 validado:** el botón Planificador descarga correctamente el Excel de próximos 30 días en modo web.

### 🔧 Interno
- `src/utils/api.ts` centraliza el envío del token Bearer y detecta `401`.
- Nuevo `src/components/TokenGate.tsx`.
- `src/App.tsx` integra `TokenGate` y escucha el evento `bm:unauthorized`.
- `electron/modules/engine.cjs` ajustado para colapsar duplicados de Backup Copy mostrando el nombre largo.


## [3.1] - 2026-06-26

### ✨ Mejorado
- B-1.1: Persistencia y migración automática de comentarios manuales con timestamp.
  - `validateConfigInput` añade automáticamente `timestamp` a cualquier override sin fecha al guardar.
  - `loadConfig` migra en memoria los overrides antiguos para que dejen de ignorarse por la limpieza por ventana.
  - Compatibilidad con campos legacy: `updatedAt`, `updated`, `modifiedAt`, `createdAt`, `ts`, `date`, `manualAt`.
  - Compatibilidad con overrides legacy guardados como string plano: se convierten a objeto `{ comment, timestamp }`.

### 🐛 Corregido
- Comentarios manuales antiguos se ignoraban para siempre tras la limpieza por ventana de v3.0.
- Tras este fix, los comentarios manuales se respetan dentro de su ventana operacional y se descartan correctamente al cambiar de ventana.

### 🔧 Interno
- No se modifica `server.js` (la limpieza por ventana ya respetaba `timestamp` desde v3.0).
- No se modifica el frontend (ya guardaba `timestamp` al editar comentario).
- Cambios localizados en `electron/modules/config.cjs`.


## [3.0] - 2026-06-25

### 🚀 Versión mayor
- Consolidación de BackupMonitor como herramienta estable de monitorización.
- Cierre del bloque principal de monitorización multi-fuente: Veeam SQL, Veeam Data Cloud, Barracuda y AS400.

### ✨ Añadido / Mejorado
- Limpieza de estado y comentarios por ventana operacional.
  - Los jobs sin evidencia real de ejecución/recepción dentro de la ventana pasan a `pending`.
  - Se evita arrastrar estados y comentarios de ventanas anteriores.
  - `nextRun` ya no se usa como evidencia de ejecución real.
- Mejora visual de KPI del dashboard.
  - Fondos suavemente tintados por color de estado.
  - Números y bordes más visibles.
  - Mejor lectura visual de éxitos, avisos, errores y jobs en curso.
- Email diario consolidado.
  - Diseño profesional unificado.
  - Tabla de detalle con anchos fijos.
  - Asunto normalizado: `Informe Backup DD DE MES DE AAAA`.

### 🐛 Corregido
- Restaurado HTTPS en puerto 443 tras reponer el certificado `DASHBOARD.pfx`.
- Corregido fallback involuntario a HTTP 3100 cuando faltaba el PFX.
- Corregida limpieza de comentarios antiguos en jobs por email.
- Corregido uso incorrecto de `nextRun` para determinar si un job pertenecía a la ventana actual.

### 🔧 Interno
- `server.js` mantiene la limpieza en `buildRefreshPayloadForWindow`.
- La evidencia real de ejecución se basa en `lastRun`, `start`, `end`, `lastEmailDate`, `emailReceivedDate` o `receivedDateTime`.
- Validado en DASHBOARD con `POST /api/refresh`.


## [2.3] - 2026-06-24

### ✨ Mejorado
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
- 🛡 `table-layout:fixed` para garantizar que Outlook respete los anchos

### 🔧 Interno
- ✅ Builder HTML actualizado en ambos archivos (`.cjs` backend + `.ts` frontend)
- ✅ Coherencia visual entre botón Enviar y envío automático S-1


## [2.2] - 2026-06-24

### ✨ Añadido
- 📜 **B-1: Histórico de jobs por email (AS400, Barracuda, VDC)**
  - Parser AS400 desde adjunto `.txt` → extrae arranque, finalización y código
  - Parser Barracuda desde body del correo → extrae Start/End/Duration/Size/Items/Result
  - VDC con status inferido del subject (Start/End no disponibles sin login)
  - Procesamiento por lotes (8 en paralelo) para no saturar Graph
- 📊 **Modal Historial muestra "Inicio" (HH:MM:SS) y "Duración" (Xh Ym Zs)**
- 🛡 **Filtrado exacto del subject**: regex con bordes de palabra para evitar que jobs con nombre similar se mezclen (ej. "Backup SD" ya no captura "Backup SDB/TGT")

### 🐛 Corregido
- 🐞 Duración AS400: ahora se calcula como `end - start` (tiempo de reloj real)
  - Se ignora el campo "se utilizaron N segundos" del log (es CPU time)
- 🐞 Eliminada confusión entre jobs por prefijo de nombre en histórico
- 🐞 `Backup SD` ya no incluye ejecuciones de `Backup SDB/TGT` (eran 40 mezcladas, ahora 20 + 20 separadas)

### 🔧 Interno
- ✅ Nueva función `getMessageBody(cfg, messageId)` para descargar body completo
- ✅ Nueva función `detectRuleSource(rule)` para tipar la regla (AS400/Barracuda/VDC)
- ✅ Parsers exportados desde `graph.cjs` para testing futuro
- ✅ Cada execution incluye `parserSource` y `parsed` (true/false) para diagnóstico



## [2.1] - 2026-06-23

### ✨ Añadido
- 📧 **S-1: Envío automático de informe diario a las 17:00**
  - Scheduler robusto con control anti-duplicado (fichero marker persistente)
  - Endpoint manual de prueba: `POST /api/email/daily-report/test`
  - Health check ahora incluye `dailyReportLastSent`
- 🎨 **Diseño del correo automático unificado con el botón Enviar**
  - Tema oscuro azulado (Backup Monitor Pro)
  - KPIs grandes con colores (Total / Éxitos / Avisos / Errores / En curso)
  - Banner verde "TODOS LOS BACKUPS DEL DÍA SON CORRECTOS" / rojo si hay incidencias
  - % éxito en círculo (cabecera)
  - Tabla de jobs con badges de estado y criticidad
- 📩 **Asunto unificado**: "Informe Backup DD DE MES DE AAAA"
- 👥 **Destinatarios configurables** vía variable de entorno `BM_DAILY_REPORT_TO` (soporta múltiples separados por `;` o `,`)
- 🔐 **Arranque HTTPS robusto** con logs claros, validación PFX y fallback HTTP

### 🐛 Corregido
- 🐞 `sendDailyReport` ahora usa `bodyHtml` (firma correcta de `sendGraphEmail`)
- 🐞 Eliminada función duplicada `sendDailyReport` que usaba `global.lastStatusData` inexistente
- 🐞 SPA fallback con `app.use()` (evita errores path-to-regexp con `app.get('*')`)
- 🐞 Importación de `emailBuilder` movida de TypeScript (`src/utils/emailBuilder.ts`) a CommonJS (`electron/modules/emailBuilder.cjs`) para compatibilidad Node

### 🔧 Interno / Infraestructura
- ✅ Builder HTML compartido y reutilizable (`electron/modules/emailBuilder.cjs`)
- ✅ Helpers integrados en backend: `escapeHtml`, `safeLower`, `sourceLabel`, `formatLocal`, `formatDuration`, `computeKpis`
- ✅ Logs `[S-1]` para trazabilidad del scheduler diario
- ✅ Variable `BM_DAILY_REPORT_TO` documentada en NSSM


## [2.0.0] - 2026-06-20

### ✨ Mejoras
- 🔒 Migración completa a HTTPS en entorno productivo (acceso seguro mediante certificado interno CA)
- 🌐 Servidor Express funcionando 24/7 como servicio Windows (NSSM)
- 🔁 Redirección automática HTTP → HTTPS

### 🐛 Corregido
- 🐞 Jobs de Barracuda no visibles en "TODOS" durante fin de semana  
  → causa: filtro por texto (`includes("pr" | "rr")`) afectaba a "Barracuda" y "Sharepoint"

- 🐞 Filtro de fin de semana mejorado  
  → ahora solo afecta a jobs SQL (Veeam PR/RR)  
  → NO oculta jobs por email (Barracuda, VDC, AS400)

- 🐞 Error `mac verify failure` en HTTPS  
  → causa: variables de entorno no cargadas en ejecución manual  
  → validación correcta del PFX y passphrase

- 🐞 Problemas de routing en Express  
  → `/api/refresh` devolvía index.html  
  → orden de middlewares corregido

- 🐞 Error en fallback de rutas (`path-to-regexp`)  
  → sustituido `app.get('*')` por `app.use(...)`

### 🔧 Interno / Infraestructura
- ✅ Validación completa del flujo:
  - Frontend ↔ API ↔ Motor
- ✅ Separación correcta entre `rows` y `fullRows`
- ✅ Sistema de refresco y cache estabilizado
- ✅ Logs y diagnóstico mejorados



## [1.0.2] - 2026-06-20

### Añadido
- 📊 Porcentaje de progreso en jobs en ejecución (En ejecución (X%))
- 🧩 Descripción específica para Backup Configuration Job en ejecución

### Corregido
- 🐛 Jobs en ejecución se mostraban como SUCCESS en algunos casos (B-3)
- 🐛 Duplicado de jobs: se mostraba el job padre junto al Backup Copy hijo (B-4)
- 📉 KPI "En curso" y "Éxitos" inconsistentes debido a clasificación incorrecta



## [1.0.1] - 2026-06-18

### Corregido
- 🐛 Botón "Planificador" daba error en modo web (scheduleExcel.ts llamaba directamente a window.api)



## [1.0.0] - 2026-06-18

Primera versión estable en producción 24/7 como aplicación web multi-usuario.
