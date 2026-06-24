# Changelog

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
---
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

---

## [1.0.2] - 2026-06-20

### Añadido
- 📊 Porcentaje de progreso en jobs en ejecución (En ejecución (X%))
- 🧩 Descripción específica para Backup Configuration Job en ejecución

### Corregido
- 🐛 Jobs en ejecución se mostraban como SUCCESS en algunos casos (B-3)
- 🐛 Duplicado de jobs: se mostraba el job padre junto al Backup Copy hijo (B-4)
- 📉 KPI "En curso" y "Éxitos" inconsistentes debido a clasificación incorrecta

---

## [1.0.1] - 2026-06-18

### Corregido
- 🐛 Botón "Planificador" daba error en modo web (scheduleExcel.ts llamaba directamente a window.api)

---

## [1.0.0] - 2026-06-18

Primera versión estable en producción 24/7 como aplicación web multi-usuario.
