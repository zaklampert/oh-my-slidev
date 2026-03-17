import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const addonRoot = fileURLToPath(new URL('.', import.meta.url))
const customEditorPath = resolve(addonRoot, 'src/SideEditor.vue')

export default {
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
}
