import { existsSync } from 'node:fs'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ folder?: string, vendor?: string, name?: string, format?: string, version?: string, description?: string, from?: { vendor: string, name: string, format?: string, version: string } }>(event)
  const folder = body?.folder ?? LOCAL_FOLDER_ID
  const ref = validateRef({ vendor: body?.vendor, name: body?.name, format: body?.format ?? 'jsonschema', version: body?.version ?? '1-0-0' })
  const root = await folderRoot(folder)
  if (existsSync(schemaPath(root, ref))) throw createError({ statusCode: 409, statusMessage: `${igluUri(ref)} already exists` })
  let content: string
  if (body?.from) {
    const source = validateRef({ ...body.from, format: body.from.format ?? 'jsonschema' })
    const file = await readSchema(root, source)
    try {
      const doc = JSON.parse(file.content)
      doc.self = { vendor: ref.vendor, name: ref.name, format: ref.format, version: ref.version }
      content = JSON.stringify(doc, null, 2) + '\n'
    } catch {
      throw createError({ statusCode: 422, statusMessage: 'Source schema is not valid JSON, fix it before bumping the version' })
    }
  } else {
    content = templateSchema(ref, body?.description)
  }
  const saved = await writeSchema(root, ref, content)
  return { folder, ref, uri: igluUri(ref), ...saved, content, lint: lintSchema(ref, content) }
})
