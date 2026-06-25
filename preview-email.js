// preview-email.js
const { buildEmailHtml } = require('./electron/modules/emailBuilder.cjs')
const fs = require('fs')

// Datos reales simulando tu dashboard
const payload = {
  windowStart: '2026-06-24T16:00:00.000Z',
  windowEnd: '2026-06-25T16:00:00.000Z',
  fullRows: [
    {
      jobName: 'Veeam Data Cloud Sharepoint y Teams',
      status: 'failed',
      source: 'email',
      criticality: 'high',
      nextRun: '2026-06-24T18:00:00.000Z',
      durationMs: null,
      reason: 'Correo Recibido, revisar manualmente el log',
    },
    {
      jobName: 'NDMP - DESARROLLO - DIARIO 05.15',
      status: 'failed',
      source: 'both',
      criticality: 'medium',
      nextRun: '2026-06-24T19:01:00.000Z',
      durationMs: 23000,
      reason: 'Error Email',
      relaunched: true,
    },
    {
      jobName: 'SQLCRM6 desde WASABI a DDVEDCO\\SQLCRM6 - VM - DIARIO 1830 DCO',
      status: 'running',
      source: 'sql',
      criticality: 'high',
      nextRun: '2026-06-25T00:00:00.000Z',
      durationMs: 3283000,
      reason: 'En ejecución (41%)',
    },
    {
      jobName: 'Veeam Data Cloud Exchange',
      status: 'pending',
      source: 'email',
      criticality: 'medium',
      nextRun: '2026-06-24T18:00:00.000Z',
      durationMs: null,
      reason: 'Pendiente Recepcion',
    },
    {
      jobName: 'Backup SD',
      status: 'success',
      source: 'email',
      criticality: 'high',
      nextRun: '2026-06-23T22:40:00.000Z',
      durationMs: 3665000,
      reason: 'Backup correcto',
    },
    {
      jobName: 'Barracuda OneDrive',
      status: 'success',
      source: 'email',
      criticality: 'medium',
      nextRun: '2026-06-24T10:00:13.000Z',
      durationMs: 687000,
      reason: 'Backup correcto',
    },
    {
      jobName: 'NDMP - USUARIOS - TIC - DIARIO 22.30',
      status: 'success',
      source: 'sql',
      criticality: 'high',
      nextRun: '2026-06-23T22:30:00.000Z',
      durationMs: 14400000,
      reason: 'Backup correcto',
    },
    {
      jobName: 'Backup PR',
      status: 'warning',
      source: 'email',
      criticality: 'medium',
      nextRun: '2026-06-23T22:50:00.000Z',
      durationMs: 17820000,
      reason: 'Advertencias detectadas en el log',
    },
  ],
  rows: [],
}

const html = buildEmailHtml(payload)
fs.writeFileSync('preview.html', html, 'utf8')
console.log('✅ Generado preview.html — ábrelo en navegador')