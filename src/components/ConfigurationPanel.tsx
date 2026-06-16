import { useState } from "react"
import type { AppConfig, ConfigTab } from "../types/ui"
import Settings from "../Settings"
import CriticalityPanel from "../CriticalityPanel"
import VeeamDataCloudPanel from "../VeeamDataCloudPanel"
import BarracudaPanel from "../BarracudaPanel"
import As400Panel from "../As400Panel"

export default function ConfigurationPanel({
  open, onClose, config, onSaved, pinLocked, pinInput, setPinInput, onUnlock, allJobNames,
}: {
  open: boolean
  onClose: () => void
  config: AppConfig | null
  onSaved: (cfg: AppConfig) => void
  pinLocked: boolean
  pinInput: string
  setPinInput: (v: string) => void
  onUnlock: () => void
  allJobNames: string[]
}) {
  const [activeConfigTab, setActiveConfigTab] = useState<ConfigTab>("general")

  if (!open) return null

  if (pinLocked) {
    return (
      <div className="email-modal-overlay" onClick={onClose}>
        <div className="email-modal-panel" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
          <div className="email-modal-header">
            <h2>Bloqueado</h2>
            <button className="email-modal-close" onClick={onClose}>×</button>
          </div>
          <div className="pin-section" style={{ margin: "20px auto" }}>
            <h2>Introduce PIN</h2>
            <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} placeholder="PIN" maxLength={8} />
            <button onClick={onUnlock}>Desbloquear</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="email-modal-overlay" onClick={onClose}>
      <div className="email-modal-panel" style={{ maxWidth: 1120, width: "96%", padding: 0, overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div className="email-modal-header" style={{ marginBottom: 0, borderBottom: "1px solid var(--border)" }}>
          <h2>Configuración</h2>
          <button className="email-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          <button type="button" onClick={() => setActiveConfigTab("general")} className={`config-panel-tab ${activeConfigTab === "general" ? "active" : ""}`}>General</button>
          <button type="button" onClick={() => setActiveConfigTab("criticality")} className={`config-panel-tab ${activeConfigTab === "criticality" ? "active" : ""}`}>Criticidades</button>
          <button type="button" onClick={() => setActiveConfigTab("veeamDataCloud")} className={`config-panel-tab ${activeConfigTab === "veeamDataCloud" ? "active" : ""}`}>VEEAM DATA CLOUD</button>
          <button type="button" onClick={() => setActiveConfigTab("barracuda")} className={`config-panel-tab ${activeConfigTab === "barracuda" ? "active" : ""}`}>BARRACUDA</button>
          <button type="button" onClick={() => setActiveConfigTab("as400")} className={`config-panel-tab ${activeConfigTab === "as400" ? "active" : ""}`}>AS400</button>
        </div>
        <div style={{ padding: 16, maxHeight: "80vh", overflow: "auto" }}>
          {activeConfigTab === "general" && <Settings config={config} onSaved={onSaved} />}
          {activeConfigTab === "criticality" && <CriticalityPanel config={config} onSaved={onSaved} jobNames={allJobNames} />}
          {activeConfigTab === "veeamDataCloud" && <VeeamDataCloudPanel config={config} onSaved={onSaved} />}
          {activeConfigTab === "barracuda" && <BarracudaPanel config={config} onSaved={onSaved} />}
          {activeConfigTab === "as400" && <As400Panel config={config} onSaved={onSaved} />}
        </div>
      </div>
    </div>
  )
}