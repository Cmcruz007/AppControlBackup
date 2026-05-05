# Backup Monitor — Veeam + 365

App de escritorio (Electron) para monitorizar backups Veeam cruzando SQL Server (`SQLCRMCLU` / `VeeamBackup`) con el buzón IMAP `backup@uci.com`. **LAN-only**, **solo lectura** en SQL e IMAP, credenciales cifradas con `safeStorage` de Electron (DPAPI en Windows).

## Empaquetar el .exe (en una máquina Windows)

Requisitos: Node.js 18+ y conexión a Internet la primera vez (descarga el binario de Electron).

```bash
cd electron-app
npm install
npm run package:win
```

Resultado: `electron-app/release/BackupMonitor-win32-x64/BackupMonitor.exe` — portable, doble clic para ejecutar.

## Probar en local sin empaquetar

```bash
cd electron-app
npm install
npm run build
npm start
```

## Uso

1. Abre la app → pestaña **Ajustes**.
2. Rellena **SQL** (host `SQLCRMCLU`, base `VeeamBackup`, usuario `db_datareader`; soporta `DOMINIO\usuario` para Windows Auth) y pulsa **Probar conexión SQL**.
3. Rellena **Microsoft Graph (M365)**:
   - Tenant ID, Client ID y Client Secret de una App Registration en Microsoft Entra ID.
   - Permiso de aplicación `Mail.Read` con **Grant admin consent**.
   - (Recomendado) **Application Access Policy** en Exchange Online para restringir el AppId al buzón `backup@uci.com`.
   - Buzón: `backup@uci.com`. Filtro remitente: `veeambackup@uci.com`.
   - Pulsa **Probar Microsoft Graph**.
4. Ajusta auto-refresco (5 min) y tolerancia "Sin correo" (60 min).
5. Opcional: PIN para proteger Ajustes.
6. **Guardar** → **Dashboard** → **Refrescar**.

## Notas

- **No se usa contraseña del buzón ni IMAP**. Toda la lectura va por Microsoft Graph con OAuth 2.0 Client Credentials (`Mail.Read`, solo aplicación).
- **Solo lectura garantizado**: la app solo llama a endpoints `GET` de Graph y solo `SELECT`/`WITH` en SQL. Cualquier query SQL no-lectura es rechazada en código.
- **LAN-only**: la app valida al arrancar que el equipo solo tiene IPs privadas (RFC1918) o loopback.
- **Consulta SQL**: usa `[dbo].[BJobs]`, `[dbo].[BJobSessions]` y `[dbo].[BJobsSchedule]`. Edita `electron/main.cjs` → `sqlGetJobs` si tu Veeam usa otros nombres.
