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
      icon="i-lucide-badge-check"
      title="Schema is valid"
      description="Self block matches the path, keywords match their types, and it compiles as draft-04 JSON Schema."
    />
    <UAlert
      v-for="(e, i) in lint.errors"
      :key="`e${i}`"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      :title="e.message"
      :description="e.path ? `at ${e.path}` : undefined"
    />
    <UAlert
      v-for="(w, i) in lint.warnings"
      :key="`w${i}`"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="w.message"
      :description="w.path ? `at ${w.path}` : undefined"
    />
  </div>
</template>
