<script setup lang="ts">
import type { FolderCheck, KeyCheck, RegistryContext, RegistryKind, RegistryRow } from '~/types/registries'
import { KIND_ICON, KIND_LABEL } from '~/types/registries'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ row: RegistryRow | null, context: RegistryContext }>()
const emit = defineEmits<{ apply: [row: RegistryRow], remove: [uid: string] }>()

const draft = ref<RegistryRow | null>(null)
const isNew = computed(() => !!draft.value?.isNew)
const isLocal = computed(() => draft.value?.kind === 'folder' && draft.value.folderId === 'local')
const showKey = ref(false)
const needsKey = ref(false)
watch(needsKey, (v) => { if (!v && draft.value && draft.value.kind === 'http') draft.value.apikey = '' })
const checking = ref(false)
const keyChecking = ref(false)

watch(() => [open.value, props.row] as const, ([o, r]) => {
  if (o && r) {
    draft.value = { ...r, vendorPrefixes: [...r.vendorPrefixes], check: r.check ?? null, keyCheck: r.keyCheck ?? null }
    showKey.value = false
    needsKey.value = r.kind === 'http' && !!r.apikey
    if (draft.value.kind === 'folder' && !draft.value.path && !isLocal.value) browseOpen.value = true
  }
}, { immediate: true })

const kindOptions = computed(() => ([
  { value: 'folder', label: 'Folder', description: 'A directory this console serves and lets you edit.', icon: KIND_ICON.folder, disabled: false },
  { value: 'snowcatcloud', label: 'SnowcatCloud', description: 'Your hosted registry. Only an API key is needed.', icon: KIND_ICON.snowcatcloud, disabled: props.context.hasSnowcat && props.row?.kind !== 'snowcatcloud' },
  { value: 'http', label: 'HTTP registry', description: 'Iglu Central, an Iglu Server, or any static host.', icon: KIND_ICON.http, disabled: false },
  { value: 'embedded', label: 'Embedded', description: 'Schemas bundled inside the enrich JAR.', icon: KIND_ICON.embedded, disabled: false }
] as Array<{ value: RegistryKind, label: string, description: string, icon: string, disabled: boolean }>))

function setKind(kind: RegistryKind) {
  const d = draft.value
  if (!d) return
  d.kind = kind
  d.check = null
  d.keyCheck = null
  if (kind === 'snowcatcloud') {
    d.uri = props.context.snowcatUrl
    d.keySaved = props.context.snowcatConfigured
    if (!d.name.trim() || d.name === 'My Iglu Server') d.name = 'SnowcatCloud Schema Registry'
  }
  if (kind === 'folder' && !d.folderId) {
    d.folderId = props.context.slug(d.name || 'folder')
    if (!d.path) browseOpen.value = true
  }
  if (kind === 'http' && !d.uri) d.uri = 'https://'
  if (kind === 'embedded' && !d.embeddedPath) d.embeddedPath = '/iglu-client-embedded'
}

// ---- folder browsing / checking
const browseOpen = ref(false)
function onPicked(path: string, display: string) {
  const d = draft.value
  if (!d) return
  d.path = path
  d.display = display
  d.check = null
  if (!d.name.trim() || d.name === 'Extra schema folder') {
    d.name = display.split(/[\\/]/).filter(Boolean).pop() ?? 'Schema folder'
    d.folderId = props.context.slug(d.name)
  }
  void checkFolder()
}
async function checkFolder() {
  const d = draft.value
  if (!d) return
  checking.value = true
  try {
    d.check = await $fetch<FolderCheck>('/api/folders/check', { query: { path: isLocal.value ? props.context.localPath : d.path } })
  } finally {
    checking.value = false
  }
}

// ---- SnowcatCloud key
async function checkKey() {
  const d = draft.value
  if (!d) return
  keyChecking.value = true
  try {
    d.keyCheck = await $fetch<KeyCheck>('/api/registries/snowcatcloud/test', { method: 'POST', body: { apikey: d.apikey } })
  } catch (e) {
    d.keyCheck = { ok: false, authorized: false, pulled: false, status: null, count: 0, vendors: [], sample: [], pulledUri: null, message: (e as Error).message ?? String(e), durationMs: 0 }
  } finally {
    keyChecking.value = false
  }
}
function useVendors() {
  const d = draft.value
  if (!d?.keyCheck?.vendors.length) return
  d.vendorPrefixes = [...new Set([...d.vendorPrefixes, ...d.keyCheck.vendors])]
}

const problem = computed(() => {
  const d = draft.value
  if (!d) return 'Nothing to edit'
  if (!d.name.trim()) return 'Give the registry a name'
  if (d.kind === 'http' && !/^https?:\/\/[^/]+/.test(d.uri)) return 'Enter an http(s) registry URI'
  if (d.kind === 'folder' && !isLocal.value && !d.path.trim()) return 'Pick a folder'
  if (d.kind === 'snowcatcloud' && !d.apikey.trim() && !d.keySaved) return 'Paste your SnowcatCloud API key'
  if (d.kind === 'embedded' && !d.embeddedPath.trim()) return 'Enter the classpath'
  return null
})

function apply() {
  if (!draft.value || problem.value) return
  emit('apply', { ...draft.value, isNew: false })
  open.value = false
}
function remove() {
  if (!draft.value) return
  emit('remove', draft.value.uid)
  open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="isNew ? 'Add registry' : 'Edit registry'"
    :description="draft ? KIND_LABEL[draft.kind] : ''"
    :ui="{ content: 'max-w-xl' }"
  >
    <template #body>
      <div
        v-if="draft"
        class="flex flex-col gap-5"
      >
        <UFormField
          v-if="!isLocal"
          label="Type"
        >
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="k in kindOptions"
              :key="k.value"
              type="button"
              :disabled="k.disabled"
              class="text-left rounded-lg border p-3 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              :class="draft.kind === k.value ? 'border-primary bg-primary/10' : 'border-default hover:bg-elevated/60'"
              @click="setKind(k.value)"
            >
              <div class="flex items-center gap-2 font-medium text-sm">
                <UIcon
                  :name="k.icon"
                  :class="draft.kind === k.value ? 'text-primary' : 'text-muted'"
                />
                {{ k.label }}
              </div>
              <p class="text-xs text-muted mt-1">
                {{ k.description }}
              </p>
            </button>
          </div>
        </UFormField>

        <UFormField label="Name">
          <UInput
            v-model="draft.name"
            class="w-full"
            placeholder="How this registry shows up in lookups and logs"
          />
        </UFormField>

        <template v-if="draft.kind === 'folder'">
          <UFormField
            label="Folder"
            :help="isLocal ? 'The devkit schema directory. Change it with SCHEMAS_DIR in .env and run make run again.' : 'Any folder under your home directory or the linked directory.'"
          >
            <div class="flex gap-1.5">
              <UInput
                :model-value="isLocal ? 'Linked directory (schemas/)' : (draft.display ?? draft.path)"
                class="w-full font-mono"
                readonly
                placeholder="Pick a folder…"
              />
              <UButton
                v-if="!isLocal"
                color="neutral"
                variant="subtle"
                icon="i-lucide-folder-search"
                label="Browse"
                @click="browseOpen = true"
              />
              <UButton
                color="neutral"
                variant="subtle"
                icon="i-lucide-scan-search"
                label="Check"
                :loading="checking"
                :disabled="!isLocal && !draft.path"
                @click="checkFolder"
              />
            </div>
          </UFormField>
          <p class="text-[11px] font-mono text-muted break-all -mt-3">
            Served to enrich at {{ context.folderUrl(draft.folderId || 'local') }}
          </p>
          <UAlert
            v-if="draft.check"
            :color="draft.check.count ? 'success' : draft.check.exists ? 'warning' : 'error'"
            variant="subtle"
            :icon="draft.check.count ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'"
            :title="draft.check.message"
            :description="draft.check.sample.length ? draft.check.sample.join('\n') : undefined"
            :ui="{ description: 'font-mono text-[11px] whitespace-pre-line' }"
          />
        </template>

        <template v-else-if="draft.kind === 'snowcatcloud'">
          <UFormField
            label="API key"
            help="Stored in the console's local store, never in resolver.json. Enrich reaches SnowcatCloud through this console."
          >
            <div class="flex gap-1.5">
              <UInput
                v-model="draft.apikey"
                class="w-full font-mono"
                :type="showKey ? 'text' : 'password'"
                :placeholder="draft.keySaved ? 'Key saved. Paste a new one to replace it.' : 'Paste the key from your SnowcatCloud account'"
                @keydown.enter="checkKey"
              >
                <template #trailing>
                  <UButton
                    :icon="showKey ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    size="xs"
                    color="neutral"
                    variant="link"
                    :aria-label="showKey ? 'Hide key' : 'Show key'"
                    @click="showKey = !showKey"
                  />
                </template>
              </UInput>
              <UButton
                color="neutral"
                variant="subtle"
                icon="i-lucide-shield-check"
                label="Check key"
                :loading="keyChecking"
                :disabled="!draft.apikey.trim() && !draft.keySaved"
                @click="checkKey"
              />
            </div>
          </UFormField>
          <p class="text-xs text-muted -mt-3">
            Registry: <span class="font-mono">{{ context.snowcatUrl }}</span>. No account yet?
            <a
              :href="context.snowcatSignup"
              target="_blank"
              class="text-primary hover:underline"
            >Get one at SnowcatCloud</a>.
          </p>
          <UAlert
            v-if="draft.keyCheck"
            :color="draft.keyCheck.ok ? 'success' : draft.keyCheck.authorized ? 'warning' : 'error'"
            variant="subtle"
            :icon="draft.keyCheck.ok ? 'i-lucide-shield-check' : draft.keyCheck.authorized ? 'i-lucide-triangle-alert' : 'i-lucide-shield-x'"
            :title="draft.keyCheck.message"
            :description="draft.keyCheck.sample.length ? draft.keyCheck.sample.join('\n') : undefined"
            :ui="{ description: 'font-mono text-[11px] whitespace-pre-line' }"
            :actions="draft.keyCheck.vendors.length ? [{ label: `Use ${draft.keyCheck.vendors.length === 1 ? 'vendor' : 'vendors'} as prefixes`, icon: 'i-lucide-tags', color: 'neutral', variant: 'subtle', onClick: useVendors }] : undefined"
          />
        </template>

        <template v-else-if="draft.kind === 'http'">
          <UFormField
            label="Registry URI"
            help="Enrich requests {uri}/schemas/{vendor}/{name}/jsonschema/{version}"
          >
            <UInput
              v-model="draft.uri"
              class="w-full font-mono"
              placeholder="https://iglu.example.com/api"
            />
          </UFormField>
          <USwitch
            v-model="needsKey"
            label="This registry needs an API key"
            size="sm"
          />
          <UFormField
            v-if="needsKey"
            label="API key"
            help="Sent as the apikey header"
          >
            <UInput
              v-model="draft.apikey"
              class="w-full font-mono"
              type="password"
            />
          </UFormField>
        </template>

        <template v-else>
          <UFormField
            label="Classpath"
            help="Schemas bundled inside the enrich JAR. Nothing to check from here."
          >
            <UInput
              v-model="draft.embeddedPath"
              class="w-full font-mono"
              placeholder="/iglu-client-embedded"
            />
          </UFormField>
        </template>

        <UFormField
          label="Vendor prefixes"
          help="Tried first for schemas whose vendor starts with one of these. Empty means fallback for every vendor. Order in the list decides the rest."
        >
          <UInputTags
            v-model="draft.vendorPrefixes"
            class="w-full"
            placeholder="com.acme"
          />
        </UFormField>
      </div>
      <FolderBrowser
        v-model:open="browseOpen"
        :start="draft?.path"
        @select="onPicked"
      />
    </template>
    <template #footer>
      <div class="flex items-center gap-2 w-full">
        <UButton
          v-if="!isNew && !isLocal"
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          label="Remove"
          @click="remove"
        />
        <span
          v-if="problem"
          class="text-xs text-muted ml-auto"
        >{{ problem }}</span>
        <div
          class="flex gap-2"
          :class="{ 'ml-auto': !problem }"
        >
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="open = false"
          />
          <UButton
            icon="i-lucide-check"
            :label="isNew ? 'Add' : 'Apply'"
            :disabled="!!problem"
            @click="apply"
          />
        </div>
      </div>
    </template>
  </USlideover>
</template>
