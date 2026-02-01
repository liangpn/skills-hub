import { memo } from 'react'
import { DiffEditor } from '@monaco-editor/react'

type MonacoDiffEditorProps = {
  original: string
  modified: string
  language?: string
  height?: number | string
  onMount?: (editor: unknown, monaco: unknown) => void
  className?: string
}

const MonacoDiffEditor = ({
  original,
  modified,
  language = 'markdown',
  height = '60vh',
  onMount,
  className,
}: MonacoDiffEditorProps) => {
  const theme =
    typeof document === 'undefined'
      ? 'vs'
      : document.documentElement.dataset.theme === 'dark'
        ? 'vs-dark'
        : 'vs'

  return (
    <DiffEditor
      className={className}
      original={original}
      modified={modified}
      language={language}
      theme={theme}
      height={height}
      onMount={onMount}
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: false,
        minimap: { enabled: false },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        scrollbar: { alwaysConsumeMouseWheel: false },
      }}
    />
  )
}

export default memo(MonacoDiffEditor)
