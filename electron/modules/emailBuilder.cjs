// electron/modules/emailBuilder.cjs
// Builder HTML para el correo diario de BackupMonitor

function buildEmailHtml(payload) {
  const rows = Array.isArray(payload?.fullRows) ? payload.fullRows : []
  const total = rows.length

  const ok = rows.filter(r => r.status === 'success').length
  const ko = rows.filter(r => r.status === 'error').length
  const warn = rows.filter(r => r.status === 'warning').length
  const running = rows.filter(r => r.status === 'running').length

  const fecha = new Date().toLocaleString('es-ES')

  const rowsHtml = rows.map(r => {
    const color =
      r.status === 'success' ? '#16a34a' :
      r.status === 'error'   ? '#dc2626' :
      r.status === 'warning' ? '#f59e0b' :
      r.status === 'running' ? '#2563eb' : '#6b7280'

    return `
      <tr>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.jobName || '-')}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;color:${color};font-weight:bold;">
          ${escapeHtml(r.status || '-')}
        </td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.lastResult || '-')}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.source || '-')}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.criticality || '-')}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${escapeHtml(r.lastRun || '-')}</td>
      </tr>
    `
  }).join('')

  const banner = ko > 0
    ? `<div style="background:#fee2e2;border:1px solid #dc2626;padding:10px;border-radius:6px;color:#7f1d1d;">
         ⚠️ Hay <b>${ko}</b> incidencias detectadas en los backups.
       </div>`
    : `<div style="background:#dcfce7;border:1px solid #16a34a;padding:10px;border-radius:6px;color:#14532d;">
         ✅ Todos los backups dentro de parámetros.
       </div>`

  return `
  <html>
    <body style="font-family:Segoe UI, Arial, sans-serif;color:#111;">
      <h2 style="margin-bottom:0;">BackupMonitor — Estado diario</h2>
      <div style="color:#6b7280;margin-bottom:16px;">${fecha}</div>

      ${banner}

      <table style="margin:16px 0;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 12px;background:#f3f4f6;"><b>Total</b></td>
          <td style="padding:6px 12px;background:#f3f4f6;">${total}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;">✅ Éxitos</td>
          <td style="padding:6px 12px;">${ok}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;">❌ Errores</td>
          <td style="padding:6px 12px;">${ko}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;">⚠️ Advertencias</td>
          <td style="padding:6px 12px;">${warn}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;">🔵 En ejecución</td>
          <td style="padding:6px 12px;">${running}</td>
        </tr>
      </table>

      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="text-align:left;padding:6px;border-bottom:2px solid #e5e7eb;">Job</th>
            <th style="text-align:left;padding:6px;border-bottom:2px solid #e5e7eb;">Estado</th>
            <th style="text-align:left;padding:6px;border-bottom:2px solid #e5e7eb;">Resultado</th>
            <th style="text-align:left;padding:6px;border-bottom:2px solid #e5e7eb;">Fuente</th>
            <th style="text-align:left;padding:6px;border-bottom:2px solid #e5e7eb;">Criticidad</th>
            <th style="text-align:left;padding:6px;border-bottom:2px solid #e5e7eb;">Última ejecución</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || `<tr><td colspan="6" style="padding:10px;text-align:center;color:#6b7280;">Sin datos</td></tr>`}
        </tbody>
      </table>

      <div style="color:#6b7280;font-size:11px;margin-top:24px;">
        BackupMonitor v2.0.0 — Informe automático
      </div>
    </body>
  </html>
  `
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

module.exports = { buildEmailHtml }