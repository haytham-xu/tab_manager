<script setup>
defineProps({ icon: [Object, Function], label: String, disabled: Boolean })
</script>
<template><button type="button" class="icon-button" :title="label" :aria-label="label" :disabled="disabled"><component :is="icon" :size="16" /></button></template>