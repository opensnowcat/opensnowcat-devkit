<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ConsoleInfo } from '~/types/api'

useHead({ title: 'Pipeline · OpenSnowcat Console' })

interface ContainerStatus { role: string, name: string, found: boolean, running: boolean, state: string, status: string, image: string, id: string | null }
interface TopicInfo { name: string, partitions: number, earliest: string, latest: string, messages: string }
interface GroupInfo { id: string, state: string, members: number, protocolType: string }
interface StreamInfo { name: string, status: string, mode: string, shards: number, retentionHours: number, behindMs: number | null, error: string | null }

const toast = useToast()
const hydrated = useHydrated()
const { data: containers, refresh: refreshContainers, pending: containersPending } = await useFetch<{ available: boolean, error: string | null, containers: ContainerStatus[] }>('/api/pipeline/containers', { server: false, lazy: true, getCachedData: () => undefined })
const { data: topics, refresh: refreshTopics, pending: topicsPending } = await useFetch<{ ok: boolean, source: 'kafka' | 'kinesis', topics: TopicInfo[], groups: GroupInfo[], streams: StreamInfo[], error: string | null }>('/api/pipeline/topics', { server: false, lazy: true, getCachedData: () => undefined })
const { data: info } = await useFetch<ConsoleInfo>('/api/info', { server: false, lazy: true, getCachedData: () => undefined })
const { stats } = useEventStream()
const kinesis = computed(() => (topics.value?.source ?? info.value?.streamSource) === 'kinesis')
const broker = computed(() => kinesis.value ? 'Kinesis' : 'Kafka')

let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(() => { refreshContainers(); refreshTopics() }, 5000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const restarting = ref<string | null>(null)
async function restart(role: string) {
  restarting.value = role
  try {
    const res = await $fetch<{ name: string }>('/api/pipeline/restart', { method: 'POST', body: { role } })
    toast.add({ title: `${res.name} restarting`, description: 'Give it a few seconds to come back.', color: 'success', icon: 'i-lucide-refresh-cw' })
    setTimeout(() => refreshContainers(), 1500)
  } catch (e) {
    const msg = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message
    toast.add({ title: 'Restart failed', description: msg, color: 'error', icon: 'i-lucide-x' })
  } finally {
    restarting.value = null
  }
}

const logsOpen = ref(false)
const logsRole = ref('enrich')
const logsText = ref('')
const logsLoading = ref(false)
async function openLogs(role: string) {
  logsRole.value = role
  logsOpen.value = true
  await loadLogs()
}
async function loadLogs() {
  logsLoading.value = true
  try {
    const res = await $fetch<{ logs: string }>('/api/pipeline/logs', { query: { role: logsRole.value, tail: 300 } })
    logsText.value = res.logs
  } catch (e) {
    const msg = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message
    logsText.value = `Could not read logs: ${msg}`
  } finally {
    logsLoading.value = false
  }
}

const RESTARTABLE = ['enrich', 'collector', 'bento']
const ROLE_LABEL: Record<string, string> = { collector: 'Collector', enrich: 'Enrich', bento: 'Bento', kafka: 'Kafka', tunnel: 'Tunnel' }
const ROLE_DESC = computed<Record<string, string>>(() => ({
  collector: `Receives tracker requests on :8080 and writes raw payloads to ${broker.value}`,
  enrich: 'Validates against schemas, runs enrichments, writes good and bad rows',
  bento: 'Converts enriched TSV to JSON on a side topic',
  kafka: 'The broker every component talks to',
  tunnel: 'cloudflared quick tunnel, when started from the Expose page'
}))

const topicColumns: TableColumn<TopicInfo>[] = [
  { accessorKey: 'name', header: 'Topic' },
  { accessorKey: 'partitions', header: 'Partitions' },
  { accessorKey: 'messages', header: 'Messages' },
  { accessorKey: 'latest', header: 'End offset' }
]
const streamColumns: TableColumn<StreamInfo>[] = [
  { accessorKey: 'name', header: 'Stream' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'shards', header: 'Shards' },
  { accessorKey: 'mode', header: 'Mode', cell: ({ row }) => row.original.mode.replace('_', '-').toLowerCase() || '—' },
  { accessorKey: 'retentionHours', header: 'Retention', cell: ({ row }) => row.original.retentionHours ? `${row.original.retentionHours} h` : '—' },
  { accessorKey: 'behindMs', header: 'Console behind', cell: ({ row }) => row.original.behindMs == null ? '—' : row.original.behindMs < 1000 ? 'at tip' : `${Math.round(row.original.behindMs / 1000)} s` }
]
const missingStreams = computed(() => (topics.value?.streams ?? []).filter(s => s.error))
const groupColumns: TableColumn<GroupInfo>[] = [
  { accessorKey: 'id', header: 'Consumer group' },
  { accessorKey: 'state', header: 'State' },
  { accessorKey: 'members', header: 'Members' }
]
</script>

<template>
  <UDashboardPanel id="pipeline">
    <template #header>
      <UDashboardNavbar
        title="Pipeline"
        icon="i-lucide-server"
      >
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="hydrated && (containersPending || topicsPending)"
            @click="refreshContainers(); refreshTopics()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6">
        <UAlert
          v-if="containers && !containers.available"
          color="warning"
          variant="subtle"
          icon="i-lucide-plug-zap"
          title="Docker is not reachable from the console"
          :description="containers.error ?? 'Mount the Docker socket to enable restarts and logs.'"
        />

        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <UCard
            v-for="c in containers?.containers ?? []"
            :key="c.role"
            variant="subtle"
          >
            <div class="flex items-start gap-3">
              <UChip
                :color="c.running ? 'success' : c.found ? 'error' : 'neutral'"
                standalone
                inset
                class="mt-1.5"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h3 class="font-semibold">
                    {{ ROLE_LABEL[c.role] ?? c.role }}
                  </h3>
                  <UBadge
                    :color="c.running ? 'success' : c.found ? 'error' : 'neutral'"
                    variant="subtle"
                    size="sm"
                    :label="c.found ? c.state : 'not created'"
                  />
                </div>
                <p class="text-xs text-muted mt-0.5">
                  {{ ROLE_DESC[c.role] }}
                </p>
                <p class="text-[11px] font-mono text-muted mt-2 truncate">
                  {{ c.name }}<span v-if="c.image"> · {{ c.image }}</span>
                </p>
                <p
                  v-if="c.status"
                  class="text-[11px] text-muted"
                >
                  {{ c.status }}
                </p>
              </div>
            </div>
            <template #footer>
              <div class="flex gap-2">
                <UButton
                  v-if="RESTARTABLE.includes(c.role)"
                  icon="i-lucide-refresh-cw"
                  size="xs"
                  color="neutral"
                  variant="subtle"
                  label="Restart"
                  :disabled="!c.found || !containers?.available"
                  :loading="restarting === c.role"
                  @click="restart(c.role)"
                />
                <UButton
                  icon="i-lucide-terminal"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  label="Logs"
                  :disabled="!c.found || !containers?.available"
                  @click="openLogs(c.role)"
                />
              </div>
            </template>
          </UCard>
        </div>

        <div class="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <UCard
            v-if="kinesis"
            variant="subtle"
          >
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-waves"
                  class="text-muted"
                />
                <h3 class="font-semibold">
                  Kinesis streams
                </h3>
                <span class="text-xs text-muted ml-auto">{{ info?.kinesisRegion }}</span>
              </div>
            </template>
            <UAlert
              v-if="topics && !topics.ok"
              color="error"
              variant="subtle"
              icon="i-lucide-unplug"
              title="Kinesis call failed"
              :description="topics.error ?? ''"
            />
            <template v-else>
              <UAlert
                v-if="missingStreams.length"
                color="warning"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                :title="missingStreams.map(s => s.error).join(' · ')"
                class="mb-3"
              />
              <UTable
                :data="topics?.streams ?? []"
                :columns="streamColumns"
                :loading="hydrated && topicsPending && !topics"
                class="text-sm"
              />
            </template>
          </UCard>
          <UCard
            v-else
            variant="subtle"
          >
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-database"
                  class="text-muted"
                />
                <h3 class="font-semibold">
                  Kafka topics
                </h3>
                <span class="text-xs text-muted ml-auto">{{ info?.kafkaBrokers?.join(', ') }}</span>
              </div>
            </template>
            <UAlert
              v-if="topics && !topics.ok"
              color="error"
              variant="subtle"
              icon="i-lucide-unplug"
              title="Kafka admin call failed"
              :description="topics.error ?? ''"
            />
            <UTable
              v-else
              :data="topics?.topics ?? []"
              :columns="topicColumns"
              :loading="hydrated && topicsPending && !topics"
              class="text-sm"
            />
          </UCard>
          <div class="flex flex-col gap-6">
            <UCard
              v-if="!kinesis"
              variant="subtle"
            >
              <template #header>
                <h3 class="font-semibold">
                  Consumer groups
                </h3>
              </template>
              <UTable
                :data="topics?.groups ?? []"
                :columns="groupColumns"
                class="text-sm"
              />
            </UCard>
            <UCard variant="subtle">
              <template #header>
                <h3 class="font-semibold">
                  Console
                </h3>
              </template>
              <dl class="osc-kv">
                <dt>Tailing</dt><dd>{{ stats?.source.streams.join(', ') || '—' }}</dd>
                <dt>{{ stats?.source.label ?? 'Kafka' }}</dt><dd>{{ stats?.source.connected ? 'connected' : (stats?.source.error ?? 'connecting') }}</dd>
                <dt>Buffered</dt><dd>{{ stats?.buffered ?? 0 }} / {{ stats?.capacity ?? 0 }}</dd>
                <dt>Schemas</dt><dd>{{ info?.schemasRoot }}</dd>
                <dt>Resolver</dt><dd>{{ info?.resolverPath }}</dd>
                <dt>Registry URL</dt><dd>{{ info?.consoleRegistryUrl }}</dd>
                <dt>Collector</dt><dd>{{ info?.collectorUrl }}</dd>
              </dl>
            </UCard>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <USlideover
    v-model:open="logsOpen"
    :title="`${ROLE_LABEL[logsRole] ?? logsRole} logs`"
    description="Last 300 lines"
    :ui="{ content: 'max-w-3xl' }"
  >
    <template #body>
      <pre class="osc-json max-h-[80vh] text-[11px]">{{ logsLoading && !logsText ? 'Loading…' : logsText }}</pre>
    </template>
    <template #footer>
      <div class="flex justify-end w-full">
        <UButton
          icon="i-lucide-refresh-cw"
          label="Refresh"
          color="neutral"
          variant="subtle"
          :loading="logsLoading"
          @click="loadLogs"
        />
      </div>
    </template>
  </USlideover>
</template>
