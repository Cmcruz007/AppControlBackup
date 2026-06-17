import { useState } from "react"
import type { ManualOverride } from "../types/ui"

export default function CommentEditor({
  jobName, currentComment, currentStatus, autoReason, onSave, onClose,
}: {
  jobName: string
  currentComment: string
  currentStatus: string
  autoReason?: string
  onSave: (jobName: string, override: ManualOverride | null) => Promise<void>
  onClose: () => void
}) {
  const [comment, setComment] = useState(currentComment)
  const [status, setStatus] = useState(currentStatus)

  return (
    <div className="email-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="email-modal-panel" style={{ maxWidth: 480 }} >
        <div className="email-modal-header">
          <h2>Ajuste manual: {jobName}</h2>
          <button className="email-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="email-modal-fields" style={{ gridTemplateColumns: "1fr", gap: 10 }}>
          <label>Estado</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            style={{ background: "var(--panel-2)", border: "1px solid var(--border)", color: "var(--text)", padding: 8, borderRadius: 6 }}>
            <option value="success">Success</option>
            <option value="warning">Warning</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
            <option value="pending">Pending</option>
          </select>
          <label>Comentario / Detalle</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4}
            style={{ background: "var(--panel-2)", border: "1px solid var(--border)", color: "var(--text)", padding: 8, borderRadius: 6, resize: "vertical" }} />
          {autoReason && <div style={{ fontSize: 12, color: "var(--muted)" }}>Motivo: {autoReason}</div>}
        </div>
        <div className="email-modal-actions">
          <button className="secondary" onClick={onClose}>Cancelar</button>
          <button onClick={() => onSave(jobName, { status, ...(comment.trim() ? { comment: comment.trim() } : {}) }).then(onClose)}>Guardar</button>
          <button className="secondary" style={{ background: "rgba(239,68,68,.15)", color: "#fca5a5" }}
            onClick={() => onSave(jobName, null).then(onClose)}>Quitar</button>
        </div>
      </div>
    </div>
  )
}