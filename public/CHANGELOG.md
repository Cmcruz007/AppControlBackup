# Changelog

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
