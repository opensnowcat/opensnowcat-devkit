export default defineEventHandler(async () => {
  if (consoleConfig().streamSource === 'kinesis') {
    try {
      return { ok: true, source: 'kinesis', topics: [], groups: [], streams: await describeStreams(), error: null }
    } catch (e) {
      return { ok: false, source: 'kinesis', topics: [], groups: [], streams: [], error: (e as Error).message ?? String(e) }
    }
  }
  try {
    const [topics, groups] = await Promise.all([describeTopics(), describeGroups().catch(() => [])])
    return { ok: true, source: 'kafka', topics, groups, streams: [], error: null }
  } catch (e) {
    return { ok: false, source: 'kafka', topics: [], groups: [], streams: [], error: (e as Error).message ?? String(e) }
  }
})
