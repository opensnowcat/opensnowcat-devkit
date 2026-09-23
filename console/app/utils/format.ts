export function fmtTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

export function pretty(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

export function igluParts(uri: string | null | undefined): { vendor: string, name: string, format: string, version: string } | null {
  if (!uri) return null
  const m = /^iglu:([^/]+)\/([^/]+)\/([^/]+)\/(\d+-\d+-\d+)$/.exec(uri)
  return m ? { vendor: m[1]!, name: m[2]!, format: m[3]!, version: m[4]! } : null
}

export function igluShort(uri: string | null | undefined): string {
  const p = igluParts(uri)
  return p ? `${p.name} ${p.version}` : (uri ?? '')
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
