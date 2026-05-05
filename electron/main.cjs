const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const CONFIG_FILE = () => path.join(app.getPath("userData"), "config.enc");

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE())) return null;
    const encryptedData = fs.readFileSync(CONFIG_FILE());
    return JSON.parse(safeStorage.decryptString(encryptedData));
  } catch (e) {
    return null;
  }
}

function buildMssqlConfig(sqlCfg) {
  return {
    server: sqlCfg.host,
    port: Number(sqlCfg.port) || 1433,
    database: sqlCfg.database || "VeeamBackup",
    user: sqlCfg.user?.includes("\\") ? undefined : sqlCfg.user,
    password: sqlCfg.user?.includes("\\") ? undefined : sqlCfg.password,
    authentication: sqlCfg.user?.includes("\\") ? {
      type: "ntlm",
      options: { domain: sqlCfg.user.split("\\")[0], userName: sqlCfg.user.split("\\")[1], password: sqlCfg.password }
    } : undefined,
    options: { encrypt: false, trustServerCertificate: true, useUTC: false },
    connectionTimeout: 15000, requestTimeout: 30000
  };
}

// ---------- Microsoft Graph: Leer y Enviar ----------
async function getEmails(cfg) {
  if (!cfg?.graph?.tenantId) return [];
  try {
    const g = cfg.graph;
    const authUrl = `https://login.microsoftonline.com/${g.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({ 
      client_id: g.clientId, 
      client_secret: g.clientSecret, 
      scope: "https://graph.microsoft.com/.default", 
      grant_type: "client_credentials" 
    });
    
    const resAuth = await fetch(authUrl, { method: "POST", body });
    const authJson = await resAuth.json();
    const token = authJson.access_token;

    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const mailUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(g.mailbox)}/messages?$filter=receivedDateTime ge ${since}&$select=subject,receivedDateTime,bodyPreview&$top=200`;
    
    const resMail = await fetch(mailUrl, { headers: { Authorization: `Bearer ${token}` } });
    const mailData = await resMail.json();
    return mailData.value || [];
  } catch (e) {
    return [];
  }
}

async function sendGraphEmail(cfg, { to, subject, bodyHtml }) {
  const g = cfg.graph;
  try {
    const authUrl = `https://login.microsoftonline.com/${g.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({ 
      client_id: g.clientId, 
      client_secret: g.clientSecret, 
      scope: "https://graph.microsoft.com/.default", 
      grant_type: "client_credentials" 
    });
    const resAuth = await fetch(authUrl, { method: "POST", body });
    const { access_token } = await resAuth.json();

    const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(g.mailbox)}/sendMail`;
    const emailPayload = {
      message: {
        subject: subject,
        body: { contentType: "HTML", content: bodyHtml },
        toRecipients: [{ emailAddress: { address: to } }]
      }
    };

    const res = await fetch(sendUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload)
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// ---------- SQL Server Data ----------
async function sqlGetData(sqlCfg) {
  const mssql = require("mssql");
  const pool = await mssql.connect(buildMssqlConfig(sqlCfg));
  try {
    const tables = await pool.request().query(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN ('BackupJobSessions', 'BSessions', 'Backup.Model.JobSessions')`);
    const tName = tables.recordset[0].TABLE_NAME;

    const rSess = await pool.request().query(`
      SELECT TOP 1000 s.job_id, s.creation_time, s.end_time, s.result, j.name as job_name 
      FROM [dbo].[${tName}] s WITH (NOLOCK) 
      INNER JOIN [dbo].[BJobs] j WITH (NOLOCK) ON j.id = s.job_id 
      ORDER BY s.creation_time DESC
    `);
    return rSess.recordset;
  } finally {
    await pool.close();
  }
}

function setupIpc() {
  ipcMain.handle("config:get", () => loadConfig());
  ipcMain.handle("config:save", (_e, cfg) => {
    fs.writeFileSync(CONFIG_FILE(), safeStorage.encryptString(JSON.stringify(cfg)));
    return true;
  });

  ipcMain.handle("test:sql", async (_e, sqlCfg) => {
    try {
      const mssql = require("mssql");
      const pool = await mssql.connect(buildMssqlConfig(sqlCfg));
      await pool.close();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle("test:graph", async (_e, graphCfg) => {
    try {
      await getEmails({ graph: graphCfg });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle("email:send", async (_e, payload) => {
    const cfg = loadConfig();
    const ok = await sendGraphEmail(cfg, payload);
    return { ok };
  });

  ipcMain.handle("refresh", async () => {
    const cfg = loadConfig();
    if (!cfg?.sql) return { ok: false, error: "Falta configuración SQL." };
    try {
      const [sessions, emails] = await Promise.all([sqlGetData(cfg.sql), getEmails(cfg)]);
      const ahora = new Date();
      const inicio = new Date(); inicio.setHours(18, 0, 0, 0);
      if (ahora.getHours() < 18) inicio.setDate(inicio.getDate() - 1);
      const fin = new Date(inicio.getTime() + 86400000);

      // 1. Deduplicación Agresiva
      const rawSessions = sessions.filter(s => {
        const f = new Date(s.creation_time);
        return f >= inicio && f < fin;
      }).sort((a, b) => b.job_name.length - a.job_name.length);

      const uniqueExecs = [];
      rawSessions.forEach(s => {
        const isDuplicate = uniqueExecs.some(u => {
          const timeDiff = Math.abs(new Date(u.creation_time) - new Date(s.creation_time));
          const nameOverlap = u.job_name.toLowerCase().includes(s.job_name.toLowerCase()) || 
                              s.job_name.toLowerCase().includes(u.job_name.toLowerCase());
          return timeDiff < 300000 && nameOverlap;
        });
        if (!isDuplicate) uniqueExecs.push(s);
      });

      // 2. Prevalencia de Success
      const successMap = new Map();
      uniqueExecs.forEach(s => {
        const base = s.job_name.split('\\')[0].trim().toLowerCase();
        if (s.result === 0) successMap.set(base, true);
        else if (!successMap.has(base)) successMap.set(base, false);
      });

      const allRows = uniqueExecs.map(s => {
        const start = new Date(s.creation_time); // INICIO REAL
        const relevantEmails = emails.filter(e => 
          e.subject.toLowerCase().includes(s.job_name.toLowerCase()) && 
          new Date(e.receivedDateTime) > start
        );
        const email = relevantEmails[0];

        let status = "running", reason = "En ejecución";
        if (s.result === 0) { status = "success"; reason = email ? "Confirmado Email" : "Finalizado (SQL)"; }
        else if (s.result === 1) { status = "warning"; reason = email ? "Aviso Email" : "Aviso (SQL)"; }
        else if (s.result === 2) { status = "failed"; reason = email ? "Error Email" : "Error (SQL)"; }

        // CÁLCULO DE DURACIÓN REAL (Basado en el inicio real del SQL 'creation_time')
        const puntoFinal = email ? new Date(email.receivedDateTime) : (s.end_time ? new Date(s.end_time) : ahora);
        let durationMs = puntoFinal.getTime() - start.getTime();

        return {
          jobId: s.job_id.toString() + "-" + start.getTime(),
          jobName: s.job_name,
          nextRun: s.creation_time, // Se usa para mostrar la hora en la tabla
          status,
          reason,
          durationMs: durationMs > 0 ? durationMs : null,
          email: email ? { subject: email.subject, date: email.receivedDateTime } : null,
          allEmails: relevantEmails.map(e => ({ 
            subject: e.subject, 
            date: e.receivedDateTime, 
            status: e.bodyPreview?.toLowerCase().includes("success") ? "success" : "failed" 
          }))
        };
      });

      allRows.sort((a, b) => new Date(b.nextRun).getTime() - new Date(a.nextRun).getTime());

      const filteredRows = allRows.filter(r => {
        const base = r.jobName.split('\\')[0].trim().toLowerCase();
        return !successMap.get(base) && r.status !== "success";
      });

      return { 
        ok: true, 
        rows: filteredRows, 
        fullRows: allRows, 
        ts: ahora.toISOString(), 
        windowStart: inicio.toISOString(), 
        windowEnd: fin.toISOString() 
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}

function createWindow() {
  const win = new BrowserWindow({ 
    width: 1300, height: 900, 
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true } 
  });
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => { setupIpc(); createWindow(); });
app.on("window-all-closed", () => app.quit());