<script setup>
import { ref, onMounted } from 'vue'
import { Archive, ArrowUpRight } from '@lucide/vue'
import { request, isExtension } from '../client'
const choice = ref(null)
const error = ref('')
const busy = ref(false)
const token = new URLSearchParams(location.search).get('choice')
onMounted(async () => { try { choice.value = await request('choice', { token }); if (!choice.value) throw new Error('This choice expired. Your new tab was kept.') } catch (failure) { error.value = failure.message } })
async function choose(groupId) {
  busy.value = true
  try {
    await request('choose', { token, groupId })
    if (isExtension) await chrome.windows.remove((await chrome.windows.getCurrent()).id)
    else window.close()
  } catch (failure) { error.value = failure.message; busy.value = false }
}
</script>
<template><main class="choice-page"><header><Archive :size="24" /><h1>Restore a topic</h1></header><p v-if="choice" class="choice-url">{{ choice.url }}</p><div v-if="choice" class="choice-list"><button v-for="match in choice.matches" :key="match.groupId" :disabled="busy" @click="choose(match.groupId)"><span><strong>{{ match.name || 'Untitled archive' }}</strong><small>{{ match.count }} tabs</small></span><ArrowUpRight :size="18" /></button></div><button v-if="choice" class="secondary" :disabled="busy" @click="choose(null)">Keep new tab</button><p v-if="error" class="error-text" role="alert">{{ error }}</p></main></template>