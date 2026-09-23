export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  return checkFolder(String(q.path ?? ''))
})
