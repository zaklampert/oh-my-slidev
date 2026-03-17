<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useNav } from '@slidev/client/composables/useNav.ts'
import { useDynamicSlideInfo } from '@slidev/client/composables/useSlideInfo.ts'
import { editorHeight, editorWidth, isEditorVertical as vertical, showEditor } from '@slidev/client/state/index.ts'
import IconButton from '@slidev/client/internals/IconButton.vue'
import ShikiEditor from '@slidev/client/internals/ShikiEditor.vue'

const props = defineProps<{
  resize?: boolean
}>()

type EditorTab = 'content' | 'note'
type PendingAction =
  | { kind: 'close' }
  | { kind: 'navigate', nextSlideNo: number, previousSlideNo: number }

const { currentSlideNo, go } = useNav()
const { info, update } = useDynamicSlideInfo(currentSlideNo)

const tab = ref<EditorTab>('content')
const content = ref('')
const note = ref('')
const dirty = ref(false)
const isSaving = ref(false)
const saveError = ref('')
const pendingAction = ref<PendingAction | null>(null)
const handlerDown = ref(false)
const suppressNavigationGuard = ref(false)

function syncDraftFromInfo(value: typeof info.value) {
  note.value = (value?.note || '').trim()
  const frontmatterPart = value?.frontmatterRaw?.trim() ? `---\n${value.frontmatterRaw.trim()}\n---\n\n` : ''
  content.value = frontmatterPart + (value?.source.contentRaw || '').trim()
  dirty.value = false
  saveError.value = ''
}

watch(
  info,
  (value) => {
    if (!dirty.value && !pendingAction.value && !isSaving.value)
      syncDraftFromInfo(value)
  },
  { immediate: true },
)

watch(currentSlideNo, async (next, prev) => {
  if (suppressNavigationGuard.value || next === prev || !dirty.value)
    return

  pendingAction.value = { kind: 'navigate', nextSlideNo: next, previousSlideNo: prev }
  suppressNavigationGuard.value = true
  try {
    await go(prev, undefined, true)
  }
  finally {
    suppressNavigationGuard.value = false
  }
})

async function save() {
  isSaving.value = true
  saveError.value = ''

  let frontmatterRaw: string | undefined
  const contentOnly = content.value.trim().replace(/^---\n([\s\S]*?)\n---\n/, (_, frontmatter) => {
    frontmatterRaw = frontmatter
    return ''
  })

  try {
    const nextInfo = await update({
      note: note.value || undefined,
      content: contentOnly,
      frontmatterRaw,
    })
    if (nextInfo)
      syncDraftFromInfo(nextInfo)
    else
      dirty.value = false
  }
  catch (error) {
    saveError.value = error instanceof Error ? error.message : 'Failed to save slide changes'
    throw error
  }
  finally {
    isSaving.value = false
  }
}

function resetDraft() {
  syncDraftFromInfo(info.value)
}

function requestClose() {
  if (!dirty.value) {
    showEditor.value = false
    return
  }
  pendingAction.value = { kind: 'close' }
}

async function continuePendingAction(saveChanges: boolean) {
  const pending = pendingAction.value
  if (!pending)
    return

  if (saveChanges)
    await save()
  else
    resetDraft()

  pendingAction.value = null

  if (pending.kind === 'close') {
    showEditor.value = false
    return
  }

  suppressNavigationGuard.value = true
  try {
    await go(pending.nextSlideNo, undefined, true)
  }
  finally {
    suppressNavigationGuard.value = false
  }
}

function cancelPendingAction() {
  pendingAction.value = null
}

useEventListener('keydown', (event: KeyboardEvent) => {
  if (event.code === 'KeyS' && (event.ctrlKey || event.metaKey)) {
    void save()
    event.preventDefault()
  }
})

useEventListener(window, 'beforeunload', (event: BeforeUnloadEvent) => {
  if (!dirty.value)
    return
  event.preventDefault()
  event.returnValue = ''
})

const contentRef = computed({
  get: () => content.value,
  set: (value: string) => {
    content.value = value
    dirty.value = true
  },
})

const noteRef = computed({
  get: () => note.value,
  set: (value: string) => {
    note.value = value
    dirty.value = true
  },
})

function onHandlerDown() {
  handlerDown.value = true
}

function updateSize(value?: number) {
  if (vertical.value)
    editorHeight.value = Math.min(Math.max(300, value ?? editorHeight.value), window.innerHeight - 200)
  else
    editorWidth.value = Math.min(Math.max(318, value ?? editorWidth.value), window.innerWidth - 200)
}

function switchTab(nextTab: EditorTab) {
  tab.value = nextTab
  // @ts-expect-error runtime blur support is enough here
  document.activeElement?.blur?.()
}

if (props.resize) {
  useEventListener('pointermove', (event: PointerEvent) => {
    if (!handlerDown.value)
      return

    updateSize(vertical.value
      ? window.innerHeight - event.pageY
      : window.innerWidth - event.pageX)
  }, { passive: true })
  useEventListener('pointerup', () => {
    handlerDown.value = false
  })
  useEventListener('resize', () => {
    updateSize()
  })
}
</script>

<template>
  <div
    v-if="resize"
    class="fixed bg-gray-400 select-none opacity-0 hover:opacity-10 z-dragging"
    :class="vertical ? 'left-0 right-0 w-full h-10px' : 'top-0 bottom-0 w-10px h-full'"
    :style="{
      opacity: handlerDown ? '0.3' : undefined,
      bottom: vertical ? `${editorHeight - 5}px` : undefined,
      right: !vertical ? `${editorWidth - 5}px` : undefined,
      cursor: vertical ? 'row-resize' : 'col-resize',
    }"
    @pointerdown="onHandlerDown"
  />
  <div
    class="shadow bg-main p-2 pt-4 grid grid-rows-[max-content_1fr] h-full overflow-hidden relative"
    :class="resize ? 'border-l border-gray-400 border-opacity-20' : ''"
    :style="resize ? {
      height: vertical ? `${editorHeight}px` : undefined,
      width: !vertical ? `${editorWidth}px` : undefined,
    } : {}"
  >
    <div class="flex items-center gap-2 pb-2 text-xl -mt-1">
      <div class="mr-2 rounded flex">
        <IconButton title="Switch to content tab" :class="tab === 'content' ? 'text-primary' : ''" @click="switchTab('content')">
          <div class="i-carbon:account" />
        </IconButton>
        <IconButton title="Switch to notes tab" :class="tab === 'note' ? 'text-primary' : ''" @click="switchTab('note')">
          <div class="i-carbon:align-box-bottom-right" />
        </IconButton>
      </div>
      <span class="text-2xl pt-1">
        {{ tab === 'content' ? 'Slide' : 'Notes' }}
      </span>
      <span
        class="text-xs uppercase tracking-wide px-2 py-1 rounded border"
        :class="dirty ? 'border-amber-500/60 text-amber-400' : 'border-gray-500/40 text-gray-400'"
      >
        {{ dirty ? 'Unsaved' : 'Saved' }}
      </span>
      <div class="flex-auto" />
      <template v-if="resize">
        <IconButton v-if="vertical" title="Dock to right" @click="vertical = false">
          <div class="i-carbon:open-panel-right" />
        </IconButton>
        <IconButton v-else title="Dock to bottom" @click="vertical = true">
          <div class="i-carbon:open-panel-bottom" />
        </IconButton>
      </template>
      <button
        class="text-sm px-3 py-1 rounded border border-gray-500/50 disabled:opacity-40"
        :disabled="!dirty || isSaving"
        @click="resetDraft"
      >
        Revert
      </button>
      <button
        class="text-sm px-3 py-1 rounded bg-primary text-white disabled:opacity-40"
        :disabled="!dirty || isSaving"
        @click="save"
      >
        {{ isSaving ? 'Saving…' : 'Save' }}
      </button>
      <IconButton title="Close" @click="requestClose">
        <div class="i-carbon:close" />
      </IconButton>
    </div>

    <p v-if="saveError" class="text-sm text-red-400 pb-2">
      {{ saveError }}
    </p>

    <div class="relative overflow-hidden rounded" style="background-color: var(--slidev-code-background)">
      <ShikiEditor v-show="tab === 'content'" v-model="contentRef" placeholder="Create slide content..." />
      <ShikiEditor v-show="tab === 'note'" v-model="noteRef" placeholder="Write some notes..." />
    </div>

    <div
      v-if="pendingAction"
      class="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4"
    >
      <div class="w-full max-w-sm rounded border border-gray-500/40 bg-main p-4 shadow-xl">
        <h3 class="text-lg font-medium">
          Unsaved changes
        </h3>
        <p class="text-sm text-gray-300 mt-2">
          Save this slide before {{ pendingAction.kind === 'close' ? 'closing the editor' : 'changing slides' }}?
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button class="text-sm px-3 py-1 rounded border border-gray-500/50" @click="cancelPendingAction">
            Cancel
          </button>
          <button class="text-sm px-3 py-1 rounded border border-gray-500/50" @click="continuePendingAction(false)">
            Discard
          </button>
          <button class="text-sm px-3 py-1 rounded bg-primary text-white" @click="continuePendingAction(true)">
            Save
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
