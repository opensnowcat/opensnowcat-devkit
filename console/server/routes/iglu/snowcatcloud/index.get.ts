export default defineEventHandler(async () => {
  const key = await readSnowcatKey()
  return { registry: 'SnowcatCloud Schema Registry via OpenSnowcat Console', upstream: snowcatRegistryUrl(), configured: !!key, layout: '/iglu/snowcatcloud/schemas/{vendor}/{name}/{format}/{version}' }
})
