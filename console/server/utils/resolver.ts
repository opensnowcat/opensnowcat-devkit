import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { consoleConfig } from './config'
import { parseIgluUri } from './enriched'
import { readSchema, validateRef } from './schemas'
import { folderIdFromUrl, folderRoot } from './folders'

export interface RegistryConnection {
  http?: { uri: string, apikey?: string }
  embedded?: { path: string }
}

export interface Registry {
  name: string
  priority: number
  vendorPrefixes: string[]
  connection: RegistryConnection
}

export interface ResolverDoc {
  schema: string
  data: {
    cacheSize: number
    cacheTtl?: number
    repositories: Registry[]
  }
}

export function resolverPath(): string {
  return join(consoleConfig().opensnowcatDir, 'resolver.json')
}

export async function readResolver(): Promise<{ doc: ResolverDoc, raw: string, path: string, mtimeMs: number }> {
  const path = resolverPath()
  let raw: string
  let mtimeMs: number
  try {
    raw = await fs.readFile(path, 'utf8')
    mtimeMs = (await fs.stat(path)).mtimeMs
  } catch {
    throw createError({ statusCode: 404, statusMessage: `resolver.json not found at ${path}` })
  }
  let doc: ResolverDoc
  try {
    doc = JSON.parse(raw)
  } catch (e) {
    throw createError({ statusCode: 500, statusMessage: `resolver.json is not valid JSON: ${(e as Error).message}` })
  }
  return { doc: normalizeResolver(doc), raw, path, mtimeMs }
}

export function normalizeResolver(input: unknown): ResolverDoc {
  const doc = (input ?? {}) as Partial<ResolverDoc>
  const data = (doc.data ?? {}) as Partial<ResolverDoc['data']>
  const repos = Array.isArray(data.repositories) ? data.repositories : []
  const repositories: Registry[] = repos.map((r, i) => {
    const reg = (r ?? {}) as Partial<Registry>
    const conn = (reg.connection ?? {}) as RegistryConnection
    if (!reg.name || typeof reg.name !== 'string') throw createError({ statusCode: 400, statusMessage: `Registry #${i + 1} needs a name` })
    if (!conn.http?.uri && !conn.embedded?.path) throw createError({ statusCode: 400, statusMessage: `Registry "${reg.name}" needs an http uri or an embedded path` })
    const connection: RegistryConnection = conn.http
      ? { http: { uri: String(conn.http.uri).replace(/\/+$/, ''), ...(conn.http.apikey ? { apikey: String(conn.http.apikey) } : {}) } }
      : { embedded: { path: String(conn.embedded!.path) } }
    return {
      name: reg.name,
      priority: Number.isFinite(Number(reg.priority)) ? Number(reg.priority) : 0,
      vendorPrefixes: Array.isArray(reg.vendorPrefixes) ? reg.vendorPrefixes.map(String).filter(Boolean) : [],
      connection
    }
  })
  const cacheSize = Number.isFinite(Number(data.cacheSize)) ? Math.max(0, Number(data.cacheSize)) : 0
  const cacheTtl = data.cacheTtl == null ? undefined : Math.max(0, Number(data.cacheTtl))
  return {
    schema: typeof doc.schema === 'string' ? doc.schema : 'iglu:com.snowplowanalytics.iglu/resolver-config/jsonschema/1-0-3',
    data: { cacheSize, ...(cacheTtl != null ? { cacheTtl } : {}), repositories }
  }
}

export async function writeResolver(doc: ResolverDoc): Promise<{ path: string, mtimeMs: number }> {
  const normalized = normalizeResolver(doc)
  if (!normalized.data.repositories.length) throw createError({ statusCode: 400, statusMessage: 'At least one registry is required' })
  const path = resolverPath()
  await fs.writeFile(path, JSON.stringify(normalized, null, 2) + '\n', 'utf8')
  const st = await fs.stat(path)
  return { path, mtimeMs: st.mtimeMs }
}

/** Mirrors the Iglu client: registries whose vendor prefix matches come first, then everything else, each group ordered by priority. */
export function orderRegistries(registries: Registry[], vendor: string): Registry[] {
  const matches = (r: Registry) => r.vendorPrefixes.some(p => vendor.startsWith(p))
  const byPriority = (a: Registry, b: Registry) => a.priority - b.priority
  return [...registries.filter(matches).sort(byPriority), ...registries.filter(r => !matches(r)).sort(byPriority)]
}

export interface ResolveAttempt {
  registry: string
  uri: string | null
  kind: 'http' | 'embedded' | 'local'
  status: 'found' | 'not-found' | 'error' | 'skipped'
  httpStatus?: number
  durationMs?: number
  message?: string
  matchedPrefix: boolean
}

export interface ResolveResult {
  schemaUri: string
  found: boolean
  resolvedBy: string | null
  attempts: ResolveAttempt[]
  schema?: unknown
}

export async function resolveTest(schemaUri: string): Promise<ResolveResult> {
  const key = parseIgluUri(schemaUri)
  if (!key) throw createError({ statusCode: 400, statusMessage: 'Expected an Iglu URI like iglu:com.acme/my_event/jsonschema/1-0-0' })
  const { doc } = await readResolver()
  const ordered = orderRegistries(doc.data.repositories, key.vendor)
  const attempts: ResolveAttempt[] = []
  let found = false
  let resolvedBy: string | null = null
  let schema: unknown
  for (const reg of ordered) {
    const matchedPrefix = reg.vendorPrefixes.some(p => key.vendor.startsWith(p))
    if (found) {
      attempts.push({ registry: reg.name, uri: reg.connection.http?.uri ?? null, kind: reg.connection.http ? 'http' : 'embedded', status: 'skipped', matchedPrefix, message: 'Not consulted, schema already resolved' })
      continue
    }
    if (reg.connection.embedded) {
      attempts.push({ registry: reg.name, uri: null, kind: 'embedded', status: 'skipped', matchedPrefix, message: 'Embedded registries live inside the enrich JAR and cannot be checked from here' })
      continue
    }
    const base = reg.connection.http!.uri
    const folderId = folderIdFromUrl(base)
    const started = Date.now()
    if (folderId) {
      try {
        const file = await readSchema(await folderRoot(folderId), validateRef(key))
        schema = JSON.parse(file.content)
        found = true
        resolvedBy = reg.name
        attempts.push({ registry: reg.name, uri: base, kind: 'local', status: 'found', durationMs: Date.now() - started, matchedPrefix, message: file.path })
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        attempts.push({ registry: reg.name, uri: base, kind: 'local', status: code === 404 ? 'not-found' : 'error', durationMs: Date.now() - started, matchedPrefix, message: code === 404 ? 'No such file in the linked schema directory' : String((e as Error).message ?? e) })
      }
      continue
    }
    const url = `${base}/schemas/${key.vendor}/${key.name}/${key.format}/${key.version}`
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 6_000)
      const headers: Record<string, string> = { accept: 'application/json' }
      if (reg.connection.http?.apikey) headers.apikey = reg.connection.http.apikey
      const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' })
      clearTimeout(timer)
      const durationMs = Date.now() - started
      if (res.ok) {
        const body = await res.json().catch(() => null)
        if (body && typeof body === 'object' && 'self' in (body as object)) {
          found = true
          resolvedBy = reg.name
          schema = body
          attempts.push({ registry: reg.name, uri: url, kind: 'http', status: 'found', httpStatus: res.status, durationMs, matchedPrefix })
        } else {
          attempts.push({ registry: reg.name, uri: url, kind: 'http', status: 'error', httpStatus: res.status, durationMs, matchedPrefix, message: 'Response is not a self-describing schema' })
        }
      } else {
        attempts.push({ registry: reg.name, uri: url, kind: 'http', status: res.status === 404 ? 'not-found' : 'error', httpStatus: res.status, durationMs, matchedPrefix })
      }
    } catch (e) {
      attempts.push({ registry: reg.name, uri: url, kind: 'http', status: 'error', durationMs: Date.now() - started, matchedPrefix, message: (e as Error).name === 'AbortError' ? 'Timed out after 6s' : String((e as Error).message ?? e) })
    }
  }
  return { schemaUri, found, resolvedBy, attempts, schema }
}
