/**
 * SnowcatCloud Schema Registry integration. The API key lives in <opensnowcatDir>/console.json (gitignored),
 * never in resolver.json. Enrich resolves through this console at <consoleRegistryUrl>/snowcatcloud, and the
 * console forwards to SnowcatCloud with the key.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { consoleConfig } from './config'

export const SNOWCAT_PROXY_SEGMENT = 'snowcatcloud'

function storePath(): string {
  return join(consoleConfig().opensnowcatDir, 'console.json')
}

export function snowcatRegistryUrl(): string {
  const c = useRuntimeConfig()
  return String(c.public.snowcatRegistryUrl ?? 'https://registry.ops.snowcatcloud.com/api').replace(/\/+$/, '')
}

export function snowcatProxyUrl(): string {
  return `${consoleConfig().consoleRegistryUrl}/${SNOWCAT_PROXY_SEGMENT}`
}

export function isSnowcatProxyUrl(uri: string): boolean {
  return uri.replace(/\/+$/, '') === snowcatProxyUrl()
}

export function isSnowcatDirectUrl(uri: string): boolean {
  try {
    const u = new URL(uri)
    const ref = new URL(snowcatRegistryUrl())
    return u.host === ref.host
  } catch {
    return false
  }
}

export async function readSnowcatKey(): Promise<string> {
  try {
    const json = JSON.parse(await fs.readFile(storePath(), 'utf8')) as { snowcatcloud?: { apikey?: unknown } }
    return typeof json.snowcatcloud?.apikey === 'string' ? json.snowcatcloud.apikey : ''
  } catch {
    return ''
  }
}

export async function writeSnowcatKey(apikey: string): Promise<void> {
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(await fs.readFile(storePath(), 'utf8'))
  } catch { /* new file */ }
  const next = { ...existing } as Record<string, unknown>
  if (apikey.trim()) next.snowcatcloud = { apikey: apikey.trim() }
  else delete next.snowcatcloud
  await fs.writeFile(storePath(), JSON.stringify(next, null, 2) + '\n', 'utf8')
}

/** Fetch a schema from SnowcatCloud with the stored (or given) key. Returns the upstream status and body text. */
export async function fetchFromSnowcat(path: string, apikey?: string): Promise<{ status: number, body: string, contentType: string }> {
  const key = (apikey ?? '').trim() || await readSnowcatKey()
  if (!key) return { status: 401, body: JSON.stringify({ message: 'No SnowcatCloud API key configured in the console' }), contentType: 'application/json' }
  const res = await fetch(`${snowcatRegistryUrl()}${path}`, { headers: { apikey: key, accept: 'application/json' }, signal: AbortSignal.timeout(12_000), redirect: 'follow' })
  return { status: res.status, body: await res.text(), contentType: res.headers.get('content-type') ?? 'application/json' }
}
