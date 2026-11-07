import { useEditor } from '@/store/editorStore'
import { useUiStore } from '@/store/uiStore'
import * as actions from '@/editor/actions'

/** Test/debug hook: enabled in dev, or in a built app after `localStorage.setItem('vc.debug','1')` + reload. */
export function installDebugHook(): void {
  if (import.meta.env.DEV || localStorage.getItem('vc.debug') === '1') {
    ;(window as unknown as Record<string, unknown>).__vc = { useEditor, useUiStore, actions }
  }
}
