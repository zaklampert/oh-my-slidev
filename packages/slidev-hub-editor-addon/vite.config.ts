import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const addonRoot = fileURLToPath(new URL('.', import.meta.url))
const customEditorPath = resolve(addonRoot, 'src/SideEditor.vue')
const customNavControlsPath = resolve(addonRoot, 'src/PresenterAgentControls.vue')

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
      {
        find: '#slidev/custom-nav-controls',
        replacement: customNavControlsPath,
      },
    ],
  },
}
