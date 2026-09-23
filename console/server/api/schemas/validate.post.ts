export default defineEventHandler(async (event) => {
  const body = await readBody<{ folder?: string, vendor?: string, name?: string, format?: string, version?: string, data?: unknown, content?: string }>(event)
  const ref = validateRef({ vendor: body?.vendor, name: body?.name, format: body?.format ?? 'jsonschema', version: body?.version })
  const content = typeof body?.content === 'string' ? body.content : (await readSchema(await folderRoot(body?.folder ?? LOCAL_FOLDER_ID), ref)).content
  return validateAgainstSchema(content, body?.data)
})
