<script setup lang="ts">
interface Entry { name: string, path: string, display: string, looksLikeRegistry: boolean }
interface Browse { path: string, display: string, parent: string | null, roots: Array<{ label: string, path: string }>, dirs: Entry[], schemaCount: number, error: string | null }

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ start?: string, inline?: boolean }>()
const emit = defineEmits<{ select: [path: string, display: string] }>()

const state = ref<Browse | null>(null)
const loading = ref(false)
const filter = ref('')

async function go(path?: string) {
  loading.value = true
  try {
    state.value = await $fetch<Browse>('/api/folders/browse', { query: path ? { path } : {} })
    filter.value = ''
  } finally {
    loading.value = false
  }
}

watch(open, (v) => { if (v) go(props.start || undefined) })
onMounted(() => { if (props.inline) go(props.start || undefined) })

const dirs = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return (state.value?.dirs ?? []).filter(d => !q || d.name.toLowerCase().includes(q))
})

function choose() {
  if (!state.value) return
  emit('select', state.value.path, state.value.display)
  if (!props.inline) open.value = false
}
</script>

<template>
  <div
    v-if="inline"
    class="flex flex-col gap-3"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-1.5">
        <UButton
          v-for="r in state?.roots ?? []"
          :key="r.path"
          size="xs"
          color="neutral"
          :variant="state?.path === r.path ? 'solid' : 'subtle'"
          icon="i-lucide-house"
          :label="r.label"
          @click="go(r.path)"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-up"
          label="Up"
          :disabled="!state?.parent"
          @click="state?.parent && go(state.parent)"
        />
        <UInput
          v-model="filter"
          size="xs"
          icon="i-lucide-search"
          placeholder="Filter"
          class="ml-auto w-40"
        />
      </div>
      <p class="font-mono text-xs text-highlighted break-all rounded bg-elevated/60 px-2 py-1.5">
        {{ state?.display ?? '…' }}
      </p>
      <UAlert
        v-if="state?.error"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="state.error"
      />
      <div class="max-h-[50vh] overflow-auto rounded-md border border-default divide-y divide-default">
        <button
          v-for="d in dirs"
          :key="d.path"
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-elevated/60 cursor-pointer"
          @dblclick="go(d.path)"
          @click="go(d.path)"
        >
          <UIcon
            :name="d.looksLikeRegistry ? 'i-lucide-folder-check' : 'i-lucide-folder'"
            :class="d.looksLikeRegistry ? 'text-primary' : 'text-muted'"
          />
          <span class="truncate">{{ d.name }}</span>
          <UBadge
            v-if="d.looksLikeRegistry"
            size="sm"
            color="primary"
            variant="subtle"
            label="schemas"
            class="ml-auto"
          />
        </button>
        <p
          v-if="!loading && !dirs.length"
          class="px-3 py-6 text-center text-sm text-muted"
        >
          No sub-folders here.
        </p>
        <p
          v-if="loading"
          class="px-3 py-6 text-center text-sm text-muted"
        >
          Loading…
        </p>
      </div>
      <p class="text-xs text-muted">
        <template v-if="state?.schemaCount">
          <UIcon
            name="i-lucide-circle-check"
            class="inline-block align-[-2px] text-success"
          />
          {{ state.schemaCount }} schema{{ state.schemaCount === 1 ? '' : 's' }} in this folder.
        </template>
        <template v-else>
          No schemas directly in this folder yet. You can still pick it and create schemas here.
        </template>
      </p>
    </div>
    <div class="flex justify-end">
      <UButton
        icon="i-lucide-check"
        size="sm"
        label="Use this folder"
        :disabled="!state || !!state.error"
        @click="choose"
      />
    </div>
  </div>
  <UModal
    v-else
    v-model:open="open"
    title="Pick a schema folder"
    description="Folders that look like an Iglu registry are listed first."
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-1.5">
          <UButton
            v-for="r in state?.roots ?? []"
            :key="r.path"
            size="xs"
            color="neutral"
            :variant="state?.path === r.path ? 'solid' : 'subtle'"
            icon="i-lucide-house"
            :label="r.label"
            @click="go(r.path)"
          />
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-up"
            label="Up"
            :disabled="!state?.parent"
            @click="state?.parent && go(state.parent)"
          />
          <UInput
            v-model="filter"
            size="xs"
            icon="i-lucide-search"
            placeholder="Filter"
            class="ml-auto w-40"
          />
        </div>
        <p class="font-mono text-xs text-highlighted break-all rounded bg-elevated/60 px-2 py-1.5">
          {{ state?.display ?? '…' }}
        </p>
        <UAlert
          v-if="state?.error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="state.error"
        />
        <div class="max-h-[50vh] overflow-auto rounded-md border border-default divide-y divide-default">
          <button
            v-for="d in dirs"
            :key="d.path"
            type="button"
            class="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-elevated/60 cursor-pointer"
            @dblclick="go(d.path)"
            @click="go(d.path)"
          >
            <UIcon
              :name="d.looksLikeRegistry ? 'i-lucide-folder-check' : 'i-lucide-folder'"
              :class="d.looksLikeRegistry ? 'text-primary' : 'text-muted'"
            />
            <span class="truncate">{{ d.name }}</span>
            <UBadge
              v-if="d.looksLikeRegistry"
              size="sm"
              color="primary"
              variant="subtle"
              label="schemas"
              class="ml-auto"
            />
          </button>
          <p
            v-if="!loading && !dirs.length"
            class="px-3 py-6 text-center text-sm text-muted"
          >
            No sub-folders here.
          </p>
          <p
            v-if="loading"
            class="px-3 py-6 text-center text-sm text-muted"
          >
            Loading…
          </p>
        </div>
        <p class="text-xs text-muted">
          <template v-if="state?.schemaCount">
            <UIcon
              name="i-lucide-circle-check"
              class="inline-block align-[-2px] text-success"
            />
            {{ state.schemaCount }} schema{{ state.schemaCount === 1 ? '' : 's' }} in this folder.
          </template>
          <template v-else>
            No schemas directly in this folder yet. You can still pick it and create schemas here.
          </template>
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="open = false"
        />
        <UButton
          icon="i-lucide-check"
          label="Use this folder"
          :disabled="!state || !!state.error"
          @click="choose"
        />
      </div>
    </template>
  </UModal>
</template>
