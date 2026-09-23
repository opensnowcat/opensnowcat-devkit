export default defineEventHandler(async () => {
  try {
    const [topics, groups] = await Promise.all([describeTopics(), describeGroups().catch(() => [])])
    return { ok: true, topics, groups, error: null }
  } catch (e) {
    return { ok: false, topics: [], groups: [], error: (e as Error).message ?? String(e) }
  }
})
