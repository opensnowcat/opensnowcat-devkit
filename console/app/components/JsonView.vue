<script setup lang="ts">
const props = defineProps<{ value: unknown, maxHeight?: string }>()
const text = computed(() => pretty(props.value))
const toast = useToast()
async function copy() {
  const ok = await copyText(text.value)
  toast.add({ title: ok ? 'Copied to clipboard' : 'Copy failed', color: ok ? 'success' : 'error', icon: ok ? 'i-lucide-check' : 'i-lucide-x' })
}
</script>

<template>
  <div class="relative group">
    <UButton
      icon="i-lucide-copy"
      size="xs"
      color="neutral"
      variant="ghost"
      class="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
      aria-label="Copy JSON"
      @click="copy"
    />
    <pre
      class="osc-json"
      :style="{ maxHeight: maxHeight ?? '60vh' }"
    >{{ text }}</pre>
  </div>
</template>
