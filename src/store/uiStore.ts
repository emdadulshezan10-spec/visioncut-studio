import { create } from 'zustand'

export type PageId = 'home' | 'projects' | 'media' | 'editor' | 'templates' | 'settings' | 'profile'

interface Layout {
  sidebarCollapsed: boolean
  leftW: number
  rightW: number
  timelineH: number
  leftOpen: boolean
  rightOpen: boolean
}

interface UiState extends Layout {
  page: PageId
  setPage: (p: PageId) => void
  toggleSidebar: () => void
  setLayout: (patch: Partial<Layout>) => void
  resetLayout: () => void
}

const DEFAULTS: Layout = { sidebarCollapsed: false, leftW: 300, rightW: 320, timelineH: 330, leftOpen: true, rightOpen: true }
const KEY = 'visioncut.layout.v1'

const load = (): Layout => {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Layout>) } } catch { return DEFAULTS }
}
const persist = (s: Layout) => { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* storage may be unavailable */ } }
const pick = (s: UiState): Layout => ({ sidebarCollapsed: s.sidebarCollapsed, leftW: s.leftW, rightW: s.rightW, timelineH: s.timelineH, leftOpen: s.leftOpen, rightOpen: s.rightOpen })

export const useUiStore = create<UiState>((set, get) => ({
  ...load(),
  page: 'home',
  setPage: (page) => set({ page }),
  toggleSidebar: () => { set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })); persist(pick(get())) },
  setLayout: (patch) => { set(patch); persist(pick(get())) },
  resetLayout: () => { set(DEFAULTS); persist(DEFAULTS) },
}))
