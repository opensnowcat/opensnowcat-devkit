<script setup lang="ts">
import type { StreamEvent } from '~/composables/useEventStream'

useHead({ title: 'Live Stream · OpenSnowcat Console' })

const { visible, stats, paused, pendingWhilePaused, ready, readiness, connect, pause, resume, clear } = useEventStream()
const startedAgo = computed(() => stats.value ? Date.now() - stats.value.startedAt : 0)
onMounted(connect)

const kindFilter = ref<'all' | 'good' | 'bad'>('all')
const search = ref('')
const appId = ref<string | undefined>()
const eventName = ref<string | undefined>()
const schema = ref<string | undefined>()
const badType = ref<string | undefined>()

const distinct = (pick: (e: StreamEvent) => string | null | undefined) => {
  const set = new Set<string>()
  for (const e of visible.value) {
    const v = pick(e)
    if (v) set.add(v)
  }
  return [...set].sort()
}
const appIds = computed(() => distinct(e => e.appId))
const eventNames = computed(() => distinct(e => e.eventName))
const schemas = computed(() => {
  const set = new Set<string>()
  for (const e of visible.value) for (const s of e.schemaKeys) set.add(s)
  return [...set].sort()
})
const badTypes = computed(() => distinct(e => e.badType))

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const out: StreamEvent[] = []
  const list = visible.value
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]!
    if (kindFilter.value !== 'all' && e.kind !== kindFilter.value) continue
    if (appId.value && e.appId !== appId.value) continue
    if (eventName.value && e.eventName !== eventName.value) continue
    if (badType.value && e.badType !== badType.value) continue
    if (schema.value && !e.schemaKeys.includes(schema.value)) continue
    if (q && !(`${e.summary} ${e.eventName ?? ''} ${e.appId ?? ''} ${e.eventId ?? ''} ${e.schemaKeys.join(' ')} ${e.badType ?? ''} ${e.userId ?? ''} ${e.domainUserId ?? ''}`.toLowerCase().includes(q))) continue
    out.push(e)
    if (out.length >= 500) break
  }
  return out
})

const hasFilters = computed(() => kindFilter.value !== 'all' || !!search.value || !!appId.value || !!eventName.value || !!schema.value || !!badType.value)
function resetFilters() {
  kindFilter.value = 'all'
  search.value = ''
  appId.value = undefined
  eventName.value = undefined
  schema.value = undefined
  badType.value = undefined
}

const selected = ref<StreamEvent | null>(null)
const detailOpen = computed({ get: () => !!selected.value, set: (v) => { if (!v) selected.value = null } })
const sendOpen = ref(false)

const counts = computed(() => {
  let g = 0
  let b = 0
  for (const e of visible.value) {
    if (e.kind === 'good') g++
    else b++
  }
  return { good: g, bad: b }
})
</script>

<template>
  <UDashboardPanel
    id="stream"
    :ui="{ body: 'p-0 sm:p-0 gap-0' }"
  >
    <template #header>
      <UDashboardNavbar
        title="Live Stream"
        icon="i-lucide-radio"
      >
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <div class="hidden md:flex items-center gap-2 mr-2 text-xs">
            <UBadge
              color="success"
              variant="subtle"
              icon="i-lucide-circle-check"
            >
              {{ stats?.totalGood ?? 0 }} good · {{ stats?.goodPerSecond ?? 0 }}/s
            </UBadge>
            <UBadge
              color="error"
              variant="subtle"
              icon="i-lucide-circle-x"
            >
              {{ stats?.totalBad ?? 0 }} bad · {{ stats?.badPerSecond ?? 0 }}/s
            </UBadge>
          </div>
          <UTooltip :text="paused ? 'Resume live updates' : 'Pause live updates'">
            <UButton
              :icon="paused ? 'i-lucide-play' : 'i-lucide-pause'"
              color="neutral"
              variant="ghost"
              :label="paused && pendingWhilePaused ? `+${pendingWhilePaused}` : undefined"
              @click="paused ? resume() : pause()"
            />
          </UTooltip>
          <UTooltip text="Clear the buffer">
            <UButton
              icon="i-lucide-eraser"
              color="neutral"
              variant="ghost"
              @click="clear"
            />
          </UTooltip>
          <UBadge
            v-if="ready && (stats?.enrich.lag ?? 0) > 0"
            color="warning"
            variant="subtle"
            icon="i-lucide-loader-circle"
            :ui="{ leadingIcon: 'animate-spin' }"
            class="mr-1"
          >
            {{ stats?.enrich.lag }} waiting for enrich
          </UBadge>
          <UTooltip :text="ready ? 'Send test events to the collector' : `${readiness.label}…`">
            <UButton
              icon="i-lucide-send"
              label="Send events"
              :disabled="!ready"
              @click="sendOpen = true"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar :ui="{ root: 'flex-wrap gap-y-2 h-auto min-h-12 py-2', left: 'flex-wrap gap-y-2', right: 'flex-wrap gap-y-2' }">
        <template #left>
          <UFieldGroup size="sm">
            <UButton
              :variant="kindFilter === 'all' ? 'solid' : 'subtle'"
              color="neutral"
              :label="`All ${counts.good + counts.bad}`"
              @click="kindFilter = 'all'"
            />
            <UButton
              :variant="kindFilter === 'good' ? 'solid' : 'subtle'"
              color="success"
              :label="`Good ${counts.good}`"
              @click="kindFilter = 'good'"
            />
            <UButton
              :variant="kindFilter === 'bad' ? 'solid' : 'subtle'"
              color="error"
              :label="`Bad ${counts.bad}`"
              @click="kindFilter = 'bad'"
            />
          </UFieldGroup>
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="Search summary, schema, ids…"
            size="sm"
            class="w-64"
          />
        </template>
        <template #right>
          <USelectMenu
            v-model="appId"
            :items="appIds"
            placeholder="App id"
            size="sm"
            class="w-36"
            :search-input="false"
          />
          <USelectMenu
            v-model="eventName"
            :items="eventNames"
            placeholder="Event"
            size="sm"
            class="w-40"
            :search-input="false"
          />
          <USelectMenu
            v-model="schema"
            :items="schemas"
            placeholder="Schema"
            size="sm"
            class="w-56"
          />
          <USelectMenu
            v-model="badType"
            :items="badTypes"
            placeholder="Bad row type"
            size="sm"
            class="w-40"
            :search-input="false"
          />
          <UButton
            v-if="hasFilters"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            label="Reset"
            @click="resetFilters"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <div
        v-if="!filtered.length"
        class="h-full flex items-center justify-center p-4 sm:p-6"
      >
        <UEmpty
          v-if="hasFilters"
          icon="i-lucide-filter"
          title="Nothing matches these filters"
          description="Loosen the filters or send a few events."
        >
          <template #actions>
            <UButton
              label="Reset filters"
              color="neutral"
              variant="subtle"
              @click="resetFilters"
            />
          </template>
        </UEmpty>
        <UEmpty
          v-else-if="!ready"
          :title="`${readiness.label}…`"
          :description="readiness.detail && readiness.label !== 'Waiting for Kafka' ? readiness.detail : 'The pipeline is starting. Kafka, the collector and enrich take up to a minute on a fresh start.'"
        >
          <template #leading>
            <div class="flex items-center justify-center size-12 rounded-full bg-elevated">
              <UIcon
                name="i-lucide-loader-circle"
                class="size-6 animate-spin text-primary"
              />
            </div>
          </template>
          <template #actions>
            <UButton
              icon="i-lucide-send"
              label="Send events"
              disabled
            />
          </template>
          <template #footer>
            <p
              v-if="readiness.label === 'Waiting for Kafka' && readiness.detail && startedAgo > 45_000"
              class="text-xs text-muted font-mono max-w-md"
            >
              {{ readiness.detail }}
            </p>
          </template>
        </UEmpty>
        <UEmpty
          v-else-if="(stats?.enrich.lag ?? 0) > 0"
          :title="`Enrich is processing ${stats?.enrich.lag} event${stats?.enrich.lag === 1 ? '' : 's'}…`"
          description="They show up here as soon as enrich writes them. The first events after a cold start take longest."
        >
          <template #leading>
            <div class="flex items-center justify-center size-12 rounded-full bg-elevated">
              <UIcon
                name="i-lucide-loader-circle"
                class="size-6 animate-spin text-primary"
              />
            </div>
          </template>
        </UEmpty>
        <UEmpty
          v-else
          icon="i-lucide-radio"
          title="Waiting for events"
          description="Good and bad events appear here as enrich writes them. Send a few test events to get started."
        >
          <template #actions>
            <UButton
              icon="i-lucide-send"
              label="Send events"
              @click="sendOpen = true"
            />
          </template>
        </UEmpty>
      </div>
      <div v-else>
        <div class="osc-row text-[11px] uppercase tracking-wider text-muted font-medium cursor-default hover:bg-transparent border-b-2 sticky top-0 bg-default z-10">
          <span>Time</span><span>Kind</span><span>App</span><span>Event</span><span>Details</span><span />
        </div>
        <div
          v-for="e in filtered"
          :key="e.id"
          class="osc-row"
          :class="e.kind === 'good' ? 'is-good' : 'is-bad'"
          role="button"
          tabindex="0"
          @click="selected = e"
          @keydown.enter="selected = e"
        >
          <span class="font-mono text-xs text-muted">{{ fmtTime(e.ts) }}</span>
          <UBadge
            :color="e.kind === 'good' ? 'success' : 'error'"
            variant="subtle"
            size="sm"
            :label="e.kind === 'good' ? 'GOOD' : 'BAD'"
          />
          <span class="truncate text-muted">{{ e.appId ?? '—' }}</span>
          <span class="truncate font-medium">{{ e.eventName ?? (e.badType ? e.badType.replace(/_/g, ' ') : '—') }}</span>
          <span class="truncate min-w-0">
            <span
              v-if="e.schema"
              class="font-mono text-xs text-primary mr-2"
            >{{ igluShort(e.schema) }}</span>
            <span class="text-muted">{{ e.summary }}</span>
          </span>
          <UIcon
            name="i-lucide-chevron-right"
            class="text-muted"
          />
        </div>
        <p
          v-if="filtered.length >= 500"
          class="px-4 py-3 text-xs text-muted"
        >
          Showing the latest 500 matching events. Narrow the filters to see older ones.
        </p>
      </div>
    </template>
  </UDashboardPanel>

  <USlideover
    v-model:open="detailOpen"
    :title="selected ? (selected.eventName ?? selected.badType ?? 'Event') : 'Event'"
    :description="selected?.eventId ?? undefined"
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #body>
      <EventDetail
        v-if="selected"
        :event="selected"
      />
    </template>
  </USlideover>

  <SendEventsPanel v-model:open="sendOpen" />
</template>
