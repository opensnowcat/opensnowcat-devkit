<script setup lang="ts">
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { linter, lintGutter } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'
import { indentWithTab } from '@codemirror/commands'

const props = defineProps<{ modelValue: string, readonly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string], 'save': [] }>()

const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null

onMounted(() => {
  if (!host.value) return
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        json(),
        linter(jsonParseLinter()),
        lintGutter(),
        oneDark,
        keymap.of([indentWithTab, { key: 'Mod-s', run: () => { emit('save'); return true } }]),
        EditorState.readOnly.of(!!props.readonly),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) emit('update:modelValue', u.state.doc.toString())
        }),
        EditorView.theme({ '&': { height: '100%', backgroundColor: 'transparent' }, '.cm-gutters': { backgroundColor: 'transparent' } })
      ]
    })
  })
})

watch(() => props.modelValue, (v) => {
  if (!view) return
  const current = view.state.doc.toString()
  if (v !== current) view.dispatch({ changes: { from: 0, to: current.length, insert: v } })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <div
    ref="host"
    class="h-full min-h-[320px] overflow-hidden rounded-md"
  />
</template>
