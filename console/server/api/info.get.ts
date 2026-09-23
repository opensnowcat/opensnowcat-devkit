import { schemasRoot } from '../utils/schemas'
import { resolverPath } from '../utils/resolver'

export default defineEventHandler(() => {
  const cfg = consoleConfig()
  return {
    version: '0.1.0',
    kafkaBrokers: cfg.kafkaBrokers,
    topics: cfg.topics,
    schemasDir: cfg.schemasDir,
    schemasRoot: schemasRoot(),
    resolverPath: resolverPath(),
    collectorUrl: cfg.collectorUrl,
    collectorPublicUrl: cfg.collectorPublicUrl,
    consolePublicUrl: cfg.consolePublicUrl,
    consoleRegistryUrl: cfg.consoleRegistryUrl,
    dockerAvailable: dockerSocketPresent(),
    containers: cfg.containers
  }
})
