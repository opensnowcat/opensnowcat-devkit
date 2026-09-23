/**
 * Folder registries: directories the console serves to enrich as static Iglu registries.
 * The primary one ("local") is the mounted schemas directory. Extra folders are stored in
 * <opensnowcatDir>/console.json and served at <consoleRegistryUrl>/f/<id>.
 */
import { promises as fs, existsSync, statSync } from 'node:fs'
import { join, isAbsolute, resolve, dirname, sep } from 'node:path'
import { homedir } from 'node:os'
import { consoleConfig } from './config'
import { listSchemas, resolveRoot, schemasRoot } from './schemas'

export const LOCAL_FOLDER_ID = 'local'
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface FolderEntry {
  id: string
  path: string
}

export interface FolderInfo extends FolderEntry {
  root: string
  url: string
  primary: boolean
  exists: boolean
  display: string
  count: number
}

/** Where the console is allowed to browse: the host home mount (or the real home when not containerised) and the linked directory. */
export function browseRoots(): Array<{ label: string, path: string }> {
  const cfg = consoleConfig()
  const home = cfg.hostHomeMount || homedir()
  // The linked schema directory comes first: that is where people working inside the devkit keep their schemas.
  return [
    { label: 'Linked directory (schemas/)', path: resolve(cfg.schemasDir) },
    { label: cfg.hostHomePath ? `Home (${cfg.hostHomePath})` : 'Home', path: resolve(home) }
  ]
}

/** Turn a container path into what the user knows: /host/home/x → /Users/me/x. */
export function toDisplayPath(path: string): string {
  const cfg = consoleConfig()
  if (cfg.hostHomeMount && cfg.hostHomePath) {
    const mount = resolve(cfg.hostHomeMount)
    if (path === mount) return cfg.hostHomePath
    if (path.startsWith(mount + sep)) return cfg.hostHomePath.replace(/[\\/]+$/, '') + path.slice(mount.length)
  }
  return path
}

function withinRoots(path: string): boolean {
  const p = resolve(path)
  return browseRoots().some(r => p === r.path || p.startsWith(r.path + sep))
}

export interface BrowseEntry {
  name: string
  path: string
  display: string
  looksLikeRegistry: boolean
}

export interface BrowseResult {
  path: string
  display: string
  parent: string | null
  roots: Array<{ label: string, path: string }>
  dirs: BrowseEntry[]
  schemaCount: number
  error: string | null
}

const VENDOR_LIKE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/i

const SKIP_DIRS = new Set(['Library', 'Applications', 'node_modules', 'Music', 'Movies', 'Pictures', 'Photos Library.photoslibrary'])

async function dirNames(dir: string, limit: number): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const out: string[] = []
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) out.push(e.name)
      if (out.length >= limit) break
    }
    return out
  } catch {
    return []
  }
}

/** True when the folder holds <vendor>/<name>/jsonschema/ within its first vendor-like entries, or a schemas/ child that does. Cheap: at most a few dozen readdirs. */
async function looksLikeRegistry(dir: string, depth = 0): Promise<boolean> {
  if (depth === 0 && existsSync(join(dir, 'schemas')) && statSync(join(dir, 'schemas')).isDirectory() && await looksLikeRegistry(join(dir, 'schemas'), 1)) return true
  const vendors = (await dirNames(dir, 40)).filter(n => VENDOR_LIKE.test(n)).slice(0, 15)
  const checks = await Promise.all(vendors.map(async (v) => {
    const names = await dirNames(join(dir, v), 15)
    return names.some(n => existsSync(join(dir, v, n, 'jsonschema')))
  }))
  return checks.some(Boolean)
}

export async function browseDir(requested?: string): Promise<BrowseResult> {
  const roots = browseRoots()
  const path = requested && requested.trim() ? resolve(requested.trim()) : roots[0]!.path
  const base: BrowseResult = { path, display: toDisplayPath(path), parent: null, roots, dirs: [], schemaCount: 0, error: null }
  if (!withinRoots(path)) return { ...base, error: 'Outside the folders the console can see. Only your home directory (HOST_HOME) and the linked directory are browsable.' }
  if (!existsSync(path) || !statSync(path).isDirectory()) return { ...base, error: 'Folder not found.' }
  const isRoot = roots.some(r => r.path === path)
  base.parent = isRoot ? null : dirname(path)
  try {
    const entries = (await fs.readdir(path, { withFileTypes: true }))
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
      .slice(0, 300)
    const flags = await Promise.all(entries.map(e => looksLikeRegistry(join(path, e.name))))
    base.dirs = entries
      .map((e, i) => ({ name: e.name, path: join(path, e.name), display: toDisplayPath(join(path, e.name)), looksLikeRegistry: flags[i] ?? false }))
      .sort((a, b) => Number(b.looksLikeRegistry) - Number(a.looksLikeRegistry) || a.name.localeCompare(b.name))
    // Only walk for a count when this folder already looks like a registry; walking a home directory is slow.
    base.schemaCount = (await looksLikeRegistry(path)) ? (await listSchemas(resolveRoot(path))).count : 0
  } catch (e) {
    base.error = `Cannot read folder: ${(e as Error).message}`
  }
  return base
}

function storePath(): string {
  return join(consoleConfig().opensnowcatDir, 'console.json')
}

export function isValidFolderId(id: string): boolean {
  return id !== LOCAL_FOLDER_ID && ID_RE.test(id)
}

export function folderRegistryUrl(id: string): string {
  const base = consoleConfig().consoleRegistryUrl
  return id === LOCAL_FOLDER_ID ? base : `${base}/f/${id}`
}

/** Returns the folder id for a registry URI served by this console, or null. */
export function folderIdFromUrl(uri: string): string | null {
  const base = consoleConfig().consoleRegistryUrl
  const clean = uri.replace(/\/+$/, '')
  if (clean === base) return LOCAL_FOLDER_ID
  if (clean.startsWith(`${base}/f/`)) {
    const id = clean.slice(base.length + 3)
    return ID_RE.test(id) ? id : null
  }
  return null
}

export async function readFolders(): Promise<FolderEntry[]> {
  try {
    const raw = await fs.readFile(storePath(), 'utf8')
    const json = JSON.parse(raw) as { folders?: unknown }
    if (!Array.isArray(json.folders)) return []
    return json.folders
      .filter((f): f is FolderEntry => !!f && typeof f === 'object' && typeof (f as FolderEntry).id === 'string' && typeof (f as FolderEntry).path === 'string')
      .filter(f => isValidFolderId(f.id))
  } catch {
    return []
  }
}

export async function writeFolders(folders: FolderEntry[]): Promise<void> {
  const seen = new Set<string>()
  const clean: FolderEntry[] = []
  for (const f of folders) {
    const id = String(f.id ?? '').trim()
    const path = String(f.path ?? '').trim()
    if (!isValidFolderId(id)) throw createError({ statusCode: 400, statusMessage: `Invalid folder id "${id}". Use lowercase letters, digits and dashes.` })
    if (!path || !isAbsolute(path)) throw createError({ statusCode: 400, statusMessage: `Folder "${id}" needs an absolute path as seen from the console container (for example /schemas/extra)` })
    if (seen.has(id)) throw createError({ statusCode: 400, statusMessage: `Duplicate folder id "${id}"` })
    seen.add(id)
    clean.push({ id, path: resolve(path) })
  }
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(await fs.readFile(storePath(), 'utf8'))
  } catch { /* new file */ }
  await fs.writeFile(storePath(), JSON.stringify({ ...existing, folders: clean }, null, 2) + '\n', 'utf8')
}

export async function folderRoot(id: string): Promise<string> {
  if (!id || id === LOCAL_FOLDER_ID) return schemasRoot()
  const entry = (await readFolders()).find(f => f.id === id)
  if (!entry) throw createError({ statusCode: 404, statusMessage: `Unknown folder registry "${id}"` })
  return resolveRoot(entry.path)
}

export async function allFolders(): Promise<FolderInfo[]> {
  const cfg = consoleConfig()
  const localExists = existsSync(schemasRoot())
  const out: FolderInfo[] = [{ id: LOCAL_FOLDER_ID, path: cfg.schemasDir, root: schemasRoot(), url: folderRegistryUrl(LOCAL_FOLDER_ID), primary: true, exists: localExists, display: cfg.hostHomeMount ? 'Linked directory (schemas/)' : cfg.schemasDir, count: localExists ? (await listSchemas(schemasRoot())).count : 0 }]
  for (const f of await readFolders()) {
    const exists = existsSync(f.path) && statSync(f.path).isDirectory()
    out.push({ ...f, root: resolveRoot(f.path), url: folderRegistryUrl(f.id), primary: false, exists, display: toDisplayPath(f.path), count: exists ? (await listSchemas(resolveRoot(f.path))).count : 0 })
  }
  return out
}

export interface FolderCheck {
  path: string
  display: string
  exists: boolean
  isDirectory: boolean
  root: string
  count: number
  sample: string[]
  message: string
}

export async function checkFolder(path: string): Promise<FolderCheck> {
  const p = String(path ?? '').trim()
  const fail = (message: string, exists = false, isDirectory = false): FolderCheck => ({ path: p, display: toDisplayPath(p), exists, isDirectory, root: '', count: 0, sample: [], message })
  if (!p) return fail('Pick a folder with Browse, or type a path.')
  if (!isAbsolute(p)) return fail('Use an absolute path, or pick the folder with Browse.')
  if (!existsSync(p)) {
    return fail('The console cannot see this folder. Pick it with Browse: anything under your home directory is visible. To expose another location set HOST_HOME in .env and run make run again.')
  }
  if (!statSync(p).isDirectory()) return fail('That path is a file, not a folder.', true, false)
  const root = resolveRoot(p)
  const listing = await listSchemas(root)
  const sample = listing.vendors.flatMap(v => v.names.flatMap(n => n.versions.map(x => x.uri))).slice(0, 5)
  const message = listing.count
    ? `${listing.count} schema${listing.count === 1 ? '' : 's'} found${root !== p ? ' under schemas/' : ''}.`
    : 'Folder exists but holds no schemas in the Iglu layout (vendor/name/jsonschema/1-0-0).'
  return { path: p, display: toDisplayPath(p), exists: true, isDirectory: true, root, count: listing.count, sample, message }
}
