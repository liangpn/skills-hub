import { memo } from 'react'
import { Editor } from '@monaco-editor/react'

type MonacoEditorProps = {
  value: string
  language?: string
  height?: number | string
  readOnly?: boolean
  onMount?: (editor: unknown, monaco: unknown) => void
  options?: Record<string, unknown>
}

const MonacoEditor = ({
  value,
  language = 'markdown',
  height = '60vh',
  readOnly = true,
  onMount,
  options,
}: MonacoEditorProps) => {
  const theme =
    typeof document === 'undefined'
      ? 'vs'
      : document.documentElement.dataset.theme === 'dark'
        ? 'vs-dark'
        : 'vs'

  return (
    <Editor
      value={value}
      language={language}
      theme={theme}
      height={height}
      onMount={onMount}
      options={{
        readOnly,
        minimap: { enabled: false },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        lineNumbers: 'on',
        glyphMargin: true,
        renderLineHighlight: 'gutter',
        scrollbar: { alwaysConsumeMouseWheel: false },
        ...(options ?? {}),
      }}
    />
  )
}

export default memo(MonacoEditor)
