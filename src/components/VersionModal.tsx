import { useEffect, useState } from "react"
import { marked } from "marked"
import { APP_VERSION, APP_VERSION_DATE } from "../version"

export default function VersionModal({ onClose }: { onClose: () => void }) {
  const [changelogHtml, setChangelogHtml] = useState<string>("<p>Cargando historial...</p>")

  useEffect(() => {
    fetch("/CHANGELOG.md")
      .then(r => r.ok ? r.text() : Promise.reject("No se pudo cargar el changelog"))
      .then(text => {
        const html = marked.parse(text, { async: false }) as string
        setChangelogHtml(html)
      })
      .catch(e => setChangelogHtml(`<p style="color:#ef4444">No se pudo cargar el historial: ${e}</p>`))
  }, [])

  return (
    <div
      className="email-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ zIndex: 9999 }}
    >
      <div className="email-modal-panel" style={{ maxWidth: 800 }}>
        <div className="email-modal-header">
          <h2>BackupMonitor — Historial de versiones</h2>
          <button className="email-modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ padding: "12px 20px 4px", color: "var(--muted)", fontSize: 13 }}>
          Versión actual: <strong style={{ color: "var(--text)" }}>v{APP_VERSION}</strong> · Publicado el {APP_VERSION_DATE}
        </div>

        <div
          className="changelog-content"
          style={{
            padding: "16px 24px",
            overflowY: "auto",
            maxHeight: "65vh",
            color: "var(--text)",
            fontSize: 14,
            lineHeight: 1.6,
          }}
          dangerouslySetInnerHTML={{ __html: changelogHtml }}
        />
      </div>
    </div>
  )
}