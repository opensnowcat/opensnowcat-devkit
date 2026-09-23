export default defineEventHandler(async (event) => {
  const body = await readBody<{ folder?: string, vendor?: string, name?: string, format?: string, version?: string, content?: string, expectedMtimeMs?: number }>(event)
  const folder = body?.folder ?? LOCAL_FOLDER_ID
  const ref = validateRef({ vendor: body?.vendor, name: body?.name, format: body?.format ?? 'jsonschema', version: body?.version })
  const content = typeof body?.content === 'string' ? body.content : ''
  const lint = lintSchema(ref, content)
  if (lint.errors.some(e => e.message.startsWith('Not valid JSON'))) {
    throw createError({ statusCode: 422, statusMessage: lint.errors[0]!.message })
  }
  const root = await folderRoot(folder)
  const saved = await writeSchema(root, ref, content, body?.expectedMtimeMs)
  return { folder, ref, uri: igluUri(ref), ...saved, lint }
})
