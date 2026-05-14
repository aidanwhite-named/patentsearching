import React from 'react'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 bg-gray-950 text-gray-300 p-8">
          <div className="text-4xl text-red-500">⚠</div>
          <div className="text-center max-w-lg">
            <p className="font-semibold text-red-400 mb-2">예기치 않은 오류가 발생했습니다</p>
            <pre className="text-xs text-gray-500 bg-gray-900 rounded p-3 text-left overflow-auto max-h-48 whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded"
          >
            재시도
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
