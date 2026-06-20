# Changelog

---

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
