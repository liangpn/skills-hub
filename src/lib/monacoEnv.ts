import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

type MonacoEnvironment = {
  getWorker: (moduleId: string, label: string) => Worker
}

export const configureMonaco = () => {
  if (typeof self === 'undefined') return
  ;(self as unknown as { MonacoEnvironment?: MonacoEnvironment }).MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  }
}

