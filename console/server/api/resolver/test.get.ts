export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const uri = String(q.uri ?? '').trim()
  if (!uri) throw createError({ statusCode: 400, statusMessage: 'Missing uri' })
  return resolveTest(uri)
})
