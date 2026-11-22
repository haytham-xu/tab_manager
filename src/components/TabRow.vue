<script setup>
import { ref } from 'vue'
import { ArrowUpRight, Globe, Info, Pin, X } from '@lucide/vue'
import { groupName, tabName } from '../core/model'
import IconButton from './IconButton.vue'
defineProps({ tab: Object, index: Number, sandbox: Boolean, archived: Boolean, selected: Boolean, targets: Array, target: String, color: Number, busy: Boolean })
const emit = defineEmits(['activate', 'close', 'info', 'select', 'target', 'assign', 'dragstart', 'drop'])
const imageFailed = ref(false)
</script>
<template>
  <div class="tab-row" :data-tab-id="tab.id" :class="[{ 'sandbox-row': sandbox, 'is-active': tab.active && !archived, 'is-archived': archived }, color !== undefined ? `duplicate-${color}` : '']" draggable="true" @dragstart="emit('dragstart', $event)" @dragover.prevent @drop.stop.prevent="emit('drop', $event)">
    <input v-if="sandbox" type="checkbox" :checked="selected" :aria-label="`Select ${tabName(tab)}`" @click.stop @change="emit('select', $event.target.checked)" />
    <span v-else class="tab-index" :class="{ active: tab.active && !archived }">{{ index }}</span>
    <img v-if="tab.favicon && !imageFailed" :src="tab.favicon" class="tab-favicon" alt="" loading="lazy" @error="imageFailed = true" />
    <Globe v-else class="tab-favicon" :size="16" />
    <button class="tab-title" :title="tabName(tab)" :disabled="busy" @click="emit('activate')"><Pin v-if="tab.pinned" :size="11" /><span class="tab-title-text">{{ tabName(tab) }}</span></button>
    <div class="row-actions" @click.stop>
      <span v-if="!sandbox && !archived && !tab.assigned" class="sandbox-indicator" title="Unassigned tab in Sandbox">Sandbox</span>
      <IconButton label="Tab details" :icon="Info" @click="emit('info')" />
      <template v-if="sandbox"><select :value="target" aria-label="Target topic" @change="emit('target', $event.target.value)"><option v-for="group in targets" :key="group.id" :value="group.id">{{ groupName(group) }}{{ group.status === 'archived' ? ' · Archived' : '' }}</option></select><button class="assign-button" :disabled="busy || !target" @click="emit('assign')">Assign</button><IconButton label="Focus tab" :icon="ArrowUpRight" :disabled="busy" @click="emit('activate')" /></template>
      <IconButton :label="archived ? 'Remove archived tab' : 'Close tab'" :icon="X" class="close-button" :disabled="busy" @click="emit('close')" />
    </div>
  </div>
</template>