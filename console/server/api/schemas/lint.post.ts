export default defineEventHandler(async (event) => {
  const body = await readBody<{ vendor?: string, name?: string, format?: string, version?: string, content?: string }>(event)
  const ref = validateRef({ vendor: body?.vendor, name: body?.name, format: body?.format ?? 'jsonschema', version: body?.version })
  return lintSchema(ref, typeof body?.content === 'string' ? body.content : '')
})
