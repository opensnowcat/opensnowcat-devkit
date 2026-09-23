export type RegistryKind = 'folder' | 'snowcatcloud' | 'http' | 'embedded'

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

export interface KeyCheck {
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

export interface RegistryRow {
  uid: string
  name: string
  priority: number
  vendorPrefixes: string[]
  kind: RegistryKind
  folderId: string
  path: string
  display?: string
  uri: string
  apikey: string
  embeddedPath: string
  keySaved?: boolean
  keyCheck?: KeyCheck | null
  check?: FolderCheck | null
  isNew?: boolean
}

export interface RegistryContext {
  snowcatUrl: string
  snowcatSignup: string
  snowcatConfigured: boolean
  localPath: string
  hasLocal: boolean
  hasSnowcat: boolean
  folderUrl: (id: string) => string
  slug: (name: string) => string
}

export const KIND_LABEL: Record<RegistryKind, string> = {
  folder: 'Folder served by this console',
  snowcatcloud: 'SnowcatCloud Schema Registry',
  http: 'HTTP registry',
  embedded: 'Embedded in enrich'
}

export const KIND_ICON: Record<RegistryKind, string> = {
  folder: 'i-lucide-folder-open',
  snowcatcloud: 'i-lucide-cloud',
  http: 'i-lucide-globe',
  embedded: 'i-lucide-package'
}

export function emptyRow(kind: RegistryKind = 'http'): RegistryRow {
  return { uid: Math.random().toString(36).slice(2), name: '', priority: 0, vendorPrefixes: [], kind, folderId: '', path: '', uri: '', apikey: '', embeddedPath: '', keyCheck: null, check: null, isNew: true }
}
