import { useState } from "react"
import { api } from "../utils/api"

export default function EmailModal({ htmlPreview, day, onClose }: { htmlPreview: string; day: string; onClose: () => void }) {
  const [to, setTo] = useState("")
  const [cc, setCc] = useState("")
  const [cco, setCco] = useState("")
  const [sending, setSending] = useState(false)

  async function handleSend() {
    const recipients = to.split(",").map((s) => s.trim()).filter(Boolean)
    if (recipients.length === 0) return alert("Introduce destinatario")
    setSending(true)
    try {
      const res = await api().sendEmail({
        bodyHtml: htmlPreview,
        to: recipients,
        cc: cc.split(",").map((s) => s.trim()).filter(Boolean),
        bcc: cco.split(",").map((s) => s.trim()).filter(Boolean),
        subject: `Informe Backup ${day}`,
      })
      if (!res?.ok) throw new Error(res?.error ?? "Error")
      alert("Enviado")
      onClose()
    } catch (e: any) {
      alert(`Error: ${e?.message ?? e}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="email-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="email-modal-panel" >
        <div className="email-modal-header">
          <h2>Enviar Informe {day}</h2>
          <button className="email-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="email-modal-fields">
          <label>Para</label>
          <input value={to} onChange={(e) => setTo(e.target.value)} />
          <label>CC</label>
          <input value={cc} onChange={(e) => setCc(e.target.value)} />
          <label>CCO</label>
          <input value={cco} onChange={(e) => setCco(e.target.value)} />
        </div>
        <div className="email-modal-preview" dangerouslySetInnerHTML={{ __html: htmlPreview }} />
        <div className="email-modal-actions">
          <button onClick={handleSend} disabled={sending}>{sending ? "Enviando..." : "Enviar"}</button>
        </div>
      </div>
    </div>
  )
}