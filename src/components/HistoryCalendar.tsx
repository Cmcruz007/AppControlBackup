import { useEffect, useMemo, useState } from "react"

export default function HistoryCalendar({
  availableDays, selectedDay, onSelect,
}: {
  availableDays: string[]
  selectedDay: string | null
  onSelect: (day: string) => void
}) {
  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
  const weekDays = ["L", "M", "X", "J", "V", "S", "D"]

  const parseLocalDay = (value: string) => {
    const [y, m, d] = value.split("-").map(Number)
    return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0)
  }

  const toDayKey = (date: Date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, "0")
    const d = String(date.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }

  const availableSet = useMemo(() => new Set(availableDays), [availableDays])

  const latestAvailable = useMemo(() => {
    if (!availableDays.length) return null
    return [...availableDays].sort().slice(-1)[0] ?? null
  }, [availableDays])

  const initialBaseDay = selectedDay || latestAvailable
  const initialBaseDate = initialBaseDay ? parseLocalDay(initialBaseDay) : new Date()

  const [viewYear, setViewYear] = useState(initialBaseDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(initialBaseDate.getMonth())

  useEffect(() => {
    const baseDay = selectedDay || latestAvailable
    if (!baseDay) return
    const d = parseLocalDay(baseDay)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }, [selectedDay, latestAvailable])

  const changeMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(next.getFullYear())
    setViewMonth(next.getMonth())
  }

  const firstDayOfMonth = new Date(viewYear, viewMonth, 1)
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const mondayBasedOffset = (firstDayOfMonth.getDay() + 6) % 7

  const cells: any[] = []
  for (let i = 0; i < mondayBasedOffset; i++) {
    cells.push({ key: `empty-start-${i}`, dayNumber: null, fullDate: null, isAvailable: false, isSelected: false, isToday: false })
  }

  const todayKey = toDayKey(new Date())

  for (let day = 1; day <= daysInMonth; day++) {
    const current = new Date(viewYear, viewMonth, day, 12, 0, 0, 0)
    const key = toDayKey(current)
    cells.push({ key, dayNumber: day, fullDate: key, isAvailable: availableSet.has(key), isSelected: selectedDay === key, isToday: todayKey === key })
  }

  while (cells.length % 7 !== 0) {
    const idx = cells.length
    cells.push({ key: `empty-end-${idx}`, dayNumber: null, fullDate: null, isAvailable: false, isSelected: false, isToday: false })
  }

  return (
    <div style={{ width: "min(100%, 320px)", minWidth: 280, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 12, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
        <button type="button" className="secondary" onClick={() => changeMonth(-1)} style={{ padding: "4px 10px", fontSize: 12, flex: "0 0 auto" }}>◀</button>
        <div style={{ textAlign: "center", minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{monthNames[viewMonth]} {viewYear}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{availableDays.length} día{availableDays.length === 1 ? "" : "s"} con datos</div>
        </div>
        <button type="button" className="secondary" onClick={() => changeMonth(1)} style={{ padding: "4px 10px", fontSize: 12, flex: "0 0 auto" }}>▶</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, marginBottom: 8 }}>
        {weekDays.map((wd) => (
          <div key={wd} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--muted)", padding: "4px 0" }}>{wd}</div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
        {cells.map((cell) => {
          if (!cell.dayNumber || !cell.fullDate) return <div key={cell.key} style={{ minHeight: 36 }} />
          const bg = cell.isSelected ? "var(--primary)" : cell.isAvailable ? "rgba(96,165,250,.16)" : "transparent"
          const border = cell.isSelected ? "1px solid var(--primary)" : cell.isToday ? "1px solid rgba(148,163,184,.45)" : "1px solid var(--border)"
          const color = cell.isSelected ? "#fff" : cell.isAvailable ? "var(--text)" : "var(--muted)"
          return (
            <button key={cell.key} type="button" disabled={!cell.isAvailable}
              title={cell.isAvailable ? `Ver ${cell.fullDate}` : "Sin datos"}
              onClick={() => cell.isAvailable && onSelect(cell.fullDate)}
              style={{ minHeight: 36, height: 36, borderRadius: 8, border, background: bg, color,
                cursor: cell.isAvailable ? "pointer" : "default", fontSize: 13,
                fontWeight: cell.isSelected ? 700 : 500, opacity: cell.isAvailable ? 1 : 0.35, width: "100%", padding: 0 }}>
              {cell.dayNumber}
            </button>
          )
        })}
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>
        Azul = día con datos. Seleccionado = cargado.
      </div>
    </div>
  )
}