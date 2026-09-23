/**
 * Check a SnowcatCloud Schema Registry API key: is it authorized, and can we pull a schema through it?
 * Same calls enrich makes, so a green result here means enrich will resolve from it.
 * With no key in the body, the key saved in the console is used.
 */
interface TestResult {
  ok: boolean
  authorized: boolean
  pulled: boolean
  status: number | null
  count: number
  vendors: string[]
  sample: string[]
  pulledUri: string | null
  message: string
  durationMs: number
}

export default defineEventHandler(async (event): Promise<TestResult> => {
  const body = await readBody<{ apikey?: string }>(event)
  const apikey = String(body?.apikey ?? '').trim() || await readSnowcatKey()
  const uri = snowcatRegistryUrl()
  const started = Date.now()
  const base: TestResult = { ok: false, authorized: false, pulled: false, status: null, count: 0, vendors: [], sample: [], pulledUri: null, message: '', durationMs: 0 }
  if (!apikey) return { ...base, message: 'Paste your SnowcatCloud registry API key first.' }

  try {
    const list = await fetchFromSnowcat('/schemas', apikey)
    base.status = list.status
    if (list.status === 401 || list.status === 403) {
      let msg: string | null = null
      try {
        msg = (JSON.parse(list.body) as { message?: string }).message ?? null
      } catch { /* not json */ }
      return { ...base, message: msg ? `Not authorized: ${msg}` : 'Not authorized. Check the key.', durationMs: Date.now() - started }
    }
    if (list.status < 200 || list.status >= 300) return { ...base, message: `Registry answered HTTP ${list.status}`, durationMs: Date.now() - started }
    let uris: unknown = []
    try {
      uris = JSON.parse(list.body)
    } catch { /* ignore */ }
    const schemas = Array.isArray(uris) ? uris.filter((u): u is string => typeof u === 'string' && u.startsWith('iglu:')) : []
    base.authorized = true
    base.count = schemas.length
    base.vendors = [...new Set(schemas.map(u => u.slice(5).split('/')[0]!).filter(Boolean))].sort()
    base.sample = schemas.slice(0, 5)
    if (!schemas.length) {
      return { ...base, ok: true, message: 'Key is authorized, but it can see no schemas yet. Publish some in SnowcatCloud or check the key permissions.', durationMs: Date.now() - started }
    }
    const first = schemas[0]!.slice(5)
    const pull = await fetchFromSnowcat(`/schemas/${first}`, apikey)
    if (pull.status >= 200 && pull.status < 300) {
      try {
        const doc = JSON.parse(pull.body) as { self?: unknown, $schema?: unknown }
        base.pulled = !!doc && typeof doc === 'object' && ('self' in doc || '$schema' in doc)
      } catch { /* not json */ }
      base.pulledUri = schemas[0]!
    }
    const vendorText = base.vendors.length === 1 ? `vendor ${base.vendors[0]}` : `${base.vendors.length} vendors`
    return {
      ...base,
      ok: base.pulled,
      message: base.pulled
        ? `Authorized. ${base.count} schema${base.count === 1 ? '' : 's'} across ${vendorText}, and pulling ${schemas[0]} worked.`
        : `Authorized and ${base.count} schemas listed, but pulling ${schemas[0]} failed (HTTP ${pull.status}).`,
      durationMs: Date.now() - started
    }
  } catch (e) {
    const msg = (e as Error).name === 'TimeoutError' ? 'Timed out after 12s' : ((e as Error).message ?? String(e))
    return { ...base, message: `Could not reach ${uri}: ${msg}`, durationMs: Date.now() - started }
  }
})
