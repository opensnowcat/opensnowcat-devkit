export default defineNitroPlugin((nitro) => {
  startKafka().catch(e => console.error('[console] kafka loop crashed', e))
  const stopProbe = startCollectorProbe()
  nitro.hooks.hook('close', async () => {
    stopProbe()
    await stopKafka()
  })
})
