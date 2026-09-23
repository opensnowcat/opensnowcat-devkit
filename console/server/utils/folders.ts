/**
 * Folder registries: directories the console serves to enrich as static Iglu registries.
 * The primary one ("local") is the mounted schemas directory. Extra folders are stored in
 * <opensnowcatDir>/console.json and served at <consoleRegistryUrl>/f/<id>.
 */
import { promises as fs, existsSync, statSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'
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
  const out: FolderInfo[] = [{ id: LOCAL_FOLDER_ID, path: cfg.schemasDir, root: schemasRoot(), url: folderRegistryUrl(LOCAL_FOLDER_ID), primary: true, exists: existsSync(schemasRoot()) }]
  for (const f of await readFolders()) {
    out.push({ ...f, root: resolveRoot(f.path), url: folderRegistryUrl(f.id), primary: false, exists: existsSync(f.path) && statSync(f.path).isDirectory() })
  }
  return out
}

export interface FolderCheck {
  path: string
  exists: boolean
  isDirectory: boolean
  root: string
  count: number
  sample: string[]
  message: string
}

export async function checkFolder(path: string): Promise<FolderCheck> {
  const p = String(path ?? '').trim()
  if (!p) return { path: p, exists: false, isDirectory: false, root: '', count: 0, sample: [], message: 'Enter a folder path.' }
  if (!isAbsolute(p)) return { path: p, exists: false, isDirectory: false, root: '', count: 0, sample: [], message: 'Use an absolute path as the console container sees it.' }
  if (!existsSync(p)) {
    return { path: p, exists: false, isDirectory: false, root: '', count: 0, sample: [], message: 'Not visible from the console container. Mount it in docker-compose.yml under the console service, or put the schemas under the linked directory.' }
  }
  if (!statSync(p).isDirectory()) return { path: p, exists: true, isDirectory: false, root: '', count: 0, sample: [], message: 'That path is a file, not a folder.' }
  const root = resolveRoot(p)
  const listing = await listSchemas(root)
  const sample = listing.vendors.flatMap(v => v.names.flatMap(n => n.versions.map(x => x.uri))).slice(0, 5)
  const message = listing.count
    ? `${listing.count} schema${listing.count === 1 ? '' : 's'} found${root !== p ? ' under schemas/' : ''}.`
    : 'Folder exists but holds no schemas in the Iglu layout (vendor/name/jsonschema/1-0-0).'
  return { path: p, exists: true, isDirectory: true, root, count: listing.count, sample, message }
}
