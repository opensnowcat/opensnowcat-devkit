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

/** If <base>/schemas exists, that is the registry root (repo-style layout); otherwise <base> itself. */
export function resolveRoot(base: string): string {
  const nested = join(base, 'schemas')
  if (existsSync(nested) && statSync(nested).isDirectory()) return nested
  return base
}

export function schemasRoot(): string {
  return resolveRoot(consoleConfig().schemasDir)
}

export function validateRef(ref: Partial<SchemaRef>): SchemaRef {
  const { vendor, name, format = 'jsonschema', version } = ref
  if (!vendor || !SEGMENT.test(vendor) || vendor.includes('..')) throw createError({ statusCode: 400, statusMessage: 'Invalid vendor' })
  if (!name || !SEGMENT.test(name) || name.includes('..')) throw createError({ statusCode: 400, statusMessage: 'Invalid schema name' })
  if (!SEGMENT.test(format) || format.includes('..')) throw createError({ statusCode: 400, statusMessage: 'Invalid format' })
  if (!version || !VERSION.test(version)) throw createError({ statusCode: 400, statusMessage: 'Invalid version, expected MODEL-REVISION-ADDITION like 1-0-0' })
  return { vendor, name, format, version }
}

export function schemaPath(root: string, ref: SchemaRef): string {
  return join(root, ref.vendor, ref.name, ref.format, ref.version)
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

export async function listSchemas(root: string): Promise<SchemaListing> {
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

export async function readSchema(root: string, ref: SchemaRef): Promise<{ content: string, mtimeMs: number, path: string }> {
  const path = schemaPath(root, ref)
  try {
    const [content, st] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
    return { content, mtimeMs: st.mtimeMs, path }
  } catch {
    throw createError({ statusCode: 404, statusMessage: `Schema ${igluUri(ref)} not found` })
  }
}

export async function writeSchema(root: string, ref: SchemaRef, content: string, expectedMtimeMs?: number): Promise<{ mtimeMs: number, path: string }> {
  const path = schemaPath(root, ref)
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
  await fs.mkdir(join(root, ref.vendor, ref.name, ref.format), { recursive: true })
  await fs.writeFile(path, content.endsWith('\n') ? content : content + '\n', 'utf8')
  const st = await fs.stat(path)
  return { mtimeMs: st.mtimeMs, path }
}

export async function deleteSchema(root: string, ref: SchemaRef): Promise<void> {
  const path = schemaPath(root, ref)
  try {
    await fs.unlink(path)
  } catch {
    throw createError({ statusCode: 404, statusMessage: `Schema ${igluUri(ref)} not found` })
  }
  for (const dir of [join(root, ref.vendor, ref.name, ref.format), join(root, ref.vendor, ref.name), join(root, ref.vendor)]) {
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

// ---------------------------------------------------------------------------
// Lint: structural checks in the spirit of igluctl lint, then a draft-04 compile.
// ---------------------------------------------------------------------------

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

const JSON_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])
const KEYWORD_FAMILIES: Array<{ family: string, applies: string[], keywords: string[] }> = [
  { family: 'strings', applies: ['string'], keywords: ['minLength', 'maxLength', 'pattern', 'format'] },
  { family: 'numbers', applies: ['number', 'integer'], keywords: ['minimum', 'maximum', 'multipleOf', 'exclusiveMinimum', 'exclusiveMaximum'] },
  { family: 'arrays', applies: ['array'], keywords: ['items', 'minItems', 'maxItems', 'uniqueItems', 'additionalItems'] },
  { family: 'objects', applies: ['object'], keywords: ['properties', 'required', 'additionalProperties', 'minProperties', 'maxProperties', 'patternProperties'] }
]
const KNOWN_FORMATS = new Set(['date-time', 'date', 'time', 'email', 'hostname', 'ipv4', 'ipv6', 'uri', 'uuid', 'regex', 'uri-reference'])

function declaredTypes(node: AnyRecord): string[] | null {
  const t = node.type
  if (typeof t === 'string') return [t]
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string')
  return null
}

function lintNode(node: unknown, path: string, errors: LintIssue[], warnings: LintIssue[], depth = 0) {
  if (!isObj(node) || depth > 24) return
  const types = declaredTypes(node)
  const nonNull = types ? types.filter(t => t !== 'null') : null

  if (types) {
    for (const t of types) {
      if (!JSON_TYPES.has(t)) errors.push({ level: 'error', path, message: `"${t}" is not a JSON Schema type. Use string, number, integer, boolean, object, array or null.` })
    }
    if (!types.length) errors.push({ level: 'error', path, message: '"type" is empty.' })
  } else if (node.type !== undefined) {
    errors.push({ level: 'error', path, message: '"type" must be a string or an array of strings.' })
  }

  const combinators = ['oneOf', 'anyOf', 'allOf', '$ref', 'enum'].some(k => node[k] !== undefined)
  for (const fam of KEYWORD_FAMILIES) {
    const used = fam.keywords.filter(k => node[k] !== undefined)
    if (!used.length) continue
    if (nonNull && nonNull.length && !nonNull.some(t => fam.applies.includes(t))) {
      errors.push({ level: 'error', path, message: `"${used.join('", "')}" only appl${used.length === 1 ? 'ies' : 'y'} to ${fam.family}, but type is ${nonNull.join(' | ')}.` })
    } else if (!nonNull && !combinators && depth > 0) {
      warnings.push({ level: 'warning', path, message: `Uses "${used.join('", "')}" but declares no "type".` })
    }
  }

  if (typeof node.format === 'string' && !KNOWN_FORMATS.has(node.format)) {
    warnings.push({ level: 'warning', path, message: `Unknown format "${node.format}". Iglu understands ${[...KNOWN_FORMATS].join(', ')}.` })
  }
  if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length === 0)) {
    errors.push({ level: 'error', path, message: '"enum" must be a non-empty array.' })
  }
  if (node.required !== undefined) {
    if (!Array.isArray(node.required) || node.required.some(r => typeof r !== 'string')) {
      errors.push({ level: 'error', path, message: '"required" must be an array of property names.' })
    } else if (isObj(node.properties)) {
      const props = node.properties
      const missing = (node.required as string[]).filter(r => !(r in props))
      if (missing.length) errors.push({ level: 'error', path, message: `"required" lists ${missing.map(m => `"${m}"`).join(', ')} but no such propert${missing.length === 1 ? 'y is' : 'ies are'} defined.` })
    }
  }
  for (const k of ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties']) {
    if (node[k] !== undefined && (typeof node[k] !== 'number' || (node[k] as number) < 0 || !Number.isInteger(node[k]))) {
      errors.push({ level: 'error', path, message: `"${k}" must be a non-negative integer.` })
    }
  }
  if (typeof node.minLength === 'number' && typeof node.maxLength === 'number' && node.minLength > node.maxLength) errors.push({ level: 'error', path, message: '"minLength" is greater than "maxLength".' })
  if (typeof node.minimum === 'number' && typeof node.maximum === 'number' && node.minimum > node.maximum) errors.push({ level: 'error', path, message: '"minimum" is greater than "maximum".' })

  if (nonNull?.includes('object')) {
    if (node.additionalProperties !== false && depth >= 0) {
      warnings.push({ level: 'warning', path, message: 'Object allows additional properties. Set "additionalProperties": false so loaders can create stable columns.' })
    }
    if (isObj(node.properties)) {
      for (const [key, child] of Object.entries(node.properties)) lintNode(child, `${path}.${key}`, errors, warnings, depth + 1)
    }
  } else if (isObj(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) lintNode(child, `${path}.${key}`, errors, warnings, depth + 1)
  }
  if (nonNull?.includes('string') && node.maxLength == null && node.enum == null && node.format == null) {
    warnings.push({ level: 'warning', path, message: 'String has no "maxLength". Warehouse loaders need a bound to size the column.' })
  }
  if (!types && !combinators && depth > 0) {
    warnings.push({ level: 'warning', path, message: 'Property declares no "type".' })
  }
  if (isObj(node.items)) lintNode(node.items, `${path}[]`, errors, warnings, depth + 1)
  if (Array.isArray(node.items)) node.items.forEach((it, i) => lintNode(it, `${path}[${i}]`, errors, warnings, depth + 1))
  for (const k of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(node[k])) (node[k] as unknown[]).forEach((it, i) => lintNode(it, `${path}<${k}[${i}]>`, errors, warnings, depth + 1))
  }
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
  const rootTypes = declaredTypes(doc) ?? []
  if (!rootTypes.includes('object')) warnings.push({ level: 'warning', path: '$', message: 'Root "type" is usually "object" for event and entity schemas.' })

  lintNode(doc, '$', errors, warnings)

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
