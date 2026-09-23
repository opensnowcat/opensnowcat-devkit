<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'
import type { ConsoleInfo } from '~/types/api'

useHead({ title: 'Schemas · OpenSnowcat Console' })

interface Ref { vendor: string, name: string, format: string, version: string }
interface Lint { valid: boolean, errors: Array<{ message: string, path?: string }>, warnings: Array<{ message: string, path?: string }> }
interface VersionEntry { version: string, format: string, size: number, mtimeMs: number, uri: string }
interface Listing { root: string, count: number, vendors: Array<{ vendor: string, names: Array<{ name: string, versions: VersionEntry[] }> }> }

const route = useRoute()
const router = useRouter()
const toast = useToast()
const hydrated = useHydrated()

const { data: listing, refresh: refreshListing, pending: listingPending } = await useFetch<Listing>('/api/schemas', { server: false, lazy: true })
const { data: info } = await useFetch<ConsoleInfo>('/api/info', { server: false, lazy: true })

const current = ref<Ref | null>(null)
const content = ref('')
const original = ref('')
const mtime = ref<number | null>(null)
const lint = ref<Lint | null>(null)
const loading = ref(false)
const saving = ref(false)
const missingUri = ref<string | null>(null)

const dirty = computed(() => content.value !== original.value)
const uri = computed(() => current.value ? `iglu:${current.value.vendor}/${current.value.name}/${current.value.format}/${current.value.version}` : null)
const servedUrl = computed(() => current.value && info.value ? `${info.value.consoleRegistryUrl}/schemas/${current.value.vendor}/${current.value.name}/${current.value.format}/${current.value.version}` : null)

function parseUri(u: string): Ref | null {
  const m = /^iglu:([^/]+)\/([^/]+)\/([^/]+)\/(\d+-\d+-\d+)$/.exec(u.trim())
  return m ? { vendor: m[1]!, name: m[2]!, format: m[3]!, version: m[4]! } : null
}

async function open(ref: Ref) {
  if (dirty.value && !confirm('Discard unsaved changes?')) return
  loading.value = true
  missingUri.value = null
  try {
    const file = await $fetch<{ content: string, mtimeMs: number, lint: Lint }>('/api/schemas/file', { query: ref })
    current.value = ref
    content.value = file.content
    original.value = file.content
    mtime.value = file.mtimeMs
    lint.value = file.lint
    router.replace({ query: { uri: `iglu:${ref.vendor}/${ref.name}/${ref.format}/${ref.version}` } })
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status === 404) {
      missingUri.value = `iglu:${ref.vendor}/${ref.name}/${ref.format}/${ref.version}`
      current.value = null
    } else {
      toast.add({ title: 'Could not open schema', description: String((e as Error).message), color: 'error' })
    }
  } finally {
    loading.value = false
  }
}

let lintTimer: ReturnType<typeof setTimeout> | null = null
watch(content, () => {
  if (!current.value) return
  if (lintTimer) clearTimeout(lintTimer)
  lintTimer = setTimeout(async () => {
    if (!current.value) return
    lint.value = await $fetch<Lint>('/api/schemas/lint', { method: 'POST', body: { ...current.value, content: content.value } })
  }, 350)
})

async function save() {
  if (!current.value || !dirty.value) return
  saving.value = true
  try {
    const res = await $fetch<{ mtimeMs: number, lint: Lint }>('/api/schemas/file', { method: 'PUT', body: { ...current.value, content: content.value, expectedMtimeMs: mtime.value } })
    original.value = content.value
    mtime.value = res.mtimeMs
    lint.value = res.lint
    toast.add({ title: 'Saved', description: res.lint.valid ? 'Live now. Enrich resolves the new version on the next event.' : 'Saved with lint errors. Enrich may reject events until they are fixed.', color: res.lint.valid ? 'success' : 'warning', icon: 'i-lucide-save' })
    await refreshListing()
  } catch (e) {
    const msg = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message
    toast.add({ title: 'Save failed', description: msg, color: 'error', icon: 'i-lucide-x' })
  } finally {
    saving.value = false
  }
}

// ---- tree
const tree = computed<TreeItem[]>(() => (listing.value?.vendors ?? []).map(v => ({
  label: v.vendor,
  icon: 'i-lucide-folder',
  defaultExpanded: true,
  children: v.names.map(n => ({
    label: n.name,
    icon: 'i-lucide-file-json',
    defaultExpanded: true,
    children: n.versions.map(x => ({
      label: x.version,
      icon: 'i-lucide-tag',
      value: x.uri,
      onSelect: () => open({ vendor: v.vendor, name: n.name, format: x.format, version: x.version })
    }))
  }))
})))

// ---- create / bump / delete
const createOpen = ref(false)
const createForm = reactive({ vendor: 'com.example', name: '', version: '1-0-0', description: '' })
async function create(from?: Ref) {
  try {
    const body = from
      ? { vendor: from.vendor, name: from.name, format: from.format, version: bumpForm.version, from }
      : { ...createForm }
    const res = await $fetch<{ ref: Ref }>('/api/schemas/create', { method: 'POST', body })
    createOpen.value = false
    bumpOpen.value = false
    await refreshListing()
    await open(res.ref)
    toast.add({ title: from ? `Created ${bumpForm.version}` : 'Schema created', description: 'It is served to enrich immediately.', color: 'success', icon: 'i-lucide-plus' })
  } catch (e) {
    const msg = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message
    toast.add({ title: 'Could not create schema', description: msg, color: 'error', icon: 'i-lucide-x' })
  }
}

const bumpOpen = ref(false)
const bumpForm = reactive({ version: '' })
function suggestBump(kind: 'addition' | 'revision' | 'model') {
  if (!current.value) return
  const [m, r, a] = current.value.version.split('-').map(Number) as [number, number, number]
  bumpForm.version = kind === 'addition' ? `${m}-${r}-${a + 1}` : kind === 'revision' ? `${m}-${r + 1}-0` : `${m + 1}-0-0`
}
function openBump() {
  suggestBump('addition')
  bumpOpen.value = true
}

const deleteOpen = ref(false)
async function remove() {
  if (!current.value) return
  try {
    await $fetch('/api/schemas/file', { method: 'DELETE', query: current.value })
    toast.add({ title: 'Schema deleted', color: 'success', icon: 'i-lucide-trash-2' })
    deleteOpen.value = false
    current.value = null
    content.value = ''
    original.value = ''
    lint.value = null
    router.replace({ query: {} })
    await refreshListing()
  } catch (e) {
    toast.add({ title: 'Delete failed', description: String((e as Error).message), color: 'error' })
  }
}

// ---- validate sample data
const sampleOpen = ref(false)
const sample = ref('{\n  \n}')
const sampleResult = ref<{ valid: boolean, errors: string[] } | null>(null)
async function validateSample() {
  if (!current.value) return
  let data: unknown
  try {
    data = JSON.parse(sample.value)
  } catch (e) {
    sampleResult.value = { valid: false, errors: [`Sample is not valid JSON: ${(e as Error).message}`] }
    return
  }
  sampleResult.value = await $fetch('/api/schemas/validate', { method: 'POST', body: { ...current.value, data } })
}

async function copyUri() {
  if (!uri.value) return
  const ok = await copyText(uri.value)
  toast.add({ title: ok ? 'Iglu URI copied' : 'Copy failed', color: ok ? 'success' : 'error' })
}

function createMissing() {
  const ref = missingUri.value ? parseUri(missingUri.value) : null
  if (!ref) return
  createForm.vendor = ref.vendor
  createForm.name = ref.name
  createForm.version = ref.version
  createOpen.value = true
}

onMounted(() => {
  const q = typeof route.query.uri === 'string' ? parseUri(route.query.uri) : null
  if (q) open(q)
})
</script>

<template>
  <UDashboardPanel id="schemas">
    <template #header>
      <UDashboardNavbar
        title="Schemas"
        icon="i-lucide-file-json"
      >
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UTooltip :text="listing ? `${listing.count} schemas in ${listing.root}` : 'Refresh'">
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              :loading="hydrated && listingPending"
              @click="refreshListing()"
            />
          </UTooltip>
          <UButton
            icon="i-lucide-plus"
            label="New schema"
            @click="createOpen = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] h-full">
        <aside class="min-w-0 flex flex-col gap-3">
          <p class="text-xs text-muted">
            Linked directory
          </p>
          <code class="text-[11px] font-mono text-highlighted break-all rounded bg-elevated/60 px-2 py-1.5">{{ listing?.root ?? '…' }}</code>
          <UTree
            v-if="tree.length"
            :items="tree"
            size="sm"
            color="neutral"
          />
          <UEmpty
            v-else-if="hydrated && !listingPending"
            icon="i-lucide-folder-open"
            title="No schemas yet"
            description="Create one, or drop files into the linked directory using the Iglu layout: vendor/name/jsonschema/1-0-0"
            :ui="{ root: 'py-6' }"
          >
            <template #actions>
              <UButton
                icon="i-lucide-plus"
                label="New schema"
                size="sm"
                @click="createOpen = true"
              />
            </template>
          </UEmpty>
        </aside>

        <section class="min-w-0 flex flex-col gap-3 min-h-[60vh]">
          <UAlert
            v-if="missingUri"
            color="warning"
            variant="subtle"
            icon="i-lucide-file-question"
            :title="`${missingUri} is not in the linked directory`"
            description="Events referencing it will fail with a resolution error unless another registry serves it."
            :actions="[{ label: 'Create it here', icon: 'i-lucide-plus', onClick: createMissing }]"
          />
          <template v-if="current">
            <div class="flex flex-wrap items-center gap-2">
              <UButton
                variant="link"
                color="primary"
                class="px-0 font-mono text-sm"
                :label="uri ?? ''"
                trailing-icon="i-lucide-copy"
                @click="copyUri"
              />
              <UBadge
                v-if="dirty"
                color="warning"
                variant="subtle"
                label="Unsaved"
              />
              <UBadge
                v-else-if="lint?.valid"
                color="success"
                variant="subtle"
                label="Live"
                icon="i-lucide-radio"
              />
              <div class="ml-auto flex items-center gap-1.5">
                <UButton
                  icon="i-lucide-flask-conical"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  label="Test data"
                  @click="sampleOpen = true"
                />
                <UButton
                  icon="i-lucide-git-branch"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  label="New version"
                  @click="openBump"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="subtle"
                  size="sm"
                  @click="deleteOpen = true"
                />
                <UButton
                  icon="i-lucide-save"
                  size="sm"
                  label="Save"
                  :disabled="!dirty"
                  :loading="saving"
                  @click="save"
                />
              </div>
            </div>
            <p
              v-if="servedUrl"
              class="text-[11px] text-muted font-mono break-all"
            >
              Served to enrich at {{ servedUrl }}
            </p>
            <div class="flex-1 min-h-[360px]">
              <ClientOnly>
                <CodeEditor
                  v-model="content"
                  @save="save"
                />
                <template #fallback>
                  <USkeleton class="h-[360px] w-full" />
                </template>
              </ClientOnly>
            </div>
            <LintResults :lint="lint" />
          </template>
          <UEmpty
            v-else-if="!missingUri"
            icon="i-lucide-mouse-pointer-click"
            title="Pick a schema"
            description="Edits are written straight to the linked directory and served to enrich immediately. No restart, no cache."
            class="flex-1"
          />
        </section>
      </div>
    </template>
  </UDashboardPanel>

  <UModal
    v-model:open="createOpen"
    title="New schema"
    description="Creates vendor/name/jsonschema/version in the linked directory from a starter template."
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UFormField
          label="Vendor"
          help="Reverse domain, e.g. com.acme"
        >
          <UInput
            v-model="createForm.vendor"
            class="w-full font-mono"
          />
        </UFormField>
        <UFormField
          label="Name"
          help="snake_case event or entity name"
        >
          <UInput
            v-model="createForm.name"
            class="w-full font-mono"
            placeholder="product_view"
          />
        </UFormField>
        <UFormField
          label="Version"
          help="MODEL-REVISION-ADDITION"
        >
          <UInput
            v-model="createForm.version"
            class="w-full font-mono"
          />
        </UFormField>
        <UFormField label="Description">
          <UInput
            v-model="createForm.description"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="createOpen = false"
        />
        <UButton
          icon="i-lucide-plus"
          label="Create"
          :disabled="!createForm.vendor || !createForm.name || !createForm.version"
          @click="create()"
        />
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="bumpOpen"
    title="New version"
    :description="current ? `Copy ${current.name} ${current.version} to a new version and update its self block.` : ''"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UFieldGroup size="sm">
          <UButton
            color="neutral"
            variant="subtle"
            label="Addition"
            @click="suggestBump('addition')"
          />
          <UButton
            color="neutral"
            variant="subtle"
            label="Revision"
            @click="suggestBump('revision')"
          />
          <UButton
            color="neutral"
            variant="subtle"
            label="Model"
            @click="suggestBump('model')"
          />
        </UFieldGroup>
        <UFormField
          label="New version"
          help="Addition for backwards-compatible tweaks, revision for new optional fields, model for breaking changes."
        >
          <UInput
            v-model="bumpForm.version"
            class="w-full font-mono"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="bumpOpen = false"
        />
        <UButton
          icon="i-lucide-git-branch"
          label="Create version"
          @click="current && create(current)"
        />
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="deleteOpen"
    title="Delete schema?"
    :description="uri ?? ''"
  >
    <template #body>
      <p class="text-sm text-muted">
        The file is removed from the linked directory. Events referencing it will fail to resolve from then on.
      </p>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="deleteOpen = false"
        />
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          label="Delete"
          @click="remove"
        />
      </div>
    </template>
  </UModal>

  <USlideover
    v-model:open="sampleOpen"
    title="Test data against this schema"
    :description="uri ?? ''"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UTextarea
          v-model="sample"
          :rows="12"
          class="w-full font-mono"
          autoresize
        />
        <UAlert
          v-if="sampleResult"
          :color="sampleResult.valid ? 'success' : 'error'"
          variant="subtle"
          :icon="sampleResult.valid ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
          :title="sampleResult.valid ? 'Data is valid' : 'Data does not match'"
          :description="sampleResult.errors.join('\n')"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          icon="i-lucide-flask-conical"
          label="Validate"
          @click="validateSample"
        />
      </div>
    </template>
  </USlideover>
</template>
