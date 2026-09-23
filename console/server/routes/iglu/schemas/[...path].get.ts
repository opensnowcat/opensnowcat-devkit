export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path') ?? ''
  const parts = path.split('/').filter(Boolean)
  if (parts.length !== 4) throw createError({ statusCode: 404, statusMessage: 'Expected /iglu/schemas/{vendor}/{name}/{format}/{version}' })
  const ref = validateRef({ vendor: parts[0], name: parts[1], format: parts[2], version: parts[3] })
  const file = await readSchema(schemasRoot(), ref)
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return file.content
})
