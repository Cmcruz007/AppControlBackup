# Changelog de BackupMonitor

Todos los cambios notables del proyecto se documentan en este archivo.

El formato sigue https://keepachangelog.com/es-ES/1.1.0/
y este proyecto adhiere a https://semver.org/spec/v2.0.0.html.

---

## [1.0.1] - 2026-06-18

### Corregido
- 🐛 Botón "Planificador" daba error en modo web (`scheduleExcel.ts` llamaba directamente a `window.api`)

---

## [1.0.0] - 2026-06-18

Primera versión estable en producción 24/7 como aplicación web multi-usuario.

### Añadido
- 🌐 Servidor Express standalone (`server.js`) — la app deja de ser solo Electron
- 🔒 HTTPS con certificado de CA interna (MSADUCI) — válido hasta junio 2028
- ↪️ Redirección automática de HTTP (puerto 80) a HTTPS (puerto 443)
- 🛡️ Servicio Windows gestionado con NSSM en el servidor DASHBOARD
- 🔐 Cifrado AES-256-GCM para configuración privada (modo Express)
- 📁 Configuración compartida entre usuarios vía `\\dashboard\AppControlBackup\config-shared.json`
- 🩺 Health check periódico del pool SQL para detectar conexiones caídas
- ✅ Validación de esquema en las peticiones de configuración (`/api/config`)
- 📊 Caché de detección de tabla de sesiones de Veeam (reduce queries a INFORMATION_SCHEMA)
- 🌍 Soporte de proxy corporativo mediante `undici` (HTTP_PROXY / HTTPS_PROXY)
- 📋 Botón de log AS/400 disponible también en la vista de Histórico

### Cambiado
- ♻️ Modularización completa del backend Electron en 7 módulos (`utils`, `config`, `sql`, `graph`, `schedule`, `engine`, `rules`)
- ♻️ Modularización completa del frontend React en 15 archivos (`types`, `utils`, `components`)
- 🔌 API dual del frontend: detecta automáticamente si está en Electron (IPC) o navegador (fetch)
- 🔣 Encoding de adjuntos AS/400 cambiado de UTF-8 a Latin-1 (acentos y Ñ correctos)
- ⚙️ Aplicación de criticidades extendida a las reglas de email (VDC, Barracuda, AS400)

### Corregido
- 🐛 Las modificaciones de criticidad no se guardaban
- 🐛 El cambio manual de estado de un backup no se reflejaba (faltaba `timestamp` en el override)
- 🐛 Los overrides manuales no se aplicaban a las filas de email (VDC / Barracuda / AS400)
- 🐛 El modal se cerraba al arrastrar el ratón desde dentro hacia fuera
- 🐛 Lógica de expiración de overrides ambigua eliminada del motor (`engine.cjs`)
- 🐛 Wildcard de Express 5 actualizado (`'*'` → `'{*path}'`)
- 🐛 `package.json` apuntando a `main.cjs` en raíz en vez de `electron/main.cjs`

### Eliminado
- 🗑️ Archivos de backup manual (`bueno*`, `mainold*`, `*copia*`, dumps temporales)
- 🗑️ Código muerto en `exporter.js` (la exportación JSON ya se hace en el refresh)
- 🗑️ Antiguo build de Electron empaquetado (`release/`) — la app ahora es web

### Conocidos (pendientes)
- ⚠️ El historial de ejecuciones está vacío para jobs que vienen de email (VDC, Barracuda, AS400)
- ⚠️ La API REST aún no tiene autenticación por token (`BM_AUTH_TOKEN`)
