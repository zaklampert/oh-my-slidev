import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const addonRoot = fileURLToPath(new URL('.', import.meta.url))
const customEditorPath = resolve(addonRoot, 'src/SideEditor.vue')

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '../internals/SideEditor.vue',
        replacement: customEditorPath,
      },
      {
        find: '@slidev/client/internals/SideEditor.vue',
        replacement: customEditorPath,
      },
    ],
  },
})
