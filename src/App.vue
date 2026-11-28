<script setup>
import { computed, nextTick, onMounted, onUnmounted, provide, reactive, ref, watch } from 'vue'
import { Archive, ArrowDownToLine, ChevronDown, ChevronRight, CloudOff, Download, FolderOpen, LayoutPanelLeft, LoaderCircle, MoreHorizontal, Pin, RefreshCw, Search, Settings, SlidersHorizontal, Trash2, Upload, X } from '@lucide/vue'
import { isExtension, request, subscribe } from './client'
import { LAYOUT_OPTIONS, LAYOUT_WIDTH_OPTIONS, SETTINGS, duplicateColors, groupName, normalizeSettings, tabName } from './core/model'
import { LAYOUT_METRICS, LAYOUT_PRESETS, closestLayoutPreset, resolveLayout } from './core/layout'
import IconButton from './components/IconButton.vue'
import Modal from './components/Modal.vue'
import TabRow from './components/TabRow.vue'

const iconURL = new URL('icons/icon32.png', location.href).href
const state = ref({ groups: [], settings: structuredClone(SETTINGS) })
const loading = ref(true)
const busy = ref(false)
const error = ref('')
provide('operationError', error)
const notice = ref('')
const view = ref('regular')
const query = ref('')
const selected = ref([])
const targets = reactive({})
const bulkTarget = ref('')
const info = ref(null)
const edit = ref(null)
const confirmation = ref(null)
const settingsOpen = ref(false)
const layoutDraft = reactive({})
const selectedLayoutPreset = ref('')
const workspace = ref(null)
const workspaceSpace = reactive({ width: 0, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, ...LAYOUT_METRICS })
const batchId = ref(null)
const batchSelected = ref([])
const batchQuery = ref('')
const batchTarget = ref('')
const duplicateOnly = ref(false)
const selectedGroups = ref([])
const drag = ref(null)
const backupInput = ref(null)
let unsubscribe = () => {}
let noticeTimer
let refreshing = false
let workspaceObserver
let layoutFrame = 0

const layoutSettings = computed(() => normalizeSettings(state.value.settings))

const sandbox = computed(() => state.value.groups.filter(group => group.status === 'live').flatMap(group => group.tabs.filter(tab => !tab.assigned).map(tab => ({ ...tab, groupId: group.id }))))
const colors = computed(() => duplicateColors(state.value.groups))
const currentGroups = computed(() => state.value.groups.filter(group => group.hibernate === (view.value === 'hibernate')))
const visibleGroups = computed(() => currentGroups.value.filter(group => !query.value || `${groupName(group)} ${group.tabs.map(tab => `${tabName(tab)} ${tab.url}`).join(' ')}`.toLowerCase().includes(query.value.toLowerCase())))
const unnamedGroups = computed(() => state.value.groups.filter(group => !group.name?.trim()))
const manageableGroups = computed(() => state.value.groups.filter(group => !query.value || `${groupName(group)} ${group.tabs.map(tab => `${tabName(tab)} ${tab.url}`).join(' ')}`.toLowerCase().includes(query.value.toLowerCase())))
const layoutArea = computed(() => ({ ...workspaceSpace, groupCount: visibleGroups.value.length }))
const currentLayout = computed(() => resolveLayout(layoutSettings.value, layoutArea.value))
const automaticLayout = computed(() => resolveLayout({ ...layoutSettings.value, layoutMode: 'auto' }, layoutArea.value))
const suggestedPreset = computed(() => closestLayoutPreset(workspaceSpace.viewportWidth))
const layoutStyle = computed(() => ({
  '--sandbox-width': currentLayout.value.sandboxWidth + 'px',
  '--sandbox-min-width': LAYOUT_OPTIONS.sandboxWidth.min + 'px',
  '--topic-width': currentLayout.value.topicWidth + 'px',
  '--topic-visible-tabs': currentLayout.value.topicVisibleTabs,
}))
const allTabs = computed(() => state.value.groups.reduce((sum, group) => sum + group.tabs.length, 0))
const batchGroup = computed(() => state.value.groups.find(group => group.id === batchId.value))
const batchTabs = computed(() => (batchGroup.value?.tabs || []).filter(tab => (!batchQuery.value || `${tabName(tab)} ${tab.url}`.toLowerCase().includes(batchQuery.value.toLowerCase())) && (!duplicateOnly.value || (batchGroup.value.tabs.filter(item => item.url === tab.url).length > 1))))
const batchDuplicates = computed(() => {
  const seen = new Set()
  return (batchGroup.value?.tabs || []).filter(tab => { if (seen.has(tab.url)) return true; seen.add(tab.url); return false }).length
})

function accept(snapshot) {
  const previousGroups = new Map(sandbox.value.map(tab => [tab.id, tab.groupId]))
  state.value = snapshot
  const valid = new Set(sandbox.value.map(tab => tab.id))
  selected.value = selected.value.filter(id => valid.has(id))
  for (const tab of sandbox.value) {
    const target = targets[tab.id]
    const followedPreviousGroup = target === previousGroups.get(tab.id)
    if (followedPreviousGroup || !state.value.groups.some(group => group.id === target)) targets[tab.id] = tab.groupId
  }
  if (batchId.value && !batchGroup.value) batchId.value = null
  batchSelected.value = batchSelected.value.filter(id => batchGroup.value?.tabs.some(tab => tab.id === id))
  selectedGroups.value = selectedGroups.value.filter(id => state.value.groups.some(group => group.id === id))
}

async function refresh() {
  if (refreshing || busy.value) return
  refreshing = true
  try { accept(await request('snapshot')); error.value = ''; await revealActive() }
  catch (failure) { error.value = failure.message }
  finally { loading.value = false; refreshing = false }
}

async function run(action, payload, message = '') {
  if (busy.value) return false
  busy.value = true
  error.value = ''
  try {
    const result = await request(action, payload)
    if (result?.groups) accept(result)
    if (message) toast(message)
    return true
  } catch (failure) { error.value = failure.message; return false }
  finally { busy.value = false; await refresh() }
}

function toast(message) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = '' }, 3500)
}

function dismissActionMenu(event) {
  const command = event.target.closest('.menu-panel button')
  const menu = command?.closest('details.action-menu')
  if (menu) menu.open = false
}

function dismissOutsideActionMenus(event) {
  for (const menu of document.querySelectorAll('details.action-menu[open]')) {
    if (!menu.contains(event.target)) menu.open = false
  }
}

function selectTab(id, value, batch = false) {
  const collection = batch ? batchSelected : selected
  collection.value = value ? [...new Set([...collection.value, id])] : collection.value.filter(item => item !== id)
}

function groupTabs(group) {
  if (!query.value || groupName(group).toLowerCase().includes(query.value.toLowerCase())) return group.tabs
  return group.tabs.filter(tab => `${tabName(tab)} ${tab.url}`.toLowerCase().includes(query.value.toLowerCase()))
}

function ask(title, body, action) { confirmation.value = { title, body, action } }
async function confirm() { if (await confirmation.value.action()) confirmation.value = null }

function closeTab(group, tab) {
  const action = () => run('close', { tabIds: [tab.id] })
  if (group.status === 'archived') ask('Remove archived tab?', `Remove “${tabName(tab)}” from this archive?`, action)
  else action()
}

function beginEdit(group, tab) { edit.value = { groupId: group.id, tabId: tab?.id, name: tab ? tab.name || tab.title : group.name } }
async function saveEdit() {
  const value = edit.value
  if (await run(value.tabId ? 'renameTab' : 'renameGroup', value)) edit.value = null
}

function toggleGroup(group) {
  const collapsed = state.value.settings.collapsedGroups
  run('settings', { collapsedGroups: collapsed.includes(group.id) ? collapsed.filter(id => id !== group.id) : [...collapsed, group.id] })
}

async function revealActive() {
  if (!state.value.settings.followActive) return
  await nextTick()
  for (const row of document.querySelectorAll('.topic-tabs .tab-row.is-active')) {
    const list = row.closest('.topic-tabs')
    const bounds = row.getBoundingClientRect()
    const parent = list.getBoundingClientRect()
    if (bounds.top < parent.top) list.scrollTop -= parent.top - bounds.top
    else if (bounds.bottom > parent.bottom) list.scrollTop += bounds.bottom - parent.bottom
  }
}

function openBatch(group) { batchId.value = group.id; batchSelected.value = []; batchQuery.value = ''; batchTarget.value = ''; duplicateOnly.value = false }
function toggleGroupSelection(id, value) {
  selectedGroups.value = value ? [...new Set([...selectedGroups.value, id])] : selectedGroups.value.filter(item => item !== id)
}
function selectUnnamedGroups() {
  selectedGroups.value = unnamedGroups.value.map(group => group.id)
}
function openGroups() {
  view.value = 'groups'
}
function deleteSelectedGroups() {
  const groups = selectedGroups.value.map(id => state.value.groups.find(group => group.id === id)).filter(Boolean)
  ask('Delete selected groups?', `Permanently delete ${groups.length} groups${groups.some(group => group.status === 'live') ? ', closing any live windows they contain' : ''}?`, async () => {
    for (const group of groups) if (!await run('delete', { groupId: group.id })) return false
    selectedGroups.value = []
    toast(`${groups.length} groups deleted`)
    return true
  })
}
async function batchMove() {
  if (await run('transfer', { tabIds: batchSelected.value, groupId: batchTarget.value }, 'Tabs assigned')) batchSelected.value = []
}
function batchClose() {
  const ids = [...batchSelected.value]
  ask('Remove selected tabs?', `Remove ${ids.length} tabs from “${groupName(batchGroup.value)}”?`, () => run('close', { tabIds: ids }))
}
function dedupeBatch() {
  const groups = new Map()
  for (const tab of batchGroup.value.tabs) {
    if (!groups.has(tab.url)) groups.set(tab.url, [])
    groups.get(tab.url).push(tab)
  }
  const ids = [...groups.values()].flatMap(tabs => {
    const keep = tabs.find(tab => tab.active) || tabs.find(tab => tab.pinned) || tabs[0]
    return tabs.filter(tab => tab.id !== keep.id).map(tab => tab.id)
  })
  ask('Remove duplicate tabs?', `Remove ${ids.length} duplicates from this topic? Active or pinned tabs are kept first.`, () => run('close', { tabIds: ids }, 'Duplicates removed'))
}
function sortBatch() {
  const host = tab => { try { return new URL(tab.url).hostname } catch { return '' } }
  const tabs = [...batchGroup.value.tabs].sort((first, second) => host(first).localeCompare(host(second)) || tabName(first).localeCompare(tabName(second)))
  run('reorderTabs', { groupId: batchId.value, ids: tabs.map(tab => tab.id) })
}

function startTab(event, group, tab) { drag.value = { type: 'tab', groupId: group.id, id: tab.id }; event.dataTransfer.setData('text/plain', tab.id); event.dataTransfer.effectAllowed = 'move' }
function startGroup(event, group) {
  if (event.target.closest('button, input, details')) { event.preventDefault(); return }
  drag.value = { type: 'group', id: group.id }
  event.dataTransfer.setData('text/plain', group.id)
}
function drop(event, group, targetTab) {
  event.preventDefault()
  const source = drag.value
  drag.value = null
  if (!source) return
  if (source.type === 'group') {
    const ids = state.value.groups.map(item => item.id).filter(id => id !== source.id)
    ids.splice(ids.indexOf(group.id), 0, source.id)
    run('reorderGroups', { ids })
  } else if (source.groupId !== group.id) run('transfer', { tabIds: [source.id], groupId: group.id })
  else if (targetTab && targetTab.id !== source.id) {
    const ids = group.tabs.map(tab => tab.id).filter(id => id !== source.id)
    ids.splice(ids.indexOf(targetTab.id), 0, source.id)
    run('reorderTabs', { groupId: group.id, ids })
  }
}

function openSettings() {
  for (const key of Object.keys(LAYOUT_OPTIONS)) layoutDraft[key] = layoutSettings.value[key]
  layoutDraft.layoutMode = layoutSettings.value.layoutMode
  selectedLayoutPreset.value = ''
  settingsOpen.value = true
}
function resetLayoutDraft() {
  for (const key of Object.keys(LAYOUT_WIDTH_OPTIONS)) layoutDraft[key] = SETTINGS[key]
  layoutDraft.layoutMode = SETTINGS.layoutMode
  selectedLayoutPreset.value = ''
}
function chooseLayoutPreset() {
  const preset = LAYOUT_PRESETS.find(item => item.id === selectedLayoutPreset.value)
  if (preset) for (const key of Object.keys(LAYOUT_WIDTH_OPTIONS)) layoutDraft[key] = preset[key]
}
function editLayoutNumber(key, event) {
  layoutDraft[key] = event.target.value === '' ? '' : event.target.valueAsNumber
}
async function saveLayout() {
  if (await run('settings', { ...layoutDraft }, 'Layout saved')) {
    for (const key of Object.keys(LAYOUT_OPTIONS)) layoutDraft[key] = layoutSettings.value[key]
    layoutDraft.layoutMode = layoutSettings.value.layoutMode
  }
}
async function exportBackup() {
  try {
    const backup = await request('backup')
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = `tab-manager-${new Date().toISOString().slice(0, 10)}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast('Backup exported')
  } catch (failure) { error.value = failure.message }
}
async function importBackup(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('Backup exceeds 10 MB.')
    const backup = JSON.parse(await file.text())
    ask('Import backup?', 'Saved topics will be added as archives. Existing windows and archives will not be replaced.', () => run('import', { backup }, 'Backup imported'))
  } catch (failure) { error.value = failure.message }
}
function archiveAll() {
  const groups = state.value.groups.filter(group => group.status === 'live')
  ask('Archive all windows?', `${groups.length} browser windows will be saved and closed.`, async () => {
    for (const group of groups) if (!await run('archive', { groupId: group.id })) return false
    return true
  })
}

function measureLayout() {
  layoutFrame = 0
  if (!workspace.value) return
  const element = workspace.value
  const style = getComputedStyle(element)
  workspaceSpace.viewportWidth = window.innerWidth
  workspaceSpace.viewportHeight = window.innerHeight
  workspaceSpace.width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  workspaceSpace.workspaceGap = parseFloat(style.columnGap) || 0
  workspaceSpace.topicGap = parseFloat(getComputedStyle(element.querySelector('.topics')).columnGap) || 0
}
function queueLayoutMeasure() {
  if (!layoutFrame) layoutFrame = requestAnimationFrame(measureLayout)
}
watch([error, () => state.value.settings.sandboxVisible, () => sandbox.value.length, () => visibleGroups.value.length], queueLayoutMeasure, { flush: 'post' })

onMounted(async () => {
  workspaceObserver = new ResizeObserver(queueLayoutMeasure)
  workspaceObserver.observe(workspace.value)
  window.addEventListener('resize', queueLayoutMeasure)
  window.visualViewport?.addEventListener('resize', queueLayoutMeasure)
  queueLayoutMeasure()
  document.addEventListener('click', dismissOutsideActionMenus, true)
  await refresh()
  unsubscribe = subscribe(refresh)
})
onUnmounted(() => {
  workspaceObserver?.disconnect()
  window.removeEventListener('resize', queueLayoutMeasure)
  window.visualViewport?.removeEventListener('resize', queueLayoutMeasure)
  cancelAnimationFrame(layoutFrame)
  document.removeEventListener('click', dismissOutsideActionMenus, true)
  unsubscribe()
  clearTimeout(noticeTimer)
})
</script>

<template>
  <main class="manager" @click="dismissActionMenu">
    <header class="app-header">
      <div class="header-left">
        <div class="brand"><img class="brand-mark" :src="iconURL" alt="" width="33" height="33" /><h1>Tab Manager</h1><span v-if="!isExtension" class="preview-label">Preview</span></div>
        <div class="segmented sandbox-switch"><button :class="{ active: state.settings.sandboxVisible }" :aria-expanded="state.settings.sandboxVisible" @click="run('settings', { sandboxVisible: !state.settings.sandboxVisible })"><LayoutPanelLeft :size="15" />Sandbox<span class="count">{{ sandbox.length }}</span></button></div>
        <div class="segmented view-switch"><button :class="{ active: view === 'regular' }" @click="view = 'regular'">Regular<span class="count">{{ state.groups.filter(group => !group.hibernate).length }}</span></button><button :class="{ active: view === 'hibernate' }" @click="view = 'hibernate'">Hibernate<span class="count">{{ state.groups.filter(group => group.hibernate).length }}</span></button></div>
      </div>
      <div class="header-right">
        <label class="search-field"><Search :size="16" /><input v-model="query" type="search" placeholder="Search tabs or topics" aria-label="Search tabs or topics" /></label>
        <button class="header-toggle" role="switch" :aria-checked="state.settings.reuseEnabled" @click="run('settings', { reuseEnabled: !state.settings.reuseEnabled })"><span>Unique Tabs</span><span class="switch-track" :class="{ enabled: state.settings.reuseEnabled }"><span class="switch-thumb"></span></span></button>
        <button class="header-toggle" role="switch" :aria-checked="state.settings.followActive" @click="run('settings', { followActive: !state.settings.followActive })"><span>Focus Tab</span><span class="switch-track" :class="{ enabled: state.settings.followActive }"><span class="switch-thumb"></span></span></button>
        <IconButton label="Sync tabs" :icon="loading || busy ? LoaderCircle : RefreshCw" :class="{ spinning: loading || busy }" :disabled="busy" @click="refresh" />
        <details class="action-menu header-menu"><summary aria-label="More options"><MoreHorizontal :size="19" /></summary><div class="menu-panel"><button :class="{ 'menu-current': view === 'groups' }" @click="openGroups">Groups</button><button @click="openSettings">Settings</button><button @click="archiveAll">Archive all windows</button></div></details>
      </div>
      <span class="toolbar-total toolbar-meta-hidden">{{ allTabs }} tabs · {{ state.groups.length }} topics</span>
      <span class="local-label toolbar-meta-hidden"><CloudOff :size="14" />Local only</span>
      <input ref="backupInput" type="file" accept="application/json,.json" hidden @change="importBackup" />
    </header>

    <div v-if="error" class="error-banner" role="alert"><span>{{ error }}</span><button aria-label="Dismiss error" @click="error = ''"><X :size="16" /></button></div>
    <section v-if="view === 'groups'" class="group-manager" aria-label="Manage groups">
      <header class="group-manager-header"><div class="group-manager-title"><h2>Manage groups</h2><span>{{ manageableGroups.length }} groups · {{ unnamedGroups.length }} unnamed</span></div><div class="group-manager-actions"><button class="secondary" :disabled="!unnamedGroups.length" @click="selectUnnamedGroups">Select unnamed</button><label><input type="checkbox" :checked="manageableGroups.length > 0 && manageableGroups.every(group => selectedGroups.includes(group.id))" @change="selectedGroups = $event.target.checked ? [...new Set([...selectedGroups, ...manageableGroups.map(group => group.id)])] : selectedGroups.filter(id => !manageableGroups.some(group => group.id === id))" />Select all</label><span>{{ selectedGroups.length }} selected</span><button class="danger-button" :disabled="!selectedGroups.length || busy" @click="deleteSelectedGroups"><Trash2 :size="14" />Delete selected</button></div></header>
      <div class="group-manager-list"><div v-for="group in manageableGroups" :key="group.id" class="group-manager-row"><input type="checkbox" :checked="selectedGroups.includes(group.id)" :aria-label="`Select ${group.name?.trim() || 'Uncategorized'}`" @change="toggleGroupSelection(group.id, $event.target.checked)" /><span class="group-manager-name" :title="groupName(group)">{{ group.name?.trim() || 'Uncategorized' }}</span><span class="group-manager-status" :class="group.status">{{ group.status === 'live' ? 'Live window' : 'Archived' }}</span><span class="group-manager-meta">{{ group.tabs.length }} tabs · {{ group.hibernate ? 'Hibernate' : 'Regular' }}</span></div><div v-if="!manageableGroups.length" class="empty-inline"><FolderOpen :size="24" /><span>{{ query ? 'No matching groups' : 'No groups' }}</span></div></div>
    </section>
    <div v-else ref="workspace" class="workspace" :style="layoutStyle" :data-layout-mode="currentLayout.mode" :data-layout-preset="currentLayout.preset?.id || 'manual'" :data-window-width="workspaceSpace.viewportWidth" :data-window-height="workspaceSpace.viewportHeight" :class="{ 'sandbox-hidden': !state.settings.sandboxVisible, 'is-stacked': currentLayout.stacked }">
      <aside v-if="state.settings.sandboxVisible" class="sandbox-panel" aria-label="Sandbox">
        <header class="sandbox-header"><h2>Sandbox <span class="count">{{ sandbox.length }}</span></h2><label><input type="checkbox" :checked="sandbox.length > 0 && selected.length === sandbox.length" :indeterminate="selected.length > 0 && selected.length < sandbox.length" @change="selected = $event.target.checked ? sandbox.map(tab => tab.id) : []" />Select all</label><IconButton label="Hide Sandbox" :icon="LayoutPanelLeft" @click="run('settings', { sandboxVisible: false })" /></header>
        <div class="sandbox-toolbar"><select v-model="bulkTarget" aria-label="Bulk target topic"><option value="">Move selected to…</option><option v-for="group in state.groups" :key="group.id" :value="group.id">{{ groupName(group) }}{{ group.status === 'archived' ? ' · Archived' : '' }}</option></select><button class="primary" :disabled="!selected.length || !bulkTarget || busy" @click="run('transfer', { tabIds: selected, groupId: bulkTarget }, 'Tabs assigned')">Move</button><button class="secondary" :disabled="!selected.length || busy" @click="run('assign', { tabIds: selected }, 'Tabs assigned')">Assign current group</button></div>
        <div class="sandbox-tabs">
          <TabRow v-for="tab in sandbox" :key="tab.id" :tab="tab" :index="0" sandbox :selected="selected.includes(tab.id)" :targets="state.groups" :target="targets[tab.id]" :color="colors.get(tab.url)" :busy="busy" @select="selectTab(tab.id, $event)" @target="targets[tab.id] = $event" @assign="run('transfer', { tabIds: [tab.id], groupId: targets[tab.id] })" @activate="run('activate', { tabId: tab.id })" @close="run('close', { tabIds: [tab.id] })" @info="info = { tab, group: state.groups.find(group => group.id === tab.groupId) }" @dragstart="startTab($event, state.groups.find(group => group.id === tab.groupId), tab)" />
          <div v-if="!sandbox.length" class="empty-inline"><FolderOpen :size="24" /><span>No unassigned tabs</span></div>
        </div>
        <footer class="sandbox-footer"><span>{{ selected.length }} selected</span><span>Unassigned tabs</span></footer>
      </aside>

      <section class="topics" aria-label="Tab topics">
        <article v-for="group in visibleGroups" :key="group.id" :data-group-id="group.id" class="topic" :class="{ archived: group.status === 'archived', 'drop-target': drag?.type === 'tab' && drag.groupId !== group.id }" @dragover.prevent @drop="drop($event, group)">
          <header class="topic-header" draggable="true" @dragstart="startGroup($event, group)" @dragend="drag = null">
            <IconButton :label="state.settings.collapsedGroups.includes(group.id) ? 'Expand topic' : 'Collapse topic'" :icon="state.settings.collapsedGroups.includes(group.id) ? ChevronRight : ChevronDown" @click="toggleGroup(group)" />
            <button class="topic-name" :title="groupName(group)" @click="beginEdit(group)">{{ groupName(group) }}</button>
            <Pin v-if="group.main" class="main-pin" :size="13" />
            <span v-if="group.status === 'archived'" class="archive-label">Archived</span>
            <span class="topic-count">{{ group.tabs.length }}</span>
            <details class="action-menu"><summary :aria-label="`Actions for ${groupName(group)}`"><MoreHorizontal :size="18" /></summary><div class="menu-panel"><button @click="run(group.status === 'live' ? 'archive' : 'restore', { groupId: group.id })">{{ group.status === 'live' ? 'Archive window' : 'Restore topic' }}</button><button @click="openBatch(group)">Batch manage</button><button @click="run('main', { groupId: group.id, value: !group.main })">{{ group.main ? 'Remove main' : 'Set as main' }}</button><button @click="run('hibernate', { groupId: group.id, value: !group.hibernate })">{{ group.hibernate ? 'Return to Regular' : 'Move to Hibernate' }}</button><button class="danger" @click="ask('Delete topic?', `Permanently delete “${groupName(group)}”${group.status === 'live' ? ' and close its window' : ''}?`, () => run('delete', { groupId: group.id }))">Delete topic</button></div></details>
          </header>
          <div v-if="!state.settings.collapsedGroups.includes(group.id)" class="topic-tabs">
            <TabRow v-for="(tab, index) in groupTabs(group)" :key="tab.id" :tab="tab" :index="index + 1" :archived="group.status === 'archived'" :color="colors.get(tab.url)" :busy="busy" @activate="run('activate', { tabId: tab.id })" @close="closeTab(group, tab)" @info="info = { tab, group }" @dragstart="startTab($event, group, tab)" @drop="drop($event, group, tab)" />
          </div>
          <footer class="topic-footer"><span><Archive v-if="group.status === 'archived'" :size="12" />{{ group.status === 'archived' ? 'Archived' : 'Live window' }}</span><button :disabled="busy" @click="run(group.status === 'live' ? 'archive' : 'restore', { groupId: group.id })"><component :is="group.status === 'live' ? Archive : ArrowDownToLine" :size="13" />{{ group.status === 'live' ? 'Archive' : 'Restore' }}</button></footer>
        </article>
        <div v-if="!visibleGroups.length && !loading" class="empty-topics"><FolderOpen :size="30" /><h2>{{ query ? 'No matching topics' : 'No topics here' }}</h2><button v-if="query" class="secondary" @click="query = ''">Clear search</button></div>
      </section>
    </div>
    <div v-if="notice" class="toast" role="status">{{ notice }}</div>

    <Modal v-if="info" title="Tab details" @close="info = null"><dl class="details-list"><dt>Name</dt><dd>{{ tabName(info.tab) }}</dd><dt>Original title</dt><dd>{{ info.tab.title || 'Untitled tab' }}</dd><dt>URL</dt><dd><a :href="info.tab.url" target="_blank" rel="noopener noreferrer">{{ info.tab.url }}</a></dd><dt>Topic</dt><dd>{{ groupName(info.group) }}</dd><dt>Status</dt><dd>{{ info.group.status === 'archived' ? 'Archived' : info.tab.assigned ? 'Assigned' : 'Sandbox' }}</dd></dl><div class="modal-actions"><button class="secondary" @click="beginEdit(info.group, info.tab); info = null">Rename tab</button><button class="primary" @click="run('activate', { tabId: info.tab.id })">{{ info.group.status === 'archived' ? 'Restore topic' : 'Focus tab' }}</button></div></Modal>

    <Modal v-if="edit" :title="edit.tabId ? 'Rename tab' : 'Rename topic'" @close="edit = null"><form @submit.prevent="saveEdit"><label class="field-label">Name<input v-model="edit.name" maxlength="160" autofocus /></label><div class="modal-actions"><button type="button" class="secondary" @click="edit = null">Cancel</button><button class="primary" :disabled="busy">Save</button></div></form></Modal>

    <Modal v-if="confirmation" :title="confirmation.title" @close="confirmation = null"><p class="confirm-body">{{ confirmation.body }}</p><div class="modal-actions"><button class="secondary" :disabled="busy" @click="confirmation = null">Cancel</button><button class="danger-button" :disabled="busy" @click="confirm">Confirm</button></div></Modal>

    <Modal v-if="settingsOpen" title="Settings" @close="settingsOpen = false">
      <section class="settings-section">
        <h3>Layout</h3>
        <p class="layout-note">Automatic adjusts widths to this window. The visible tab limit applies in both modes.</p>
        <p class="layout-status">Window: {{ workspaceSpace.viewportWidth }} × {{ workspaceSpace.viewportHeight }} · Suggested preset: {{ suggestedPreset.label }} ({{ suggestedPreset.viewportWidth }})</p>
        <form class="layout-options" @submit.prevent="saveLayout">
          <label class="layout-field"><span>Layout mode</span><select v-model="layoutDraft.layoutMode" aria-label="Layout mode"><option value="auto">Automatic</option><option value="manual">Manual</option></select></label>
          <label v-if="layoutDraft.layoutMode === 'manual'" class="layout-field"><span>Start from preset</span><select v-model="selectedLayoutPreset" aria-label="Start from preset" @change="chooseLayoutPreset"><option value="">Choose preset…</option><option v-for="preset in LAYOUT_PRESETS" :key="preset.id" :value="preset.id">{{ preset.viewportWidth }} · {{ preset.label }}</option></select></label>
          <label v-for="(option, key) in LAYOUT_WIDTH_OPTIONS" :key="key" class="layout-field">
            <span>{{ option.label }}</span>
            <span class="layout-value"><input :value="layoutDraft.layoutMode === 'auto' ? automaticLayout[key] : layoutDraft[key]" :disabled="layoutDraft.layoutMode === 'auto'" type="number" :min="option.min" :max="option.max" :step="option.step" :aria-label="option.label" required @input="editLayoutNumber(key, $event)" /><span>{{ option.unit }}</span></span>
          </label>
          <label class="layout-field">
            <span>{{ LAYOUT_OPTIONS.topicVisibleTabs.label }}</span>
            <span class="layout-value"><input v-model.number="layoutDraft.topicVisibleTabs" type="number" :min="LAYOUT_OPTIONS.topicVisibleTabs.min" :max="LAYOUT_OPTIONS.topicVisibleTabs.max" :step="LAYOUT_OPTIONS.topicVisibleTabs.step" :aria-label="LAYOUT_OPTIONS.topicVisibleTabs.label" required /><span>{{ LAYOUT_OPTIONS.topicVisibleTabs.unit }}</span></span>
          </label>
          <div class="settings-quick"><button type="submit" class="primary" :disabled="busy">Apply layout</button><button type="button" class="secondary" :disabled="busy" @click="resetLayoutDraft">Use default widths</button></div>
        </form>
      </section>
      <section class="settings-section"><h3>Local backup</h3><div class="settings-quick"><button type="button" class="secondary" @click="exportBackup"><Download :size="15" />Export</button><button type="button" class="secondary" @click="backupInput.click()"><Upload :size="15" />Import</button></div><p class="privacy-note">Backup files contain your tab URLs. Keep them private.</p></section>
      <section class="settings-section"><div class="settings-quick"><button type="button" class="secondary" :disabled="!state.settings.reuseEnabled" @click="run('settings', { pausedUntil: state.settings.pausedUntil > Date.now() ? 0 : Date.now() + 600000 })">{{ state.settings.pausedUntil > Date.now() ? 'Resume reuse' : 'Pause for 10 minutes' }}</button><button type="button" class="secondary" :disabled="!state.settings.reuseEnabled" @click="run('settings', { skipNext: !state.settings.skipNext })">{{ state.settings.skipNext ? 'Cancel bypass' : 'Allow next tab' }}</button></div></section>
    </Modal>

    <Modal v-if="batchGroup" :title="`Batch · ${groupName(batchGroup)}`" wide @close="batchId = null"><div class="batch-toolbar"><label class="search-field"><Search :size="16" /><input v-model="batchQuery" placeholder="Filter tabs" aria-label="Filter batch tabs" /></label><label class="setting-toggle"><input v-model="duplicateOnly" type="checkbox" />Duplicates only</label><button class="secondary" :disabled="!batchDuplicates || busy" @click="dedupeBatch">Remove {{ batchDuplicates }} duplicates</button><IconButton label="Sort by website" :icon="SlidersHorizontal" :disabled="busy" @click="sortBatch" /></div><div class="batch-actions"><label><input type="checkbox" :checked="batchTabs.length > 0 && batchTabs.every(tab => batchSelected.includes(tab.id))" @change="batchSelected = $event.target.checked ? batchTabs.map(tab => tab.id) : []" />Select all</label><span>{{ batchSelected.length }} selected</span><select v-model="batchTarget" aria-label="Batch target topic"><option value="">Move selected to…</option><option v-for="target in state.groups.filter(item => item.id !== batchId)" :key="target.id" :value="target.id">{{ groupName(target) }}{{ target.status === 'archived' ? ' · Archived' : '' }}</option></select><button class="primary" :disabled="!batchTarget || !batchSelected.length || busy" @click="batchMove">Move</button><IconButton label="Remove selected tabs" :icon="Trash2" :disabled="!batchSelected.length || busy" @click="batchClose" /></div><div class="batch-list"><div v-for="tab in batchTabs" :key="tab.id" class="batch-row" :class="colors.has(tab.url) ? `duplicate-${colors.get(tab.url)}` : ''"><input type="checkbox" :checked="batchSelected.includes(tab.id)" :aria-label="`Select ${tabName(tab)}`" @change="selectTab(tab.id, $event.target.checked, true)" /><span class="batch-title" :title="tabName(tab)">{{ tabName(tab) }}</span><span class="batch-url" :title="tab.url">{{ tab.url }}</span><IconButton label="Tab details" :icon="Settings" @click="info = { tab, group: batchGroup }" /></div><div v-if="!batchTabs.length" class="empty-inline">No matching tabs</div></div></Modal>
  </main>
</template>
