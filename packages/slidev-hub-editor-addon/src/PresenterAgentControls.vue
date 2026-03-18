<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { useNav } from '@slidev/client/composables/useNav.ts'
import IconButton from '@slidev/client/internals/IconButton.vue'

const { isPresenter } = useNav()
const panelOpen = ref(false)

const PresenterAgentPanel = defineAsyncComponent(() => import('./PresenterAgentPanel.vue'))
</script>

<template>
  <template v-if="isPresenter">
    <IconButton :title="panelOpen ? 'Hide AI panel' : 'Show AI panel'" @click="panelOpen = !panelOpen">
      <div class="i-carbon:bot" />
    </IconButton>

    <PresenterAgentPanel v-if="panelOpen" @close="panelOpen = false" />
  </template>
</template>
