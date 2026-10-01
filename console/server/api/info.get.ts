import { resolverPath } from '../utils/resolver'

export default defineEventHandler(() => {
  const cfg = consoleConfig()
  return {
    version: '0.1.0',
    streamSource: cfg.streamSource,
    kafkaBrokers: cfg.kafkaBrokers,
    kinesisRegion: cfg.kinesisRegion,
    topics: cfg.topics,
    schemasDir: cfg.schemasDir,
    schemasRoot: schemasRoot(),
    resolverPath: resolverPath(),
    collectorUrl: cfg.collectorUrl,
    collectorPublicUrl: cfg.collectorPublicUrl,
    consolePublicUrl: cfg.consolePublicUrl,
    consoleRegistryUrl: cfg.consoleRegistryUrl,
    dockerAvailable: dockerSocketPresent(),
    hostHomeMount: cfg.hostHomeMount,
    hostHomePath: cfg.hostHomePath,
    containers: cfg.containers
  }
})
