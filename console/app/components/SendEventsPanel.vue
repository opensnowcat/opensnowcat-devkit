<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ defaultTarget?: string }>()
const { ready, readiness } = useEventStream()
const toast = useToast()

const kinds = [
  { label: 'Good: page views', value: 'good', description: 'Valid page view events, like send_good_events.sh' },
  { label: 'Bad: unknown event schema', value: 'bad_schema', description: 'Self-describing event whose schema exists in no registry' },
  { label: 'Bad: invalid payload', value: 'bad_payload', description: 'Wrong payload_data schema, like send_bad_events.sh' },
  { label: 'Custom self-describing event', value: 'custom', description: 'Pick one of your schemas and send your own data' }
]
const targets = [
  { label: 'Collector inside the devkit network', value: 'internal' },
  { label: 'Collector on localhost', value: 'public' },
  { label: 'Through the cloudflared tunnel', value: 'tunnel' }
]

const form = reactive({
  kind: 'good' as 'good' | 'bad_schema' | 'bad_payload' | 'custom',
  count: 10,
  concurrency: 4,
  target: props.defaultTarget ?? 'internal',
  appId: 'console',
  schema: '',
  data: '{\n  "sku": "SKU-123",\n  "name": "OpenSnowcat hoodie",\n  "price": 49.9,\n  "currency": "EUR"\n}'
})

interface SchemaListing { folders: Array<{ listing: { vendors: Array<{ vendor: string, names: Array<{ name: string, versions: Array<{ uri: string }> }> }> } }> }
const { data: schemaList } = await useFetch<SchemaListing>('/api/schemas', { lazy: true, server: false, getCachedData: () => undefined })
const schemaOptions = computed(() => [...new Set((schemaList.value?.folders ?? []).flatMap(f => f.listing.vendors.flatMap(v => v.names.flatMap(n => n.versions.map(x => x.uri)))))])
watch(() => props.defaultTarget, (t) => { if (t) form.target = t })
watch(schemaOptions, (opts) => { if (!form.schema && opts.length) form.schema = opts[0]! }, { immediate: true })

const sending = ref(false)
const result = ref<{ endpoint: string, requested: number, ok: number, failed: number, statusCodes: Record<string, number>, durationMs: number, errors: string[] } | null>(null)

async function send() {
  sending.value = true
  result.value = null
  try {
    let custom: { schema: string, data: unknown } | undefined
    if (form.kind === 'custom') {
      let data: unknown
      try {
        data = JSON.parse(form.data)
      } catch (e) {
        toast.add({ title: 'Event data is not valid JSON', description: (e as Error).message, color: 'error', icon: 'i-lucide-x' })
        return
      }
      custom = { schema: form.schema, data }
    }
    const res = await $fetch('/api/send', { method: 'POST', body: { kind: form.kind, count: form.count, concurrency: form.concurrency, target: form.target, appId: form.appId, custom } })
    result.value = res
    toast.add({
      title: res.failed ? `${res.ok} sent, ${res.failed} failed` : `${res.ok} events sent`,
      description: `${res.endpoint} in ${res.durationMs} ms`,
      color: res.failed ? 'warning' : 'success',
      icon: res.failed ? 'i-lucide-triangle-alert' : 'i-lucide-send'
    })
  } catch (e) {
    const msg = (e as { data?: { statusMessage?: string }, message?: string }).data?.statusMessage ?? (e as Error).message
    toast.add({ title: 'Send failed', description: msg, color: 'error', icon: 'i-lucide-x' })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    title="Send test events"
    description="Events are posted to the collector's tp2 endpoint and show up in the live stream a moment later."
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <UAlert
          v-if="!ready"
          color="warning"
          variant="subtle"
          icon="i-lucide-loader-circle"
          :title="`${readiness.label}…`"
          description="Sending is enabled once Kafka and the collector answer."
        />
        <UFormField label="What to send">
          <URadioGroup
            v-model="form.kind"
            :items="kinds"
            variant="card"
            size="sm"
          />
        </UFormField>

        <template v-if="form.kind === 'custom'">
          <UFormField
            label="Schema"
            help="Schemas from your linked directory. Data is validated by enrich, not here."
          >
            <USelectMenu
              v-model="form.schema"
              :items="schemaOptions"
              class="w-full font-mono"
              placeholder="iglu:com.acme/my_event/jsonschema/1-0-0"
              create-item
            />
          </UFormField>
          <UFormField label="Event data (JSON)">
            <UTextarea
              v-model="form.data"
              :rows="8"
              class="w-full font-mono"
              autoresize
            />
          </UFormField>
        </template>

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Count">
            <UInputNumber
              v-model="form.count"
              :min="1"
              :max="5000"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Concurrency">
            <UInputNumber
              v-model="form.concurrency"
              :min="1"
              :max="50"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField label="App id">
          <UInput
            v-model="form.appId"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Target">
          <USelect
            v-model="form.target"
            :items="targets"
            class="w-full"
          />
        </UFormField>

        <UCard
          v-if="result"
          variant="subtle"
        >
          <dl class="osc-kv">
            <dt>Endpoint</dt><dd>{{ result.endpoint }}</dd>
            <dt>Sent</dt><dd>{{ result.ok }} ok, {{ result.failed }} failed of {{ result.requested }}</dd>
            <dt>Status codes</dt><dd>{{ Object.entries(result.statusCodes).map(([c, n]) => `${c} × ${n}`).join(', ') || '—' }}</dd>
            <dt>Duration</dt><dd>{{ result.durationMs }} ms</dd>
            <template v-if="result.errors.length">
              <dt>Errors</dt><dd>{{ result.errors.join('; ') }}</dd>
            </template>
          </dl>
        </UCard>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          label="Close"
          @click="open = false"
        />
        <UButton
          icon="i-lucide-send"
          :loading="sending"
          :disabled="!ready"
          :label="`Send ${form.count}`"
          @click="send"
        />
      </div>
    </template>
  </USlideover>
</template>
