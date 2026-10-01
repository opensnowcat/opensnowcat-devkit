export default defineNitroPlugin((nitro) => {
  if (consoleConfig().streamSource === 'kinesis') startKinesis().catch(e => console.error('[console] kinesis loop crashed', e))
  else startKafka().catch(e => console.error('[console] kafka loop crashed', e))
  const stopProbe = startPipelineProbe()
  nitro.hooks.hook('close', async () => {
    stopProbe()
    stopKinesis()
    await stopKafka()
  })
})
