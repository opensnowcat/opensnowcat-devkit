export default defineEventHandler(async (event) => {
  const body = await readBody<{ vendor?: string, name?: string, format?: string, version?: string, data?: unknown }>(event)
  const ref = validateRef({ vendor: body?.vendor, name: body?.name, format: body?.format ?? 'jsonschema', version: body?.version })
  const file = await readSchema(ref)
  return validateAgainstSchema(file.content, body?.data)
})
