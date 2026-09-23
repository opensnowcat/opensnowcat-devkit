export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  return browseDir(typeof q.path === 'string' ? q.path : undefined)
})
