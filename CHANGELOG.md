# Changelog

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
