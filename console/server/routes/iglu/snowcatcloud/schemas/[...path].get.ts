export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path') ?? ''
  const parts = path.split('/').filter(Boolean)
  if (parts.length !== 4) throw createError({ statusCode: 404, statusMessage: 'Expected /iglu/snowcatcloud/schemas/{vendor}/{name}/{format}/{version}' })
  const ref = validateRef({ vendor: parts[0], name: parts[1], format: parts[2], version: parts[3] })
  const upstream = await fetchFromSnowcat(`/schemas/${ref.vendor}/${ref.name}/${ref.format}/${ref.version}`)
  event.node.res.statusCode = upstream.status
  setResponseHeader(event, 'content-type', upstream.contentType)
  setResponseHeader(event, 'cache-control', 'no-store')
  return upstream.body
})
