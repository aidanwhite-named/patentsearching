import React from 'react'
import { useToastStore, type ToastType } from '../store/toastStore'

const ICON: Record<ToastType, string> = {
  success: '✓',
  error:   '✕',
  info:    'ℹ',
  warning: '⚠',
}

const COLOR: Record<ToastType, string> = {
  success: 'border-green-700 bg-green-950 text-green-300',
  error:   'border-red-700   bg-red-950   text-red-300',
  info:    'border-blue-700  bg-blue-950  text-blue-300',
  warning: 'border-yellow-700 bg-yellow-950 text-yellow-300',
}

const ICON_COLOR: Record<ToastType, string> = {
  success: 'text-green-400',
  error:   'text-red-400',
  info:    'text-blue-400',
  warning: 'text-yellow-400',
}

export default function ToastContainer(): React.ReactElement {
  const { toasts, dismiss } = useToastStore()

  return (
    <div className="fixed bottom-10 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 px-3 py-2.5 rounded border text-xs max-w-xs
                      shadow-lg backdrop-blur-sm pointer-events-auto animate-fade-in
                      ${COLOR[t.type]}`}
        >
          <span className={`shrink-0 font-bold text-sm leading-none mt-0.5 ${ICON_COLOR[t.type]}`}>
            {ICON[t.type]}
          </span>
          <span className="flex-1 leading-relaxed">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-gray-500 hover:text-gray-300 leading-none ml-1"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
