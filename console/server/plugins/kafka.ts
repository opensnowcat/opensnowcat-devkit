export default defineNitroPlugin((nitro) => {
  startKafka().catch(e => console.error('[console] kafka loop crashed', e))
  nitro.hooks.hook('close', async () => {
    await stopKafka()
  })
})
