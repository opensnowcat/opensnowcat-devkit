import { promises as fs, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Ajv04 from 'ajv-draft-04'
import addFormats from 'ajv-formats'
import { consoleConfig } from './config'

export interface SchemaRef {
  vendor: string
  name: string
  format: string
  version: string
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const VERSION = /^\d+-\d+-\d+$/
export const SELF_DESC_META = 'http://iglucentral.com/schemas/com.snowplowanalytics.self-desc/schema/jsonschema/1-0-0#'

export function schemasRoot(): string {
  const base = consoleConfig().schemasDir
  const nested = join(base, 'schemas')
  if (existsSync(nested) && statSync(nested).isDirectory()) return nested
  return base
}

export function validateRef(ref: Partial<SchemaRef>): SchemaRef {
  const { vendor, name, format = 'jsonschema', version } = ref
  if (!vendor || !SEGMENT.test(vendor) || vendor.includes('..')) throw createError({ statusCode: 400, statusMessage: 'Invalid vendor' })
  if (!name || !SEGMENT.test(name) || name.includes('..')) throw createError({ statusCode: 400, statusMessage: 'Invalid schema name' })
  if (!SEGMENT.test(format) || format.includes('..')) throw createError({ statusCode: 400, statusMessage: 'Invalid format' })
  if (!version || !VERSION.test(version)) throw createError({ statusCode: 400, statusMessage: 'Invalid version, expected MODEL-REVISION-ADDITION like 1-0-0' })
  return { vendor, name, format, version }
}

export function schemaPath(ref: SchemaRef): string {
  return join(schemasRoot(), ref.vendor, ref.name, ref.format, ref.version)
}

export function igluUri(ref: SchemaRef): string {
  return `iglu:${ref.vendor}/${ref.name}/${ref.format}/${ref.version}`
}

export interface SchemaVersionEntry {
  version: string
  format: string
  size: number
  mtimeMs: number
  uri: string
}

export interface SchemaNameEntry {
  name: string
  versions: SchemaVersionEntry[]
}

export interface SchemaVendorEntry {
  vendor: string
  names: SchemaNameEntry[]
}

export interface SchemaListing {
  root: string
  vendors: SchemaVendorEntry[]
  count: number
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path, { withFileTypes: true })
    return entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort()
  } catch {
    return []
  }
}

function versionSort(a: string, b: string): number {
  const pa = a.split('-').map(Number)
  const pb = b.split('-').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}

export async function listSchemas(): Promise<SchemaListing> {
  const root = schemasRoot()
  const vendors: SchemaVendorEntry[] = []
  let count = 0
  for (const vendor of await listDirs(root)) {
    if (!SEGMENT.test(vendor)) continue
    const names: SchemaNameEntry[] = []
    for (const name of await listDirs(join(root, vendor))) {
      if (!SEGMENT.test(name)) continue
      const versions: SchemaVersionEntry[] = []
      for (const format of await listDirs(join(root, vendor, name))) {
        let files: string[] = []
        try {
          files = (await fs.readdir(join(root, vendor, name, format), { withFileTypes: true }))
            .filter(e => e.isFile() && VERSION.test(e.name)).map(e => e.name)
        } catch { /* ignore */ }
        for (const version of files.sort(versionSort)) {
          const st = await fs.stat(join(root, vendor, name, format, version))
          versions.push({ version, format, size: st.size, mtimeMs: st.mtimeMs, uri: igluUri({ vendor, name, format, version }) })
          count++
        }
      }
      if (versions.length) names.push({ name, versions })
    }
    if (names.length) vendors.push({ vendor, names })
  }
  return { root, vendors, count }
}

export async function readSchema(ref: SchemaRef): Promise<{ content: string, mtimeMs: number, path: string }> {
  const path = schemaPath(ref)
  try {
    const [content, st] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
    return { content, mtimeMs: st.mtimeMs, path }
  } catch {
    throw createError({ statusCode: 404, statusMessage: `Schema ${igluUri(ref)} not found` })
  }
}

export async function writeSchema(ref: SchemaRef, content: string, expectedMtimeMs?: number): Promise<{ mtimeMs: number, path: string }> {
  const path = schemaPath(ref)
  if (expectedMtimeMs != null) {
    try {
      const st = await fs.stat(path)
      if (Math.abs(st.mtimeMs - expectedMtimeMs) > 1) {
        throw createError({ statusCode: 409, statusMessage: 'File changed on disk since it was opened. Reload before saving.' })
      }
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 409) throw e
    }
  }
  await fs.mkdir(join(schemasRoot(), ref.vendor, ref.name, ref.format), { recursive: true })
  await fs.writeFile(path, content.endsWith('\n') ? content : content + '\n', 'utf8')
  const st = await fs.stat(path)
  return { mtimeMs: st.mtimeMs, path }
}

export async function deleteSchema(ref: SchemaRef): Promise<void> {
  const path = schemaPath(ref)
  try {
    await fs.unlink(path)
  } catch {
    throw createError({ statusCode: 404, statusMessage: `Schema ${igluUri(ref)} not found` })
  }
  // prune empty parents (format, name, vendor)
  for (const dir of [join(schemasRoot(), ref.vendor, ref.name, ref.format), join(schemasRoot(), ref.vendor, ref.name), join(schemasRoot(), ref.vendor)]) {
    try {
      const entries = await fs.readdir(dir)
      if (entries.length === 0) await fs.rmdir(dir)
      else break
    } catch {
      break
    }
  }
}

export function templateSchema(ref: SchemaRef, description = ''): string {
  const doc = {
    $schema: SELF_DESC_META,
    description: description || `Schema for ${ref.name}`,
    self: { vendor: ref.vendor, name: ref.name, format: ref.format, version: ref.version },
    type: 'object',
    properties: {
      example: { type: 'string', description: 'Replace me', maxLength: 255 }
    },
    required: ['example'],
    additionalProperties: false
  }
  return JSON.stringify(doc, null, 2) + '\n'
}

export interface LintIssue {
  level: 'error' | 'warning'
  message: string
  path?: string
}

export interface LintResult {
  valid: boolean
  errors: LintIssue[]
  warnings: LintIssue[]
}

type AnyRecord = Record<string, unknown>
const isObj = (v: unknown): v is AnyRecord => !!v && typeof v === 'object' && !Array.isArray(v)

function walkProperties(node: unknown, path: string, warnings: LintIssue[], depth = 0) {
  if (!isObj(node) || depth > 20) return
  const type = node.type
  const types = Array.isArray(type) ? type : (typeof type === 'string' ? [type] : [])
  if (types.includes('object') && isObj(node.properties)) {
    if (node.additionalProperties !== false) {
      warnings.push({ level: 'warning', path, message: 'Object allows additional properties. Set "additionalProperties": false so loaders can create stable columns.' })
    }
    for (const [key, child] of Object.entries(node.properties)) walkProperties(child, `${path}.${key}`, warnings, depth + 1)
  }
  if (types.includes('string') && node.maxLength == null && node.enum == null && node.format == null) {
    warnings.push({ level: 'warning', path, message: 'String has no "maxLength". Warehouse loaders need a bound to size the column.' })
  }
  if (!types.length && node.enum == null && node.$ref == null && node.oneOf == null && node.anyOf == null && node.allOf == null && depth > 0) {
    warnings.push({ level: 'warning', path, message: 'Property has no "type".' })
  }
  if (types.includes('array') && isObj(node.items)) walkProperties(node.items, `${path}[]`, warnings, depth + 1)
}

export function lintSchema(ref: SchemaRef, content: string): LintResult {
  const errors: LintIssue[] = []
  const warnings: LintIssue[] = []
  let doc: unknown
  try {
    doc = JSON.parse(content)
  } catch (e) {
    return { valid: false, errors: [{ level: 'error', message: `Not valid JSON: ${(e as Error).message}` }], warnings }
  }
  if (!isObj(doc)) return { valid: false, errors: [{ level: 'error', message: 'Schema must be a JSON object' }], warnings }

  const self = doc.self
  if (!isObj(self)) {
    errors.push({ level: 'error', path: 'self', message: 'Missing "self" block with vendor, name, format and version' })
  } else {
    const expect: Array<[keyof SchemaRef, string]> = [['vendor', ref.vendor], ['name', ref.name], ['format', ref.format], ['version', ref.version]]
    for (const [key, value] of expect) {
      if (self[key] !== value) errors.push({ level: 'error', path: `self.${key}`, message: `self.${key} is "${String(self[key] ?? '')}" but the file path says "${value}"` })
    }
  }
  if (typeof doc.$schema !== 'string') {
    warnings.push({ level: 'warning', path: '$schema', message: `Missing "$schema". Iglu expects ${SELF_DESC_META}` })
  } else if (doc.$schema !== SELF_DESC_META) {
    warnings.push({ level: 'warning', path: '$schema', message: `"$schema" should be ${SELF_DESC_META}` })
  }
  if (typeof doc.description !== 'string' || !doc.description.trim()) warnings.push({ level: 'warning', path: 'description', message: 'Add a "description" so people know what this schema is for.' })
  const rootTypes = Array.isArray(doc.type) ? doc.type : (typeof doc.type === 'string' ? [doc.type] : [])
  if (!rootTypes.includes('object')) warnings.push({ level: 'warning', path: 'type', message: 'Root "type" is usually "object" for event and entity schemas.' })
  walkProperties(doc, '$', warnings)

  const { $schema: _s, self: _self, ...compilable } = doc
  try {
    const ajv = new Ajv04({ strict: false, allErrors: true })
    addFormats(ajv)
    ajv.compile(compilable)
  } catch (e) {
    errors.push({ level: 'error', message: `JSON Schema (draft-04) compile error: ${(e as Error).message}` })
  }
  return { valid: errors.length === 0, errors, warnings }
}

export function validateAgainstSchema(content: string, data: unknown): { valid: boolean, errors: string[] } {
  let doc: unknown
  try {
    doc = JSON.parse(content)
  } catch (e) {
    return { valid: false, errors: [`Schema is not valid JSON: ${(e as Error).message}`] }
  }
  if (!isObj(doc)) return { valid: false, errors: ['Schema must be an object'] }
  const { $schema: _s, self: _self, ...compilable } = doc
  const ajv = new Ajv04({ strict: false, allErrors: true })
  addFormats(ajv)
  const validate = ajv.compile(compilable)
  const ok = validate(data)
  return { valid: !!ok, errors: (validate.errors ?? []).map(e => `${e.instancePath || '$'} ${e.message ?? 'invalid'}`) }
}
