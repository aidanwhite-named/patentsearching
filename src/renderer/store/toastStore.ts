import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  type: ToastType
  message: string
  durationMs: number
}

let _counter = 0

interface ToastState {
  toasts: Toast[]
  push: (type: ToastType, message: string, durationMs?: number) => void
  dismiss: (id: string) => void
  clear: () => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push: (type, message, durationMs = 4000) => {
    const id = `toast-${Date.now()}-${++_counter}`
    const toast: Toast = { id, type, message, durationMs }
    set((s) => ({ toasts: [...s.toasts, toast] }))

    // Auto-dismiss
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, durationMs)
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}))

// Convenience helpers callable outside React components
export const toast = {
  success: (msg: string, ms?: number) => useToastStore.getState().push('success', msg, ms),
  error:   (msg: string, ms?: number) => useToastStore.getState().push('error',   msg, ms),
  info:    (msg: string, ms?: number) => useToastStore.getState().push('info',    msg, ms),
  warning: (msg: string, ms?: number) => useToastStore.getState().push('warning', msg, ms),
}
