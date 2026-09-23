/** True only after the component has mounted on the client. Use it to gate client-only loading states so SSR markup matches. */
export function useHydrated() {
  const hydrated = ref(false)
  onMounted(() => { hydrated.value = true })
  return hydrated
}
