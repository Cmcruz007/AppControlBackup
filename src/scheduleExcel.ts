import * as XLSX from 'xlsx-js-style'

type ScheduleRow = {
  job: string
  date: string
}

type ScheduleResponse = {
  ok?: boolean
  rows?: ScheduleRow[]
  error?: string
}

type DayInfo = {
  key: string
  date: Date
  labelDow: string
  labelDate: string
}

const DOW_ES = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

function p2(n: number): string {
  return String(n).padStart(2, '0')
}

function toLocalDate(iso: string): Date {
  return new Date(iso)
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

function formatHour(iso: string): string {
  const d = toLocalDate(iso)
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

function buildDays(rows: ScheduleRow[]): DayInfo[] {
  const map = new Map<string, Date>()

  for (const r of rows) {
    const d = toLocalDate(r.date)
    map.set(dayKey(d), new Date(d.getFullYear(), d.getMonth(), d.getDate()))
  }

  return [...map.entries()]
    .sort((a, b) => a[1].getTime() - b[1].getTime())
    .map(([key, date]) => ({
      key,
      date,
      labelDow: DOW_ES[date.getDay()],
      labelDate: `${p2(date.getDate())}/${p2(date.getMonth() + 1)}`,
    }))
}

function buildJobMap(rows: ScheduleRow[]) {
  const jobs = Array.from(new Set(rows.map((r) => r.job))).sort((a, b) =>
    a.localeCompare(b, 'es', { sensitivity: 'base' })
  )

  const matrix = new Map<string, Map<string, string[]>>()

  for (const job of jobs) {
    matrix.set(job, new Map())
  }

  for (const r of rows) {
    const d = toLocalDate(r.date)
    const dk = dayKey(d)
    const time = formatHour(r.date)

    if (!matrix.has(r.job)) {
      matrix.set(r.job, new Map())
    }

    const byDay = matrix.get(r.job)!
    const arr = byDay.get(dk) || []
    arr.push(time)
    arr.sort()
    byDay.set(dk, arr)
  }

  return { jobs, matrix }
}

function makeCell(
  v: string | number,
  opts: {
    bg?: string
    fg?: string
    bold?: boolean
    align?: 'left' | 'center' | 'right'
    borderColor?: string
    fontSize?: number
    wrap?: boolean
  } = {}
) {
  return {
    v,
    t: typeof v === 'number' ? ('n' as const) : ('s' as const),
    s: {
      fill: { patternType: 'solid', fgColor: { rgb: opts.bg || 'FF0F172A' } },
      font: {
        bold: !!opts.bold,
        color: { rgb: opts.fg || 'FFF1F5F9' },
        sz: opts.fontSize || 10,
        name: 'Calibri',
      },
      alignment: {
        horizontal: opts.align || 'center',
        vertical: 'center',
        wrapText: !!opts.wrap,
      },
      border: {
        top: { style: 'thin', color: { rgb: opts.borderColor || 'FF334155' } },
        bottom: { style: 'thin', color: { rgb: opts.borderColor || 'FF334155' } },
        left: { style: 'thin', color: { rgb: opts.borderColor || 'FF334155' } },
        right: { style: 'thin', color: { rgb: opts.borderColor || 'FF334155' } },
      },
    },
  } as any
}

export async function exportScheduleExcel(getter: () => Promise<ScheduleResponse>): Promise<void> {
  const res = await getter()

  if (!res?.ok || !res.rows?.length) {
    alert(res?.error ?? 'No hay datos de planificación')
    return
  }

  const rows = res.rows
  const days = buildDays(rows)
  const { jobs, matrix } = buildJobMap(rows)

  const totalJobs = jobs.length
  const totalExecutions = rows.length
  const generatedAt = new Date()

  const dayCounts = days.map((d) =>
    rows.reduce((acc, r) => {
      const rd = toLocalDate(r.date)
      return acc + (dayKey(rd) === d.key ? 1 : 0)
    }, 0)
  )

  const wb = XLSX.utils.book_new()

  const BG_TOP = 'FF111827'
  const BG_HDR = 'FF1E3A5F'
  const BG_HDR2 = 'FF17324D'
  const BG_LEFT = 'FF0F172A'
  const BG_LEFT_ALT = 'FF172033'
  const BG_GRID = 'FF101A2B'
  const BG_GRID_ALT = 'FF162235'
  const BG_HIT = 'FFD9F99D'
  const FG_TOP = 'FFFBBF24'
  const FG_TEXT = 'FFF1F5F9'
  const FG_SOFT = 'FF93C5FD'
  const FG_DARK = 'FF0F172A'
  const BORDER = 'FF334155'

  const totalCols = 1 + days.length
  const aoa: any[][] = []

  const titleRow = new Array(totalCols).fill(makeCell('', { bg: BG_TOP, borderColor: BG_TOP }))
  titleRow[0] = makeCell(
    `PLANIFICADOR DE BACKUPS — PRÓXIMOS ${days.length} DÍAS · Generado ${p2(
      generatedAt.getDate()
    )}/${p2(generatedAt.getMonth() + 1)}/${generatedAt.getFullYear()} ${p2(
      generatedAt.getHours()
    )}:${p2(generatedAt.getMinutes())}`,
    {
      bg: BG_TOP,
      fg: FG_TOP,
      bold: true,
      align: 'left',
      fontSize: 14,
      borderColor: BG_TOP,
    }
  )
  aoa.push(titleRow)

  const summaryRow = new Array(totalCols).fill(makeCell('', { bg: BG_TOP, borderColor: BG_TOP }))
  summaryRow[0] = makeCell(
    `${totalJobs} jobs · ${totalExecutions} ejecuciones en ${days.length} días`,
    {
      bg: BG_TOP,
      fg: FG_TEXT,
      align: 'left',
      fontSize: 10,
      borderColor: BG_TOP,
    }
  )
  aoa.push(summaryRow)

  const countsRow: any[] = [
    makeCell('Número de ejecuciones', {
      bg: BG_HDR,
      fg: FG_SOFT,
      bold: true,
      align: 'center',
      fontSize: 10,
      borderColor: 'FF60A5FA',
    }),
  ]
  for (const count of dayCounts) {
    const bg =
      count >= 60 ? 'FF166534' : count >= 45 ? 'FF22C55E' : count >= 25 ? 'FF4ADE80' : 'FF86EFAC'
    countsRow.push(
      makeCell(count, {
        bg,
        fg: FG_DARK,
        bold: true,
        align: 'center',
        fontSize: 10,
        borderColor: BORDER,
      })
    )
  }
  aoa.push(countsRow)

  const dowRow: any[] = [
    makeCell('Fecha', {
      bg: BG_HDR,
      fg: FG_SOFT,
      bold: true,
      align: 'center',
      fontSize: 10,
      borderColor: 'FF60A5FA',
    }),
  ]
  for (const d of days) {
    dowRow.push(
      makeCell(d.labelDow, {
        bg: BG_HDR2,
        fg: FG_SOFT,
        bold: true,
        align: 'center',
        fontSize: 10,
      })
    )
  }
  aoa.push(dowRow)

  const dateRow: any[] = [
    makeCell('', {
      bg: BG_HDR,
      fg: FG_SOFT,
      bold: true,
      align: 'center',
      fontSize: 10,
      borderColor: 'FF60A5FA',
    }),
  ]
  for (const d of days) {
    dateRow.push(
      makeCell(d.labelDate, {
        bg: BG_HDR2,
        fg: FG_SOFT,
        bold: true,
        align: 'center',
        fontSize: 10,
      })
    )
  }
  aoa.push(dateRow)

  jobs.forEach((job, rowIndex) => {
    const leftBg = rowIndex % 2 === 0 ? BG_LEFT : BG_LEFT_ALT
    const gridBg = rowIndex % 2 === 0 ? BG_GRID : BG_GRID_ALT
    const byDay = matrix.get(job) || new Map<string, string[]>()

    const row: any[] = [
      makeCell(job, {
        bg: leftBg,
        fg: FG_TEXT,
        align: 'left',
        fontSize: 9,
      }),
    ]

    for (const d of days) {
      const hits = byDay.get(d.key) || []
      row.push(
        makeCell(hits.join(' / '), {
          bg: hits.length ? BG_HIT : gridBg,
          fg: hits.length ? FG_DARK : FG_TEXT,
          bold: hits.length > 0,
          align: 'center',
          fontSize: 9,
          wrap: true,
        })
      )
    }

    aoa.push(row)
  })

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  ws['!cols'] = [{ wch: 42 }, ...days.map(() => ({ wch: 10 }))]
  ws['!rows'] = [
    { hpt: 24 },
    { hpt: 18 },
    { hpt: 22 },
    { hpt: 18 },
    { hpt: 18 },
    ...jobs.map(() => ({ hpt: 20 })),
  ]

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
  ]

  ws['!freeze'] = { xSplit: 1, ySplit: 5 }

  XLSX.utils.book_append_sheet(wb, ws, 'Planificador 30 días')

  XLSX.writeFile(
    wb,
    `planificador_30dias_${generatedAt.getFullYear()}${p2(generatedAt.getMonth() + 1)}${p2(
      generatedAt.getDate()
    )}.xlsx`
  )
}