<script setup>
import { inject, onMounted, ref, useId } from 'vue'
import { X } from '@lucide/vue'
defineProps({ title: String, wide: Boolean })
const emit = defineEmits(['close'])
const dialog = ref(null)
const id = useId()
const error = inject('operationError', ref(''))
onMounted(() => { dialog.value.showModal() })
</script>
<template><dialog ref="dialog" class="modal" :class="{ wide }" :aria-labelledby="id" @cancel.prevent="emit('close')" @click="$event.target === dialog && emit('close')"><header class="modal-header"><h2 :id="id">{{ title }}</h2><button class="icon-button" aria-label="Close dialog" @click="emit('close')"><X :size="18" /></button></header><div class="modal-body"><p v-if="error" class="error-text" role="alert">{{ error }}</p><slot /></div></dialog></template>