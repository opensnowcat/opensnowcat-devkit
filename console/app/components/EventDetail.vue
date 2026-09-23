<script setup lang="ts">
import type { StreamEvent } from '~/composables/useEventStream'

const props = defineProps<{ event: StreamEvent }>()

interface ParsedGood {
  atomic: Record<string, string | null>
  unstruct: { schema: string, data: unknown } | null
  contexts: Array<{ schema: string, data: unknown }>
  derivedContexts: Array<{ schema: string, data: unknown }>
  columnCount: number
}

interface ParsedBad {
  badType: string
  badRowSchema: string
  summary: string
  messages: Array<{ title: string, detail?: string, schemaKey?: string }>
  schemaKeys: string[]
  processor: string | null
  payload: unknown
  failure: unknown
  timestamp: number | null
}

const good = computed(() => props.event.kind === 'good' ? props.event.detail as ParsedGood : null)
const bad = computed(() => props.event.kind === 'bad' ? props.event.detail as ParsedBad : null)

const tabs = computed(() => props.event.kind === 'good'
  ? [
      { label: 'Overview', value: 'overview', icon: 'i-lucide-eye' },
      { label: 'Entities', value: 'entities', icon: 'i-lucide-boxes' },
      { label: 'Atomic', value: 'atomic', icon: 'i-lucide-table' },
      { label: 'Raw TSV', value: 'raw', icon: 'i-lucide-file-text' }
    ]
  : [
      { label: 'Failure', value: 'failure', icon: 'i-lucide-bug' },
      { label: 'Payload', value: 'payload', icon: 'i-lucide-package' },
      { label: 'Raw JSON', value: 'raw', icon: 'i-lucide-file-text' }
    ])
const tab = ref(props.event.kind === 'good' ? 'overview' : 'failure')
watch(() => props.event.id, () => { tab.value = props.event.kind === 'good' ? 'overview' : 'failure' })

const OVERVIEW_FIELDS = [
  'event_name', 'event', 'event_vendor', 'event_version', 'app_id', 'platform', 'collector_tstamp', 'derived_tstamp', 'dvce_created_tstamp',
  'event_id', 'user_id', 'domain_userid', 'domain_sessionid', 'domain_sessionidx', 'network_userid', 'user_ipaddress',
  'page_url', 'page_title', 'page_referrer', 'refr_medium', 'refr_source', 'mkt_source', 'mkt_medium', 'mkt_campaign',
  'useragent', 'br_family', 'os_family', 'dvce_type', 'geo_country', 'geo_city', 'v_tracker', 'name_tracker', 'event_fingerprint'
]
const overview = computed(() => {
  const a = good.value?.atomic ?? {}
  return OVERVIEW_FIELDS.filter(f => a[f] != null).map(f => [f, a[f] as string] as const)
})
const atomicRows = computed(() => Object.entries(good.value?.atomic ?? {}).filter(([, v]) => v != null))

const schemaLink = (uri: string) => ({ path: '/schemas', query: { uri } })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-2">
      <UBadge
        :color="event.kind === 'good' ? 'success' : 'error'"
        variant="subtle"
        :label="event.kind === 'good' ? 'GOOD' : 'BAD'"
      />
      <UBadge
        v-if="event.badType"
        color="neutral"
        variant="outline"
        :label="event.badType.replace(/_/g, ' ')"
      />
      <UBadge
        v-if="event.appId"
        color="neutral"
        variant="soft"
        :label="event.appId"
        icon="i-lucide-app-window"
      />
      <UBadge
        v-if="event.platform"
        color="neutral"
        variant="soft"
        :label="event.platform"
      />
      <span class="text-xs text-muted font-mono ml-auto">{{ fmtDateTime(event.ts) }}</span>
    </div>

    <UTabs
      v-model="tab"
      :items="tabs"
      :content="false"
      size="sm"
      color="neutral"
    />

    <template v-if="good">
      <div v-if="tab === 'overview'">
        <dl class="osc-kv">
          <template
            v-for="[k, v] in overview"
            :key="k"
          >
            <dt>{{ k }}</dt>
            <dd>{{ v }}</dd>
          </template>
        </dl>
      </div>

      <div
        v-else-if="tab === 'entities'"
        class="flex flex-col gap-4"
      >
        <section v-if="good.unstruct">
          <h4 class="text-xs uppercase tracking-wider text-muted mb-1.5">
            Self-describing event
          </h4>
          <UButton
            :to="schemaLink(good.unstruct.schema)"
            variant="link"
            size="xs"
            class="px-0 font-mono"
            :label="good.unstruct.schema"
            trailing-icon="i-lucide-arrow-up-right"
          />
          <JsonView :value="good.unstruct.data" />
        </section>
        <section v-if="good.contexts.length">
          <h4 class="text-xs uppercase tracking-wider text-muted mb-1.5">
            Contexts ({{ good.contexts.length }})
          </h4>
          <div
            v-for="(c, i) in good.contexts"
            :key="i"
            class="mb-3"
          >
            <UButton
              :to="schemaLink(c.schema)"
              variant="link"
              size="xs"
              class="px-0 font-mono"
              :label="c.schema"
              trailing-icon="i-lucide-arrow-up-right"
            />
            <JsonView
              :value="c.data"
              max-height="30vh"
            />
          </div>
        </section>
        <section v-if="good.derivedContexts.length">
          <h4 class="text-xs uppercase tracking-wider text-muted mb-1.5">
            Derived contexts ({{ good.derivedContexts.length }})
          </h4>
          <div
            v-for="(c, i) in good.derivedContexts"
            :key="i"
            class="mb-3"
          >
            <UButton
              :to="schemaLink(c.schema)"
              variant="link"
              size="xs"
              class="px-0 font-mono"
              :label="c.schema"
              trailing-icon="i-lucide-arrow-up-right"
            />
            <JsonView
              :value="c.data"
              max-height="30vh"
            />
          </div>
        </section>
        <p
          v-if="!good.unstruct && !good.contexts.length && !good.derivedContexts.length"
          class="text-sm text-muted"
        >
          This event carries no self-describing entities.
        </p>
      </div>

      <div v-else-if="tab === 'atomic'">
        <p class="text-xs text-muted mb-2">
          {{ atomicRows.length }} populated of {{ good.columnCount }} columns
        </p>
        <dl class="osc-kv">
          <template
            v-for="[k, v] in atomicRows"
            :key="k"
          >
            <dt>{{ k }}</dt>
            <dd>{{ v }}</dd>
          </template>
        </dl>
      </div>

      <div v-else>
        <JsonView :value="event.raw" />
      </div>
    </template>

    <template v-else-if="bad">
      <div
        v-if="tab === 'failure'"
        class="flex flex-col gap-3"
      >
        <UAlert
          v-for="(m, i) in bad.messages"
          :key="i"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="m.title"
          :description="m.detail"
        />
        <div
          v-if="bad.schemaKeys.length"
          class="flex flex-col gap-1"
        >
          <h4 class="text-xs uppercase tracking-wider text-muted">
            Schemas involved
          </h4>
          <UButton
            v-for="s in bad.schemaKeys"
            :key="s"
            :to="schemaLink(s)"
            variant="link"
            size="xs"
            class="px-0 font-mono justify-start"
            :label="s"
            trailing-icon="i-lucide-arrow-up-right"
          />
        </div>
        <dl class="osc-kv mt-2">
          <dt>Bad row type</dt><dd>{{ bad.badType }}</dd>
          <dt>Bad row schema</dt><dd>{{ bad.badRowSchema }}</dd>
          <dt v-if="bad.processor">
            Processor
          </dt><dd v-if="bad.processor">
            {{ bad.processor }}
          </dd>
          <dt>Topic</dt><dd>{{ event.topic }} @ {{ event.offset }}</dd>
        </dl>
        <h4 class="text-xs uppercase tracking-wider text-muted mt-2">
          Full failure
        </h4>
        <JsonView
          :value="bad.failure"
          max-height="40vh"
        />
      </div>
      <div v-else-if="tab === 'payload'">
        <JsonView :value="bad.payload" />
      </div>
      <div v-else>
        <JsonView :value="event.raw" />
      </div>
    </template>
  </div>
</template>
