<script setup lang="ts">
defineProps<{ lint: { valid: boolean, errors: Array<{ message: string, path?: string }>, warnings: Array<{ message: string, path?: string }> } | null }>()
</script>

<template>
  <div
    v-if="lint"
    class="flex flex-col gap-2"
  >
    <UAlert
      v-if="!lint.errors.length && !lint.warnings.length"
      color="success"
      variant="subtle"
      icon="i-lucide-circle-check"
      title="Schema looks good"
      description="Valid self-describing JSON Schema. Enrich resolves it live on the next event."
    />
    <UAlert
      v-for="(e, i) in lint.errors"
      :key="`e${i}`"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      :title="e.path ? `${e.path}: ${e.message}` : e.message"
    />
    <UAlert
      v-for="(w, i) in lint.warnings"
      :key="`w${i}`"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="w.path ? `${w.path}: ${w.message}` : w.message"
    />
  </div>
</template>
