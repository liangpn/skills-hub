import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileUp,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import type { ManagedSkill } from '../skills/types'
import {
  applyHunkDecisions,
  buildLineDiffHunks,
  initHunkStates,
  type DiffHunkState,
} from '../../lib/lineDiff'
import MonacoDiffEditor from '../monaco/MonacoDiffEditor'

type MonacoStandaloneEditor = {
  revealLineInCenter: (lineNumber: number) => void
  onMouseDown?: (cb: (e: MonacoMouseEvent) => void) => { dispose: () => void }
}

type MonacoStandaloneDiffEditor = {
  getOriginalEditor: () => MonacoStandaloneEditor
  getModifiedEditor: () => MonacoStandaloneEditor
}

type MonacoStandaloneDiffEditorWithHost = MonacoStandaloneDiffEditor & {
  getOriginalEditor: () => MonacoStandaloneEditor & {
    deltaDecorations?: (oldDecorations: string[], newDecorations: MonacoDecoration[]) => string[]
  }
  getModifiedEditor: () => MonacoStandaloneEditor & {
    deltaDecorations?: (oldDecorations: string[], newDecorations: MonacoDecoration[]) => string[]
  }
}

type MonacoPosition = {
  lineNumber: number
  column: number
}

type MonacoMouseTarget = {
  type: number
  position?: MonacoPosition
}

type MonacoMouseEvent = {
  target: MonacoMouseTarget
}

type MonacoDecoration = {
  range: unknown
  options: {
    isWholeLine?: boolean
    className?: string
    glyphMarginClassName?: string
    glyphMarginHoverMessage?: { value: string }
  }
}

type MonacoApi = {
  Range: new (
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number,
  ) => unknown
  editor: {
    MouseTargetType: {
      GUTTER_GLYPH_MARGIN: number
      GUTTER_LINE_NUMBERS: number
    }
  }
}

type ReviewLineComment = {
  id: string
  line: number
  body: string
  created_at_ms: number
}

type SkillSnapshotFile = {
  rel_path: string
  size: number
}

type SkillSnapshot = {
  root: string
  files: SkillSnapshotFile[]
  truncated: boolean
  truncated_reason: string | null
  skill_md: string | null
  skill_md_error: string | null
}

type CodexInstalledSkill = {
  name: string
  path: string
  is_system: boolean
}

type LlmAgent = {
  id: string
  name: string
  provider_id: string
  model: string | null
  prompt_md: string
  created_at_ms: number
  updated_at_ms: number
}

type LocalSource = {
  kind: 'file' | 'dir'
  path: string
  label: string
}

type SelectedSource =
  | { kind: 'managed'; id: string }
  | { kind: 'local_file'; path: string }
  | { kind: 'local_dir'; path: string }

type SessionItem = {
  key: string
  label: string
  source: SelectedSource
  note: string
  badgeSystem: boolean
}

const fileNameFromPath = (path: string) => path.split(/[/\\\\]/).filter(Boolean).pop() ?? path

const sessionKeyForSource = (source: SelectedSource) => {
  switch (source.kind) {
    case 'managed':
      return `managed:${source.id}`
    case 'local_file':
      return `file:${source.path}`
    case 'local_dir':
      return `dir:${source.path}`
  }
}

const CODEX_INSTALLED_PAGE_SIZE = 5

const newReviewCommentId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `c-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const indentLines = (text: string, spaces: number) => {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n')
}

const buildAnalysisWithReviewComments = (
  analysis: string,
  globalComment: string,
  lineComments: ReviewLineComment[],
) => {
  const a = analysis.trim()
  const global = globalComment.trim()
  const lines = [...lineComments]
    .filter((c) => c.body.trim())
    .sort((x, y) => (x.line - y.line) || (x.created_at_ms - y.created_at_ms))

  if (!global && lines.length === 0) return a

  const parts: string[] = []
  parts.push(a)
  parts.push('')
  parts.push('## User review comments')
  parts.push('')
  if (global) {
    parts.push('### Overall')
    parts.push('')
    parts.push(global)
    parts.push('')
  }
  if (lines.length > 0) {
    parts.push('### Line comments')
    parts.push('')
    for (const c of lines) {
      parts.push(`- L${c.line}:`)
      parts.push(indentLines(c.body.trim(), 2))
      parts.push('')
    }
  }
  return parts.join('\n').trimEnd()
}

type RefineryPanelProps = {
  isTauri: boolean
  invokeTauri: <T,>(command: string, args?: Record<string, unknown>) => Promise<T>
  managedSkills: ManagedSkill[]
  t: TFunction
}

export default function RefineryPanel({
  isTauri,
  invokeTauri,
  managedSkills,
  t,
}: RefineryPanelProps) {
  const [query, setQuery] = useState('')
  const [skills, setSkills] = useState<ManagedSkill[]>(managedSkills)
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [codexSkills, setCodexSkills] = useState<CodexInstalledSkill[]>([])
  const [codexSkillsLoading, setCodexSkillsLoading] = useState(false)
  const [codexSkillsError, setCodexSkillsError] = useState<string | null>(null)
  const [codexInstalledCollapsed, setCodexInstalledCollapsed] = useState(false)
  const [codexInstalledPage, setCodexInstalledPage] = useState(1)
  const [showImportMenu, setShowImportMenu] = useState(false)
  const importMenuRef = useRef<HTMLDivElement | null>(null)
  const [localSources, setLocalSources] = useState<LocalSource[]>([])
  const [session, setSession] = useState<SessionItem[]>([])
  const [selected, setSelected] = useState<SelectedSource | null>(null)
  const [snapshot, setSnapshot] = useState<SkillSnapshot | null>(null)
  const [filePreview, setFilePreview] = useState<{ path: string; content: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [llmAgents, setLlmAgents] = useState<LlmAgent[]>([])
  const [llmAgentsLoading, setLlmAgentsLoading] = useState(false)
  const [llmAgentsError, setLlmAgentsError] = useState<string | null>(null)

  const [showExportWorkRule, setShowExportWorkRule] = useState(false)
  const [exportName, setExportName] = useState('')
  const [exportEntryFile, setExportEntryFile] = useState('AGENTS.md')
  const [exportTags, setExportTags] = useState('')
  const [exportScore, setExportScore] = useState<string>('')
  const [exportDescription, setExportDescription] = useState('')
  const [exportContent, setExportContent] = useState('')
  const [exportMode, setExportMode] = useState<'fusion' | 'analysis'>('fusion')
  const [exportAgentId, setExportAgentId] = useState('')
  const [exportResult, setExportResult] = useState('')
  const [exportAnalysis, setExportAnalysis] = useState('')
  const [exportContentTab, setExportContentTab] = useState<'edit' | 'preview'>('preview')
  const [exportOptimized, setExportOptimized] = useState('')
  const [exportDiffHunks, setExportDiffHunks] = useState<DiffHunkState[]>([])
  const [exportLoading, setExportLoading] = useState(false)
  const workRuleDiffEditorRef = useRef<MonacoStandaloneDiffEditorWithHost | null>(null)
  const exportDiffMonacoRef = useRef<MonacoApi | null>(null)
  const exportDiffDecorationIdsRef = useRef<string[]>([])
  const exportDiffModDecorationIdsRef = useRef<string[]>([])
  const exportDiffMouseDisposablesRef = useRef<{ dispose: () => void }[]>([])
  const [exportActiveHunkId, setExportActiveHunkId] = useState('')
  const [exportReviewOpen, setExportReviewOpen] = useState(false)
  const exportReviewButtonRef = useRef<HTMLButtonElement | null>(null)
  const exportReviewPopoverRef = useRef<HTMLDivElement | null>(null)
  const [exportReviewMessage, setExportReviewMessage] = useState('')
  const [exportLineComments, setExportLineComments] = useState<ReviewLineComment[]>([])
  const exportAnalysisWrapRef = useRef<HTMLDivElement | null>(null)
  const exportLineAnchorsRef = useRef<Map<number, HTMLElement>>(new Map())
  const [exportCommentLine, setExportCommentLine] = useState<number | null>(null)
  const [exportCommentComposerOpen, setExportCommentComposerOpen] = useState(false)
  const [exportCommentDraft, setExportCommentDraft] = useState('')
  const [exportEditingCommentId, setExportEditingCommentId] = useState<string | null>(null)
  const [exportCommentCardTop, setExportCommentCardTop] = useState(12)

  const [showExportSkill, setShowExportSkill] = useState(false)
  const [exportSkillName, setExportSkillName] = useState('')
  const [exportSkillOverwrite, setExportSkillOverwrite] = useState(false)
  const [exportSkillContent, setExportSkillContent] = useState('')
  const [exportSkillMode, setExportSkillMode] = useState<'fusion' | 'analysis'>('fusion')
  const [exportSkillAgentId, setExportSkillAgentId] = useState('')
  const [exportSkillResult, setExportSkillResult] = useState('')
  const [exportSkillAnalysis, setExportSkillAnalysis] = useState('')
  const [exportSkillContentTab, setExportSkillContentTab] = useState<'edit' | 'preview'>('preview')
  const [exportSkillOptimized, setExportSkillOptimized] = useState('')
  const [exportSkillDiffHunks, setExportSkillDiffHunks] = useState<DiffHunkState[]>([])
  const [exportSkillLoading, setExportSkillLoading] = useState(false)
  const skillDiffEditorRef = useRef<MonacoStandaloneDiffEditorWithHost | null>(null)
  const exportSkillDiffMonacoRef = useRef<MonacoApi | null>(null)
  const exportSkillDiffDecorationIdsRef = useRef<string[]>([])
  const exportSkillDiffModDecorationIdsRef = useRef<string[]>([])
  const exportSkillDiffMouseDisposablesRef = useRef<{ dispose: () => void }[]>([])
  const [exportSkillActiveHunkId, setExportSkillActiveHunkId] = useState('')
  const [exportSkillReviewOpen, setExportSkillReviewOpen] = useState(false)
  const exportSkillReviewButtonRef = useRef<HTMLButtonElement | null>(null)
  const exportSkillReviewPopoverRef = useRef<HTMLDivElement | null>(null)
  const [exportSkillReviewMessage, setExportSkillReviewMessage] = useState('')
  const [exportSkillLineComments, setExportSkillLineComments] = useState<ReviewLineComment[]>([])
  const exportSkillAnalysisWrapRef = useRef<HTMLDivElement | null>(null)
  const exportSkillLineAnchorsRef = useRef<Map<number, HTMLElement>>(new Map())
  const [exportSkillCommentLine, setExportSkillCommentLine] = useState<number | null>(null)
  const [exportSkillCommentComposerOpen, setExportSkillCommentComposerOpen] = useState(false)
  const [exportSkillCommentDraft, setExportSkillCommentDraft] = useState('')
  const [exportSkillEditingCommentId, setExportSkillEditingCommentId] = useState<string | null>(null)
  const [exportSkillCommentCardTop, setExportSkillCommentCardTop] = useState(12)

  const exportPendingDiffs = useMemo(
    () => exportDiffHunks.filter((h) => h.decision === 'pending').length,
    [exportDiffHunks],
  )
  const exportOptimizedFinal = useMemo(() => {
    if (!exportOptimized.trim()) return ''
    if (exportDiffHunks.length === 0) return exportOptimized
    return applyHunkDecisions(exportContent, exportDiffHunks)
  }, [exportContent, exportDiffHunks, exportOptimized])
  const exportOptimizedCandidate = useMemo(() => {
    if (!exportOptimized.trim()) return ''
    if (exportDiffHunks.length === 0) return exportOptimized
    return applyHunkDecisions(exportContent, exportDiffHunks, 'accept')
  }, [exportContent, exportDiffHunks, exportOptimized])
  const workRuleDiffOpen = exportOptimized.trim() !== '' && exportPendingDiffs > 0
  const exportPendingHunks = useMemo(
    () => exportDiffHunks.filter((h) => h.decision === 'pending'),
    [exportDiffHunks],
  )
  const exportPendingHunksRef = useRef<DiffHunkState[]>([])
  const exportActiveHunk = useMemo(() => {
    if (exportPendingHunks.length === 0) return null
    return exportPendingHunks.find((h) => h.id === exportActiveHunkId) ?? exportPendingHunks[0]
  }, [exportActiveHunkId, exportPendingHunks])

  useEffect(() => {
    const monaco = exportDiffMonacoRef.current
    const ed = workRuleDiffEditorRef.current
    if (!monaco || !ed) return
    if (!exportOptimized.trim() || exportDiffHunks.length === 0) {
      exportDiffDecorationIdsRef.current = []
      exportDiffModDecorationIdsRef.current = []
      return
    }

    const active = exportActiveHunk
    const original = ed.getOriginalEditor() as MonacoStandaloneEditor & {
      deltaDecorations?: (oldDecorations: string[], newDecorations: MonacoDecoration[]) => string[]
    }
    const modified = ed.getModifiedEditor() as MonacoStandaloneEditor & {
      deltaDecorations?: (oldDecorations: string[], newDecorations: MonacoDecoration[]) => string[]
    }

    const decorations: MonacoDecoration[] = []
    const modDecorations: MonacoDecoration[] = []
    for (const h of exportPendingHunks) {
      const endLine = Math.max(h.oldEnd, h.oldStart + 1)
      decorations.push({
        range: new monaco.Range(h.oldStart + 1, 1, endLine, 1),
        options: { isWholeLine: true, className: 'monaco-diff-hunk-pending' },
      })
      modDecorations.push({
        range: new monaco.Range(h.oldStart + 1, 1, endLine, 1),
        options: { isWholeLine: true, className: 'monaco-diff-hunk-pending' },
      })
    }
    if (active) {
      const endLine = Math.max(active.oldEnd, active.oldStart + 1)
      decorations.push({
        range: new monaco.Range(active.oldStart + 1, 1, endLine, 1),
        options: { isWholeLine: true, className: 'monaco-diff-hunk-active' },
      })
      modDecorations.push({
        range: new monaco.Range(active.oldStart + 1, 1, endLine, 1),
        options: { isWholeLine: true, className: 'monaco-diff-hunk-active' },
      })
    }

    if (original.deltaDecorations) {
      exportDiffDecorationIdsRef.current = original.deltaDecorations(
        exportDiffDecorationIdsRef.current,
        decorations,
      )
    }
    if (modified.deltaDecorations) {
      exportDiffModDecorationIdsRef.current = modified.deltaDecorations(
        exportDiffModDecorationIdsRef.current,
        modDecorations,
      )
    }
  }, [exportActiveHunk, exportDiffHunks.length, exportOptimized, exportPendingHunks])
  const exportActiveHunkIndex = useMemo(() => {
    if (!exportActiveHunk) return -1
    return exportPendingHunks.findIndex((h) => h.id === exportActiveHunk.id)
  }, [exportActiveHunk, exportPendingHunks])

  useEffect(() => {
    exportPendingHunksRef.current = exportPendingHunks
  }, [exportPendingHunks])

  const exportSkillPendingDiffs = useMemo(
    () => exportSkillDiffHunks.filter((h) => h.decision === 'pending').length,
    [exportSkillDiffHunks],
  )
  const exportSkillOptimizedFinal = useMemo(() => {
    if (!exportSkillOptimized.trim()) return ''
    if (exportSkillDiffHunks.length === 0) return exportSkillOptimized
    return applyHunkDecisions(exportSkillContent, exportSkillDiffHunks)
  }, [exportSkillContent, exportSkillDiffHunks, exportSkillOptimized])
  const exportSkillOptimizedCandidate = useMemo(() => {
    if (!exportSkillOptimized.trim()) return ''
    if (exportSkillDiffHunks.length === 0) return exportSkillOptimized
    return applyHunkDecisions(exportSkillContent, exportSkillDiffHunks, 'accept')
  }, [exportSkillContent, exportSkillDiffHunks, exportSkillOptimized])
  const skillDiffOpen = exportSkillOptimized.trim() !== '' && exportSkillPendingDiffs > 0
  const exportSkillPendingHunks = useMemo(
    () => exportSkillDiffHunks.filter((h) => h.decision === 'pending'),
    [exportSkillDiffHunks],
  )
  const exportSkillPendingHunksRef = useRef<DiffHunkState[]>([])
  const exportSkillActiveHunk = useMemo(() => {
    if (exportSkillPendingHunks.length === 0) return null
    return exportSkillPendingHunks.find((h) => h.id === exportSkillActiveHunkId) ?? exportSkillPendingHunks[0]
  }, [exportSkillActiveHunkId, exportSkillPendingHunks])

  useEffect(() => {
    const monaco = exportSkillDiffMonacoRef.current
    const ed = skillDiffEditorRef.current
    if (!monaco || !ed) return
    if (!exportSkillOptimized.trim() || exportSkillDiffHunks.length === 0) {
      exportSkillDiffDecorationIdsRef.current = []
      exportSkillDiffModDecorationIdsRef.current = []
      return
    }

    const active = exportSkillActiveHunk
    const original = ed.getOriginalEditor() as MonacoStandaloneEditor & {
      deltaDecorations?: (oldDecorations: string[], newDecorations: MonacoDecoration[]) => string[]
    }
    const modified = ed.getModifiedEditor() as MonacoStandaloneEditor & {
      deltaDecorations?: (oldDecorations: string[], newDecorations: MonacoDecoration[]) => string[]
    }

    const decorations: MonacoDecoration[] = []
    const modDecorations: MonacoDecoration[] = []
    for (const h of exportSkillPendingHunks) {
      const endLine = Math.max(h.oldEnd, h.oldStart + 1)
      decorations.push({
        range: new monaco.Range(h.oldStart + 1, 1, endLine, 1),
        options: { isWholeLine: true, className: 'monaco-diff-hunk-pending' },
      })
      modDecorations.push({
        range: new monaco.Range(h.oldStart + 1, 1, endLine, 1),
        options: { isWholeLine: true, className: 'monaco-diff-hunk-pending' },
      })
    }
    if (active) {
      const endLine = Math.max(active.oldEnd, active.oldStart + 1)
      decorations.push({
        range: new monaco.Range(active.oldStart + 1, 1, endLine, 1),
        options: { isWholeLine: true, className: 'monaco-diff-hunk-active' },
      })
      modDecorations.push({
        range: new monaco.Range(active.oldStart + 1, 1, endLine, 1),
        options: { isWholeLine: true, className: 'monaco-diff-hunk-active' },
      })
    }

    if (original.deltaDecorations) {
      exportSkillDiffDecorationIdsRef.current = original.deltaDecorations(
        exportSkillDiffDecorationIdsRef.current,
        decorations,
      )
    }
    if (modified.deltaDecorations) {
      exportSkillDiffModDecorationIdsRef.current = modified.deltaDecorations(
        exportSkillDiffModDecorationIdsRef.current,
        modDecorations,
      )
    }
  }, [exportSkillActiveHunk, exportSkillDiffHunks.length, exportSkillOptimized, exportSkillPendingHunks])
  const exportSkillActiveHunkIndex = useMemo(() => {
    if (!exportSkillActiveHunk) return -1
    return exportSkillPendingHunks.findIndex((h) => h.id === exportSkillActiveHunk.id)
  }, [exportSkillActiveHunk, exportSkillPendingHunks])

  useEffect(() => {
    exportSkillPendingHunksRef.current = exportSkillPendingHunks
  }, [exportSkillPendingHunks])

  const exportReviewCount = useMemo(() => exportLineComments.length, [exportLineComments])
  const exportReviewGroups = useMemo(() => {
    const groups = new Map<number, ReviewLineComment[]>()
    for (const c of exportLineComments) {
      const list = groups.get(c.line) ?? []
      list.push(c)
      groups.set(c.line, list)
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([line, comments]) => {
        const sorted = comments.slice().sort((x, y) => x.created_at_ms - y.created_at_ms)
        const last = sorted[sorted.length - 1]
        const preview = (last?.body ?? '').trim().split('\n')[0] ?? ''
        return { line, count: sorted.length, preview }
      })
  }, [exportLineComments])
  const exportLineCommentCounts = useMemo(() => {
    const byLine = new Map<number, number>()
    for (const c of exportLineComments) {
      byLine.set(c.line, (byLine.get(c.line) ?? 0) + 1)
    }
    return byLine
  }, [exportLineComments])
  const exportActiveLineComments = useMemo(() => {
    if (!exportCommentLine) return []
    return exportLineComments
      .filter((c) => c.line === exportCommentLine)
      .sort((a, b) => a.created_at_ms - b.created_at_ms)
  }, [exportCommentLine, exportLineComments])

  const exportSkillReviewCount = useMemo(() => exportSkillLineComments.length, [exportSkillLineComments])
  const exportSkillReviewGroups = useMemo(() => {
    const groups = new Map<number, ReviewLineComment[]>()
    for (const c of exportSkillLineComments) {
      const list = groups.get(c.line) ?? []
      list.push(c)
      groups.set(c.line, list)
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([line, comments]) => {
        const sorted = comments.slice().sort((x, y) => x.created_at_ms - y.created_at_ms)
        const last = sorted[sorted.length - 1]
        const preview = (last?.body ?? '').trim().split('\n')[0] ?? ''
        return { line, count: sorted.length, preview }
      })
  }, [exportSkillLineComments])
  const exportSkillLineCommentCounts = useMemo(() => {
    const byLine = new Map<number, number>()
    for (const c of exportSkillLineComments) {
      byLine.set(c.line, (byLine.get(c.line) ?? 0) + 1)
    }
    return byLine
  }, [exportSkillLineComments])
  const exportSkillActiveLineComments = useMemo(() => {
    if (!exportSkillCommentLine) return []
    return exportSkillLineComments
      .filter((c) => c.line === exportSkillCommentLine)
      .sort((a, b) => a.created_at_ms - b.created_at_ms)
  }, [exportSkillCommentLine, exportSkillLineComments])

  const registerExportLineAnchor = useCallback((line: number | null, el: HTMLElement | null) => {
    if (!line) return
    if (el) exportLineAnchorsRef.current.set(line, el)
    else exportLineAnchorsRef.current.delete(line)
  }, [])

  const registerExportSkillLineAnchor = useCallback((line: number | null, el: HTMLElement | null) => {
    if (!line) return
    if (el) exportSkillLineAnchorsRef.current.set(line, el)
    else exportSkillLineAnchorsRef.current.delete(line)
  }, [])

  const cleanupWorkRuleDiffMouse = useCallback(() => {
    for (const d of exportDiffMouseDisposablesRef.current) {
      try {
        d.dispose()
      } catch {
        // ignore
      }
    }
    exportDiffMouseDisposablesRef.current = []
  }, [])

  const cleanupSkillDiffMouse = useCallback(() => {
    for (const d of exportSkillDiffMouseDisposablesRef.current) {
      try {
        d.dispose()
      } catch {
        // ignore
      }
    }
    exportSkillDiffMouseDisposablesRef.current = []
  }, [])

  const revealWorkRuleHunk = useCallback((h: DiffHunkState) => {
    const ed = workRuleDiffEditorRef.current
    if (!ed) return
    try {
      ed.getOriginalEditor().revealLineInCenter(h.oldStart + 1)
      ed.getModifiedEditor().revealLineInCenter(h.oldStart + 1)
    } catch {
      // ignore
    }
  }, [])

  const revealSkillHunk = useCallback((h: DiffHunkState) => {
    const ed = skillDiffEditorRef.current
    if (!ed) return
    try {
      ed.getOriginalEditor().revealLineInCenter(h.oldStart + 1)
      ed.getModifiedEditor().revealLineInCenter(h.oldStart + 1)
    } catch {
      // ignore
    }
  }, [])

  const selectWorkRuleHunkByLine = useCallback(
    (lineNumber: number) => {
      const idx = lineNumber - 1
      if (idx < 0) return
      const hunks = exportPendingHunksRef.current
      const match =
        hunks.find((h) => {
          const end = Math.max(h.oldEnd, h.oldStart + 1)
          return idx >= h.oldStart && idx < end
        }) ?? null
      if (!match) return
      setExportActiveHunkId(match.id)
      revealWorkRuleHunk(match)
    },
    [revealWorkRuleHunk],
  )

  const selectSkillHunkByLine = useCallback(
    (lineNumber: number) => {
      const idx = lineNumber - 1
      if (idx < 0) return
      const hunks = exportSkillPendingHunksRef.current
      const match =
        hunks.find((h) => {
          const end = Math.max(h.oldEnd, h.oldStart + 1)
          return idx >= h.oldStart && idx < end
        }) ?? null
      if (!match) return
      setExportSkillActiveHunkId(match.id)
      revealSkillHunk(match)
    },
    [revealSkillHunk],
  )

  useEffect(() => {
    if (!showExportWorkRule) cleanupWorkRuleDiffMouse()
  }, [cleanupWorkRuleDiffMouse, showExportWorkRule])

  useEffect(() => {
    if (!showExportSkill) cleanupSkillDiffMouse()
  }, [cleanupSkillDiffMouse, showExportSkill])

  useEffect(() => {
    if (!workRuleDiffOpen) return
    if (exportPendingHunks.length === 0) return
    if (!exportActiveHunkId || !exportPendingHunks.some((h) => h.id === exportActiveHunkId)) {
      setExportActiveHunkId(exportPendingHunks[0].id)
      revealWorkRuleHunk(exportPendingHunks[0])
    }
  }, [exportActiveHunkId, exportPendingHunks, revealWorkRuleHunk, workRuleDiffOpen])

  useEffect(() => {
    if (!skillDiffOpen) return
    if (exportSkillPendingHunks.length === 0) return
    if (
      !exportSkillActiveHunkId ||
      !exportSkillPendingHunks.some((h) => h.id === exportSkillActiveHunkId)
    ) {
      setExportSkillActiveHunkId(exportSkillPendingHunks[0].id)
      revealSkillHunk(exportSkillPendingHunks[0])
    }
  }, [exportSkillActiveHunkId, exportSkillPendingHunks, revealSkillHunk, skillDiffOpen])

  useEffect(() => {
    setSkills(managedSkills)
  }, [managedSkills])

  const loadManagedSkills = useCallback(async () => {
    if (!isTauri) return
    setSkillsLoading(true)
    setSkillsError(null)
    try {
      const list = await invokeTauri<ManagedSkill[]>('get_managed_skills')
      setSkills(list)
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : String(err))
    } finally {
      setSkillsLoading(false)
    }
  }, [invokeTauri, isTauri])

  useEffect(() => {
    void loadManagedSkills()
  }, [loadManagedSkills])

  const loadCodexSkills = useCallback(async () => {
    if (!isTauri) return
    setCodexSkillsLoading(true)
    setCodexSkillsError(null)
    try {
      const list = await invokeTauri<CodexInstalledSkill[]>('list_codex_installed_skills')
      setCodexSkills(list)
    } catch (err) {
      setCodexSkillsError(err instanceof Error ? err.message : String(err))
    } finally {
      setCodexSkillsLoading(false)
    }
  }, [invokeTauri, isTauri])

  useEffect(() => {
    void loadCodexSkills()
  }, [loadCodexSkills])

  const loadLlmAgents = useCallback(async () => {
    if (!isTauri) return
    setLlmAgentsLoading(true)
    setLlmAgentsError(null)
    try {
      const list = await invokeTauri<LlmAgent[]>('list_llm_agents')
      setLlmAgents(list)
    } catch (err) {
      setLlmAgentsError(err instanceof Error ? err.message : String(err))
    } finally {
      setLlmAgentsLoading(false)
    }
  }, [invokeTauri, isTauri])

  useEffect(() => {
    void loadLlmAgents()
  }, [loadLlmAgents])

  useEffect(() => {
    if (!showImportMenu) return
    const onPointerDown = (event: MouseEvent) => {
      const node = importMenuRef.current
      if (!node) return
      if (node.contains(event.target as Node)) return
      setShowImportMenu(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [showImportMenu])

  useEffect(() => {
    if (!exportReviewOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const pop = exportReviewPopoverRef.current
      const btn = exportReviewButtonRef.current
      const target = event.target as Node | null
      if (!target) return
      if (pop?.contains(target)) return
      if (btn?.contains(target)) return
      setExportReviewOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [exportReviewOpen])

  useEffect(() => {
    if (!exportSkillReviewOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const pop = exportSkillReviewPopoverRef.current
      const btn = exportSkillReviewButtonRef.current
      const target = event.target as Node | null
      if (!target) return
      if (pop?.contains(target)) return
      if (btn?.contains(target)) return
      setExportSkillReviewOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [exportSkillReviewOpen])

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skills
    return skills.filter((s) => s.name.toLowerCase().includes(q))
  }, [query, skills])

  const filteredCodexSkills = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return codexSkills
    return codexSkills.filter((s) => s.name.toLowerCase().includes(q) || s.path.toLowerCase().includes(q))
  }, [codexSkills, query])

  const codexInstalledPages = useMemo(() => {
    const total = filteredCodexSkills.length
    return Math.max(1, Math.ceil(total / CODEX_INSTALLED_PAGE_SIZE))
  }, [filteredCodexSkills.length])

  useEffect(() => {
    setCodexInstalledPage(1)
  }, [query])

  useEffect(() => {
    setCodexInstalledPage((prev) => Math.min(Math.max(1, prev), codexInstalledPages))
  }, [codexInstalledPages])

  const pagedCodexSkills = useMemo(() => {
    const start = (codexInstalledPage - 1) * CODEX_INSTALLED_PAGE_SIZE
    return filteredCodexSkills.slice(start, start + CODEX_INSTALLED_PAGE_SIZE)
  }, [codexInstalledPage, filteredCodexSkills])

  const filteredLocalSources = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return localSources
    return localSources.filter(
      (s) => s.label.toLowerCase().includes(q) || s.path.toLowerCase().includes(q),
    )
  }, [localSources, query])

  const onSelectManagedSkillId = useCallback(
    async (skillId: string) => {
      if (!isTauri) return
      setSelected({ kind: 'managed', id: skillId })
      setSnapshot(null)
      setFilePreview(null)
      setError(null)
      setLoading(true)
      try {
        const snap = await invokeTauri<SkillSnapshot>('get_skill_snapshot', {
          skillId,
        })
        setSnapshot(snap)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [invokeTauri, isTauri],
  )

  const onSelectSkill = useCallback(
    async (skill: ManagedSkill) => {
      await onSelectManagedSkillId(skill.id)
    },
    [onSelectManagedSkillId],
  )

  const onSelectLocalFile = useCallback(
    async (path: string) => {
      if (!isTauri) return
      setSelected({ kind: 'local_file', path })
      setSnapshot(null)
      setFilePreview(null)
      setError(null)
      setLoading(true)
      try {
        const content = await invokeTauri<string>('read_text_file', {
          path,
          maxBytes: 1024 * 1024,
        })
        setFilePreview({ path, content })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [invokeTauri, isTauri],
  )

  const onSelectLocalDir = useCallback(
    async (path: string) => {
      if (!isTauri) return
      setSelected({ kind: 'local_dir', path })
      setSnapshot(null)
      setFilePreview(null)
      setError(null)
      setLoading(true)
      try {
        const snap = await invokeTauri<SkillSnapshot>('get_path_snapshot', { path })
        setSnapshot(snap)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [invokeTauri, isTauri],
  )

  const importLocalFiles = useCallback(async () => {
    if (!isTauri) return
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      multiple: true,
      directory: false,
      title: t('refinery.importFilesPick'),
    })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]

    setLocalSources((prev) => {
      const next = [...prev]
      for (const p of paths) {
        if (!next.some((s) => s.kind === 'file' && s.path === p)) {
          next.push({ kind: 'file', path: p, label: fileNameFromPath(p) })
        }
      }
      return next
    })

    if (paths[0]) {
      await onSelectLocalFile(paths[0])
    }
  }, [isTauri, onSelectLocalFile, t])

  const importLocalDir = useCallback(async () => {
    if (!isTauri) return
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      multiple: false,
      directory: true,
      title: t('refinery.importDirPick'),
    })
    if (!selected || Array.isArray(selected)) return
    setLocalSources((prev) => {
      if (prev.some((s) => s.kind === 'dir' && s.path === selected)) return prev
      return [...prev, { kind: 'dir', path: selected, label: fileNameFromPath(selected) }]
    })
    await onSelectLocalDir(selected)
  }, [isTauri, onSelectLocalDir, t])

  const addToSession = useCallback(
    (label: string, source: SelectedSource, badgeSystem: boolean) => {
      const key = sessionKeyForSource(source)
      setSession((prev) => {
        if (prev.some((s) => s.key === key)) return prev
        return [...prev, { key, label, source, note: '', badgeSystem }]
      })
      toast.success(t('refinery.sessionAdded'))
    },
    [t],
  )

  const addSelectedToSession = useCallback(() => {
    if (!selected) return
    const key = sessionKeyForSource(selected)
    if (session.some((s) => s.key === key)) return

    if (selected.kind === 'managed') {
      const skill = skills.find((s) => s.id === selected.id)
      addToSession(skill?.name ?? selected.id, selected, false)
      return
    }

    if (selected.kind === 'local_file') {
      addToSession(fileNameFromPath(selected.path), selected, false)
      return
    }

    const codexSkill = codexSkills.find((s) => s.path === selected.path)
    addToSession(
      codexSkill?.name ?? fileNameFromPath(selected.path),
      selected,
      codexSkill?.is_system ?? false,
    )
  }, [addToSession, codexSkills, selected, session, skills])

  const removeSessionItem = useCallback((key: string) => {
    setSession((prev) => prev.filter((s) => s.key !== key))
  }, [])

  const moveSessionItem = useCallback((idx: number, dir: -1 | 1) => {
    setSession((prev) => {
      const nextIndex = idx + dir
      if (idx < 0 || idx >= prev.length) return prev
      if (nextIndex < 0 || nextIndex >= prev.length) return prev
      const copy = [...prev]
      const a = copy[idx]
      const b = copy[nextIndex]
      if (!a || !b) return prev
      copy[idx] = b
      copy[nextIndex] = a
      return copy
    })
  }, [])

  const updateSessionNote = useCallback((key: string, note: string) => {
    setSession((prev) => prev.map((s) => (s.key === key ? { ...s, note } : s)))
  }, [])

  const selectSessionItem = useCallback(
    async (item: SessionItem) => {
      if (item.source.kind === 'managed') {
        await onSelectManagedSkillId(item.source.id)
        return
      }
      if (item.source.kind === 'local_file') {
        await onSelectLocalFile(item.source.path)
        return
      }
      await onSelectLocalDir(item.source.path)
    },
    [onSelectLocalDir, onSelectLocalFile, onSelectManagedSkillId],
  )

  const closeExportWorkRule = useCallback(() => {
    setShowExportWorkRule(false)
    setExportAnalysis('')
    setExportOptimized('')
    setExportDiffHunks([])
    setExportReviewOpen(false)
    setExportReviewMessage('')
    setExportLineComments([])
    setExportCommentLine(null)
    setExportCommentComposerOpen(false)
    setExportCommentDraft('')
    setExportEditingCommentId(null)
    setExportCommentCardTop(12)
    exportLineAnchorsRef.current.clear()
  }, [])

  const closeExportSkill = useCallback(() => {
    setShowExportSkill(false)
    setExportSkillAnalysis('')
    setExportSkillOptimized('')
    setExportSkillDiffHunks([])
    setExportSkillReviewOpen(false)
    setExportSkillReviewMessage('')
    setExportSkillLineComments([])
    setExportSkillCommentLine(null)
    setExportSkillCommentComposerOpen(false)
    setExportSkillCommentDraft('')
    setExportSkillEditingCommentId(null)
    setExportSkillCommentCardTop(12)
    exportSkillLineAnchorsRef.current.clear()
  }, [])

  useEffect(() => {
    if (!showExportWorkRule) return
    if (exportAgentId) return
    if (llmAgents.length === 0) return
    setExportAgentId(llmAgents[0]?.id ?? '')
  }, [exportAgentId, llmAgents, showExportWorkRule])

  useEffect(() => {
    if (!showExportSkill) return
    if (exportSkillAgentId) return
    if (llmAgents.length === 0) return
    setExportSkillAgentId(llmAgents[0]?.id ?? '')
  }, [exportSkillAgentId, llmAgents, showExportSkill])

  const ensureSkillFrontmatter = useCallback((raw: string, name: string) => {
    const content = raw.trimStart()
    if (content.startsWith('---\n') || content.startsWith('---\r\n')) {
      const normalized = content.replace(/\r\n/g, '\n')
      const end = normalized.indexOf('\n---\n', 4)
      if (end !== -1) {
        const front = normalized.slice(0, end + '\n---\n'.length)
        const body = normalized.slice(end + '\n---\n'.length)
        const lines = front.split('\n')
        const out: string[] = []
        let replaced = false
        for (const line of lines) {
          if (!replaced && line.trim().startsWith('name:')) {
            out.push(`name: ${name}`)
            replaced = true
          } else {
            out.push(line)
          }
        }
        if (!replaced) {
          out.splice(1, 0, `name: ${name}`)
        }
        return `${out.join('\n')}${body}`.trimEnd() + '\n'
      }
    }
    return `---\nname: ${name}\n---\n\n${raw.trimEnd()}\n`
  }, [])

  const openExportWorkRule = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (session.length === 0) {
      toast.error(t('refinery.sessionEmpty'))
      return
    }

    setExportName('')
    setExportEntryFile('AGENTS.md')
    setExportTags('')
    setExportScore('')
    setExportDescription('')
    setExportContent('')
    setExportMode('fusion')
    setExportAgentId('')
    setExportResult('')
    setExportAnalysis('')
    setExportContentTab('preview')
    setExportOptimized('')
    setExportDiffHunks([])
    setShowExportWorkRule(true)

    setExportLoading(true)
    try {
      const parts: string[] = []
      parts.push(`# ${t('refinery.draftTitle')}`)
      parts.push('')
      parts.push(`## ${t('refinery.draftSources')}`)
      for (const item of session) {
        const kindLabel =
          item.source.kind === 'managed'
            ? t('refinery.kindManaged')
            : item.source.kind === 'local_file'
              ? t('refinery.kindFile')
              : t('refinery.kindFolder')
        parts.push(`- ${item.label} (${kindLabel})`)
      }
      parts.push('')

      for (const item of session) {
        const kindLabel =
          item.source.kind === 'managed'
            ? t('refinery.kindManaged')
            : item.source.kind === 'local_file'
              ? t('refinery.kindFile')
              : t('refinery.kindFolder')

        parts.push('---')
        parts.push('')
        parts.push(`## ${item.label} (${kindLabel})`)
        if (item.badgeSystem) {
          parts.push(`> ${t('refinery.badgeSystem')}`)
          parts.push('')
        }
        if (item.note.trim()) {
          parts.push(`> ${t('refinery.note')}: ${item.note.trim()}`)
          parts.push('')
        }

        if (item.source.kind === 'managed') {
          const snap = await invokeTauri<SkillSnapshot>('get_skill_snapshot', {
            skillId: item.source.id,
          })
          if (snap.skill_md) {
            parts.push(snap.skill_md.trim())
            parts.push('')
          } else {
            parts.push(`(${t('refinery.noSkillMd')})`)
            parts.push('')
          }
          continue
        }

        if (item.source.kind === 'local_file') {
          const content = await invokeTauri<string>('read_text_file', {
            path: item.source.path,
            maxBytes: 1024 * 1024,
          })
          parts.push(content.trim())
          parts.push('')
          continue
        }

        const snap = await invokeTauri<SkillSnapshot>('get_path_snapshot', {
          path: item.source.path,
        })
        if (snap.skill_md) {
          parts.push(snap.skill_md.trim())
          parts.push('')
        } else {
          parts.push(`(${t('refinery.noSkillMd')})`)
          parts.push('')
        }
        if (snap.truncated) {
          parts.push(`> ${t('refinery.truncatedTitle')}: ${snap.truncated_reason ?? t('refinery.truncatedDefault')}`)
          parts.push('')
        }
        if (snap.files.length) {
          parts.push(`### ${t('refinery.filesTitle', { count: snap.files.length })}`)
          parts.push('')
          parts.push('```')
          parts.push(snap.files.map((f) => f.rel_path).join('\n'))
          parts.push('```')
          parts.push('')
        }
      }

      setExportContent(parts.join('\n'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExportLoading(false)
    }
  }, [invokeTauri, isTauri, session, t])

  const openExportSkill = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (session.length === 0) {
      toast.error(t('refinery.sessionEmpty'))
      return
    }

    setExportSkillName('')
    setExportSkillOverwrite(false)
    setExportSkillContent('')
    setExportSkillMode('fusion')
    setExportSkillAgentId('')
    setExportSkillResult('')
    setExportSkillAnalysis('')
    setExportSkillContentTab('preview')
    setExportSkillOptimized('')
    setExportSkillDiffHunks([])
    setShowExportSkill(true)

    setExportSkillLoading(true)
    try {
      const parts: string[] = []
      parts.push('---')
      parts.push(`name: refined-skill`)
      parts.push(`description: ${t('refinery.skillDraftDescription', { count: session.length })}`)
      parts.push('---')
      parts.push('')
      parts.push(`# ${t('refinery.skillDraftTitle')}`)
      parts.push('')
      parts.push(`## ${t('refinery.draftSources')}`)
      for (const item of session) {
        const kindLabel =
          item.source.kind === 'managed'
            ? t('refinery.kindManaged')
            : item.source.kind === 'local_file'
              ? t('refinery.kindFile')
              : t('refinery.kindFolder')
        parts.push(`- ${item.label} (${kindLabel})`)
      }
      parts.push('')
      parts.push(`## ${t('refinery.skillDraftInstructions')}`)
      parts.push('')

      for (const item of session) {
        const kindLabel =
          item.source.kind === 'managed'
            ? t('refinery.kindManaged')
            : item.source.kind === 'local_file'
              ? t('refinery.kindFile')
              : t('refinery.kindFolder')

        parts.push('---')
        parts.push('')
        parts.push(`### ${item.label} (${kindLabel})`)
        if (item.badgeSystem) {
          parts.push(`> ${t('refinery.badgeSystem')}`)
          parts.push('')
        }
        if (item.note.trim()) {
          parts.push(`> ${t('refinery.note')}: ${item.note.trim()}`)
          parts.push('')
        }

        if (item.source.kind === 'managed') {
          const snap = await invokeTauri<SkillSnapshot>('get_skill_snapshot', {
            skillId: item.source.id,
          })
          if (snap.skill_md) {
            parts.push(snap.skill_md.trim())
            parts.push('')
          } else {
            parts.push(`(${t('refinery.noSkillMd')})`)
            parts.push('')
          }
          continue
        }

        if (item.source.kind === 'local_file') {
          const content = await invokeTauri<string>('read_text_file', {
            path: item.source.path,
            maxBytes: 1024 * 1024,
          })
          parts.push(content.trim())
          parts.push('')
          continue
        }

        const snap = await invokeTauri<SkillSnapshot>('get_path_snapshot', {
          path: item.source.path,
        })
        if (snap.skill_md) {
          parts.push(snap.skill_md.trim())
          parts.push('')
        } else {
          parts.push(`(${t('refinery.noSkillMd')})`)
          parts.push('')
        }
        if (snap.truncated) {
          parts.push(
            `> ${t('refinery.truncatedTitle')}: ${snap.truncated_reason ?? t('refinery.truncatedDefault')}`,
          )
          parts.push('')
        }
        if (snap.files.length) {
          parts.push(`#### ${t('refinery.filesTitle', { count: snap.files.length })}`)
          parts.push('')
          parts.push('```')
          parts.push(snap.files.map((f) => f.rel_path).join('\n'))
          parts.push('```')
          parts.push('')
        }
      }

      setExportSkillContent(parts.join('\n'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExportSkillLoading(false)
    }
  }, [invokeTauri, isTauri, session, t])

  const resetWorkRuleReview = useCallback(() => {
    setExportReviewOpen(false)
    setExportReviewMessage('')
    setExportLineComments([])
    setExportCommentLine(null)
    setExportCommentComposerOpen(false)
    setExportCommentDraft('')
    setExportEditingCommentId(null)
    setExportCommentCardTop(12)
  }, [])

  const runWorkRuleLlm = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!exportAgentId.trim()) {
      toast.error(t('refinery.selectAgentFirst'))
      return
    }
    if (llmAgents.length === 0) {
      toast.error(t('refinery.noAgents'))
      return
    }
    if (!exportContent.trim()) {
      toast.error(t('refinery.sourceEmpty'))
      return
    }

    setExportLoading(true)
    try {
      const out = await invokeTauri<string>('run_llm_agent', {
        agentId: exportAgentId,
        mode: exportMode,
        outputKind: 'work_rule',
        sourceMd: exportContent,
        analysisMd: null,
      })
      if (exportMode === 'fusion') {
        setExportResult(out)
        setExportContentTab('preview')
        setExportAnalysis('')
        setExportOptimized('')
        setExportDiffHunks([])
      } else {
        resetWorkRuleReview()
        setExportAnalysis(out)
        setExportOptimized('')
        setExportDiffHunks([])
      }
      toast.success(exportMode === 'fusion' ? t('refinery.fusionDone') : t('refinery.analysisDone'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExportLoading(false)
    }
  }, [exportAgentId, exportContent, exportMode, invokeTauri, isTauri, llmAgents.length, resetWorkRuleReview, t])

  const openWorkRuleLineComment = useCallback(
    (line: number, compose: boolean = false) => {
      if (!exportAnalysis.trim()) return
      setExportCommentLine(line)
      setExportCommentComposerOpen(compose)
      setExportCommentDraft('')
      setExportEditingCommentId(null)

      const wrap = exportAnalysisWrapRef.current
      const anchor = exportLineAnchorsRef.current.get(line)
      if (!wrap || !anchor) {
        setExportCommentCardTop(12)
        return
      }
      try {
        const wrapRect = wrap.getBoundingClientRect()
        const anchorRect = anchor.getBoundingClientRect()
        const rawTop = anchorRect.top - wrapRect.top
        const maxTop = Math.max(12, wrap.clientHeight - 320)
        setExportCommentCardTop(Math.max(12, Math.min(rawTop, maxTop)))
      } catch {
        setExportCommentCardTop(12)
      }
    },
    [exportAnalysis],
  )

  const startEditWorkRuleLineComment = useCallback(
    (comment: ReviewLineComment) => {
      openWorkRuleLineComment(comment.line, true)
      setExportCommentDraft(comment.body)
      setExportEditingCommentId(comment.id)
    },
    [openWorkRuleLineComment],
  )

  const deleteWorkRuleLineComment = useCallback(
    (id: string) => {
      setExportLineComments((prev) => prev.filter((c) => c.id !== id))
      if (exportEditingCommentId === id) {
        setExportCommentDraft('')
        setExportEditingCommentId(null)
        setExportCommentComposerOpen(false)
      }
    },
    [exportEditingCommentId],
  )

  const submitWorkRuleLineComment = useCallback(() => {
    if (!exportCommentLine) return
    const body = exportCommentDraft.trim()
    if (!body) return

    if (exportEditingCommentId) {
      setExportLineComments((prev) =>
        prev.map((c) => (c.id === exportEditingCommentId ? { ...c, body } : c)),
      )
      setExportEditingCommentId(null)
      setExportCommentDraft('')
      setExportCommentComposerOpen(false)
      return
    }

    const now = Date.now()
    setExportLineComments((prev) => [
      ...prev,
      {
        id: newReviewCommentId(),
        line: exportCommentLine,
        body,
        created_at_ms: now,
      },
    ])
    setExportCommentDraft('')
    setExportCommentComposerOpen(false)
  }, [exportCommentDraft, exportCommentLine, exportEditingCommentId])

  const decideWorkRuleDiff = useCallback((hunkId: string, decision: 'accept' | 'reject') => {
    setExportDiffHunks((prev) =>
      prev.map((h) => (h.id === hunkId ? { ...h, decision } : h)),
    )
  }, [])

  const navWorkRuleDiff = useCallback(
    (dir: -1 | 1) => {
      if (exportPendingHunks.length === 0) return
      const idx = exportPendingHunks.findIndex((h) => h.id === exportActiveHunk?.id)
      const next = exportPendingHunks[idx + dir]
      if (!next) return
      setExportActiveHunkId(next.id)
      revealWorkRuleHunk(next)
    },
    [exportActiveHunk?.id, exportPendingHunks, revealWorkRuleHunk],
  )

  const decideActiveWorkRuleDiff = useCallback(
    (decision: 'accept' | 'reject') => {
      const active = exportActiveHunk
      if (!active) return
      const idx = exportPendingHunks.findIndex((h) => h.id === active.id)
      const next = exportPendingHunks[idx + 1] ?? exportPendingHunks[idx - 1] ?? null
      decideWorkRuleDiff(active.id, decision)
      setExportActiveHunkId(next?.id ?? '')
      if (next) revealWorkRuleHunk(next)
    },
    [decideWorkRuleDiff, exportActiveHunk, exportPendingHunks, revealWorkRuleHunk],
  )

  const runWorkRuleOptimize = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!exportAgentId.trim()) {
      toast.error(t('refinery.selectAgentFirst'))
      return
    }
    if (llmAgents.length === 0) {
      toast.error(t('refinery.noAgents'))
      return
    }
    if (!exportContent.trim()) {
      toast.error(t('refinery.sourceEmpty'))
      return
    }
    if (!exportAnalysis.trim()) {
      toast.error(t('refinery.optimizeNeedsAnalysis'))
      return
    }

    setExportReviewOpen(false)
    setExportCommentLine(null)
    setExportCommentComposerOpen(false)
    setExportCommentDraft('')
    setExportEditingCommentId(null)
    setExportLoading(true)
    try {
      const analysisMd = buildAnalysisWithReviewComments(exportAnalysis, exportReviewMessage, exportLineComments)
      const out = await invokeTauri<string>('run_llm_agent', {
        agentId: exportAgentId,
        mode: 'optimize',
        outputKind: 'work_rule',
        sourceMd: exportContent,
        analysisMd,
      })
      setExportOptimized(out)
      setExportDiffHunks(initHunkStates(buildLineDiffHunks(exportContent, out)))
      toast.success(t('refinery.optimizeDone'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExportLoading(false)
    }
  }, [
    exportAgentId,
    exportAnalysis,
    exportContent,
    exportLineComments,
    exportReviewMessage,
    invokeTauri,
    isTauri,
    llmAgents.length,
    t,
  ])

  const saveWorkRuleOptimized = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!exportOptimizedFinal.trim()) {
      toast.error(t('refinery.optimizeNotReady'))
      return
    }
    if (exportPendingDiffs > 0) {
      toast.error(t('refinery.resolveDiffsFirst'))
      return
    }

    try {
      const { confirm, save } = await import('@tauri-apps/plugin-dialog')
      const dest = await save({
        title: t('refinery.saveOptimizedTitle'),
        defaultPath: exportEntryFile.trim() || 'AGENTS.md',
      })
      if (!dest) return

      try {
        await invokeTauri('write_text_file', {
          path: dest,
          content: exportOptimizedFinal,
          overwrite: false,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('already exists')) {
          const ok = await confirm(t('refinery.confirmOverwrite'), {
            kind: 'warning',
            title: t('refinery.confirmOverwriteTitle'),
          })
          if (!ok) return
          await invokeTauri('write_text_file', {
            path: dest,
            content: exportOptimizedFinal,
            overwrite: true,
          })
        } else {
          throw err
        }
      }

      toast.success(t('refinery.savedTo', { dest }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [
    exportEntryFile,
    exportOptimizedFinal,
    exportPendingDiffs,
    invokeTauri,
    isTauri,
    t,
  ])

  const resetSkillReview = useCallback(() => {
    setExportSkillReviewOpen(false)
    setExportSkillReviewMessage('')
    setExportSkillLineComments([])
    setExportSkillCommentLine(null)
    setExportSkillCommentComposerOpen(false)
    setExportSkillCommentDraft('')
    setExportSkillEditingCommentId(null)
    setExportSkillCommentCardTop(12)
  }, [])

  const runSkillLlm = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!exportSkillAgentId.trim()) {
      toast.error(t('refinery.selectAgentFirst'))
      return
    }
    if (llmAgents.length === 0) {
      toast.error(t('refinery.noAgents'))
      return
    }
    if (!exportSkillContent.trim()) {
      toast.error(t('refinery.sourceEmpty'))
      return
    }

    setExportSkillLoading(true)
    try {
      const out = await invokeTauri<string>('run_llm_agent', {
        agentId: exportSkillAgentId,
        mode: exportSkillMode,
        outputKind: 'skill',
        sourceMd: exportSkillContent,
        analysisMd: null,
      })
      if (exportSkillMode === 'fusion') {
        setExportSkillResult(out)
        setExportSkillContentTab('preview')
        setExportSkillAnalysis('')
        setExportSkillOptimized('')
        setExportSkillDiffHunks([])
      } else {
        resetSkillReview()
        setExportSkillAnalysis(out)
        setExportSkillOptimized('')
        setExportSkillDiffHunks([])
      }
      toast.success(
        exportSkillMode === 'fusion' ? t('refinery.fusionDone') : t('refinery.analysisDone'),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExportSkillLoading(false)
    }
  }, [
    exportSkillAgentId,
    exportSkillContent,
    exportSkillMode,
    invokeTauri,
    isTauri,
    llmAgents.length,
    resetSkillReview,
    t,
  ])

  const openSkillLineComment = useCallback(
    (line: number, compose: boolean = false) => {
      if (!exportSkillAnalysis.trim()) return
      setExportSkillCommentLine(line)
      setExportSkillCommentComposerOpen(compose)
      setExportSkillCommentDraft('')
      setExportSkillEditingCommentId(null)

      const wrap = exportSkillAnalysisWrapRef.current
      const anchor = exportSkillLineAnchorsRef.current.get(line)
      if (!wrap || !anchor) {
        setExportSkillCommentCardTop(12)
        return
      }
      try {
        const wrapRect = wrap.getBoundingClientRect()
        const anchorRect = anchor.getBoundingClientRect()
        const rawTop = anchorRect.top - wrapRect.top
        const maxTop = Math.max(12, wrap.clientHeight - 320)
        setExportSkillCommentCardTop(Math.max(12, Math.min(rawTop, maxTop)))
      } catch {
        setExportSkillCommentCardTop(12)
      }
    },
    [exportSkillAnalysis],
  )

  const startEditSkillLineComment = useCallback(
    (comment: ReviewLineComment) => {
      openSkillLineComment(comment.line, true)
      setExportSkillCommentDraft(comment.body)
      setExportSkillEditingCommentId(comment.id)
    },
    [openSkillLineComment],
  )

  const deleteSkillLineComment = useCallback(
    (id: string) => {
      setExportSkillLineComments((prev) => prev.filter((c) => c.id !== id))
      if (exportSkillEditingCommentId === id) {
        setExportSkillCommentDraft('')
        setExportSkillEditingCommentId(null)
        setExportSkillCommentComposerOpen(false)
      }
    },
    [exportSkillEditingCommentId],
  )

  const submitSkillLineComment = useCallback(() => {
    if (!exportSkillCommentLine) return
    const body = exportSkillCommentDraft.trim()
    if (!body) return

    if (exportSkillEditingCommentId) {
      setExportSkillLineComments((prev) =>
        prev.map((c) => (c.id === exportSkillEditingCommentId ? { ...c, body } : c)),
      )
      setExportSkillEditingCommentId(null)
      setExportSkillCommentDraft('')
      setExportSkillCommentComposerOpen(false)
      return
    }

    const now = Date.now()
    setExportSkillLineComments((prev) => [
      ...prev,
      {
        id: newReviewCommentId(),
        line: exportSkillCommentLine,
        body,
        created_at_ms: now,
      },
    ])
    setExportSkillCommentDraft('')
    setExportSkillCommentComposerOpen(false)
  }, [exportSkillCommentDraft, exportSkillCommentLine, exportSkillEditingCommentId])

  const exportAnalysisMarkdownComponents = useMemo(() => {
    const getLine = (node: unknown): number | null =>
      ((node as { position?: { start?: { line?: number } } } | null)?.position?.start?.line ??
        null)

    const wrap =
      (tag: string) =>
      ({ node, children, ...props }: { node?: unknown; children?: unknown } & Record<string, unknown>) => {
        const line = getLine(node)
        const count = line ? (exportLineCommentCounts.get(line) ?? 0) : 0
        const Tag = tag as unknown as (props: Record<string, unknown>) => any
        return (
          <div
            className="md-line"
            data-line={line ?? undefined}
            ref={(el) => registerExportLineAnchor(line, el)}
          >
            <div className="md-line-gutter">
              {line ? (
                <button
                  className="md-line-btn"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openWorkRuleLineComment(line, true)
                  }}
                  title={t('refinery.addLineComment')}
                  aria-label={t('refinery.addLineComment')}
                >
                  <Plus size={14} />
                </button>
              ) : (
                <span className="md-line-spacer" />
              )}
              {line && count > 0 ? <span className="md-line-count">{count}</span> : null}
            </div>
            <div className="md-line-content">
              <Tag {...props}>{children as any}</Tag>
            </div>
          </div>
        )
      }

    const wrapVoid =
      (tag: string) =>
      ({ node, ...props }: { node?: unknown } & Record<string, unknown>) => {
        const line = getLine(node)
        const count = line ? (exportLineCommentCounts.get(line) ?? 0) : 0
        const Tag = tag as unknown as (props: Record<string, unknown>) => any
        return (
          <div
            className="md-line"
            data-line={line ?? undefined}
            ref={(el) => registerExportLineAnchor(line, el)}
          >
            <div className="md-line-gutter">
              {line ? (
                <button
                  className="md-line-btn"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openWorkRuleLineComment(line, true)
                  }}
                  title={t('refinery.addLineComment')}
                  aria-label={t('refinery.addLineComment')}
                >
                  <Plus size={14} />
                </button>
              ) : (
                <span className="md-line-spacer" />
              )}
              {line && count > 0 ? <span className="md-line-count">{count}</span> : null}
            </div>
            <div className="md-line-content">
              <Tag {...props} />
            </div>
          </div>
        )
      }

    return {
      p: wrap('p'),
      h1: wrap('h1'),
      h2: wrap('h2'),
      h3: wrap('h3'),
      h4: wrap('h4'),
      h5: wrap('h5'),
      h6: wrap('h6'),
      pre: wrap('pre'),
      blockquote: wrap('blockquote'),
      table: wrap('table'),
      ul: wrap('ul'),
      ol: wrap('ol'),
      li: wrap('li'),
      hr: wrapVoid('hr'),
    } as Record<string, unknown>
  }, [
    exportLineCommentCounts,
    openWorkRuleLineComment,
    registerExportLineAnchor,
    t,
  ])

  const exportSkillAnalysisMarkdownComponents = useMemo(() => {
    const getLine = (node: unknown): number | null =>
      ((node as { position?: { start?: { line?: number } } } | null)?.position?.start?.line ??
        null)

    const wrap =
      (tag: string) =>
      ({ node, children, ...props }: { node?: unknown; children?: unknown } & Record<string, unknown>) => {
        const line = getLine(node)
        const count = line ? (exportSkillLineCommentCounts.get(line) ?? 0) : 0
        const Tag = tag as unknown as (props: Record<string, unknown>) => any
        return (
          <div
            className="md-line"
            data-line={line ?? undefined}
            ref={(el) => registerExportSkillLineAnchor(line, el)}
          >
            <div className="md-line-gutter">
              {line ? (
                <button
                  className="md-line-btn"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openSkillLineComment(line, true)
                  }}
                  title={t('refinery.addLineComment')}
                  aria-label={t('refinery.addLineComment')}
                >
                  <Plus size={14} />
                </button>
              ) : (
                <span className="md-line-spacer" />
              )}
              {line && count > 0 ? <span className="md-line-count">{count}</span> : null}
            </div>
            <div className="md-line-content">
              <Tag {...props}>{children as any}</Tag>
            </div>
          </div>
        )
      }

    const wrapVoid =
      (tag: string) =>
      ({ node, ...props }: { node?: unknown } & Record<string, unknown>) => {
        const line = getLine(node)
        const count = line ? (exportSkillLineCommentCounts.get(line) ?? 0) : 0
        const Tag = tag as unknown as (props: Record<string, unknown>) => any
        return (
          <div
            className="md-line"
            data-line={line ?? undefined}
            ref={(el) => registerExportSkillLineAnchor(line, el)}
          >
            <div className="md-line-gutter">
              {line ? (
                <button
                  className="md-line-btn"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openSkillLineComment(line, true)
                  }}
                  title={t('refinery.addLineComment')}
                  aria-label={t('refinery.addLineComment')}
                >
                  <Plus size={14} />
                </button>
              ) : (
                <span className="md-line-spacer" />
              )}
              {line && count > 0 ? <span className="md-line-count">{count}</span> : null}
            </div>
            <div className="md-line-content">
              <Tag {...props} />
            </div>
          </div>
        )
      }

    return {
      p: wrap('p'),
      h1: wrap('h1'),
      h2: wrap('h2'),
      h3: wrap('h3'),
      h4: wrap('h4'),
      h5: wrap('h5'),
      h6: wrap('h6'),
      pre: wrap('pre'),
      blockquote: wrap('blockquote'),
      table: wrap('table'),
      ul: wrap('ul'),
      ol: wrap('ol'),
      li: wrap('li'),
      hr: wrapVoid('hr'),
    } as Record<string, unknown>
  }, [
    exportSkillLineCommentCounts,
    openSkillLineComment,
    registerExportSkillLineAnchor,
    t,
  ])

  const decideSkillDiff = useCallback((hunkId: string, decision: 'accept' | 'reject') => {
    setExportSkillDiffHunks((prev) =>
      prev.map((h) => (h.id === hunkId ? { ...h, decision } : h)),
    )
  }, [])

  const navSkillDiff = useCallback(
    (dir: -1 | 1) => {
      if (exportSkillPendingHunks.length === 0) return
      const idx = exportSkillPendingHunks.findIndex((h) => h.id === exportSkillActiveHunk?.id)
      const next = exportSkillPendingHunks[idx + dir]
      if (!next) return
      setExportSkillActiveHunkId(next.id)
      revealSkillHunk(next)
    },
    [exportSkillActiveHunk?.id, exportSkillPendingHunks, revealSkillHunk],
  )

  const decideActiveSkillDiff = useCallback(
    (decision: 'accept' | 'reject') => {
      const active = exportSkillActiveHunk
      if (!active) return
      const idx = exportSkillPendingHunks.findIndex((h) => h.id === active.id)
      const next = exportSkillPendingHunks[idx + 1] ?? exportSkillPendingHunks[idx - 1] ?? null
      decideSkillDiff(active.id, decision)
      setExportSkillActiveHunkId(next?.id ?? '')
      if (next) revealSkillHunk(next)
    },
    [decideSkillDiff, exportSkillActiveHunk, exportSkillPendingHunks, revealSkillHunk],
  )

  const runSkillOptimize = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!exportSkillAgentId.trim()) {
      toast.error(t('refinery.selectAgentFirst'))
      return
    }
    if (llmAgents.length === 0) {
      toast.error(t('refinery.noAgents'))
      return
    }
    if (!exportSkillContent.trim()) {
      toast.error(t('refinery.sourceEmpty'))
      return
    }
    if (!exportSkillAnalysis.trim()) {
      toast.error(t('refinery.optimizeNeedsAnalysis'))
      return
    }

    setExportSkillReviewOpen(false)
    setExportSkillCommentLine(null)
    setExportSkillCommentComposerOpen(false)
    setExportSkillCommentDraft('')
    setExportSkillEditingCommentId(null)
    setExportSkillLoading(true)
    try {
      const analysisMd = buildAnalysisWithReviewComments(
        exportSkillAnalysis,
        exportSkillReviewMessage,
        exportSkillLineComments,
      )
      const out = await invokeTauri<string>('run_llm_agent', {
        agentId: exportSkillAgentId,
        mode: 'optimize',
        outputKind: 'skill',
        sourceMd: exportSkillContent,
        analysisMd,
      })
      setExportSkillOptimized(out)
      setExportSkillDiffHunks(initHunkStates(buildLineDiffHunks(exportSkillContent, out)))
      toast.success(t('refinery.optimizeDone'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExportSkillLoading(false)
    }
  }, [
    exportSkillAgentId,
    exportSkillAnalysis,
    exportSkillContent,
    exportSkillLineComments,
    exportSkillReviewMessage,
    invokeTauri,
    isTauri,
    llmAgents.length,
    t,
  ])

  const saveSkillOptimized = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!exportSkillOptimizedFinal.trim()) {
      toast.error(t('refinery.optimizeNotReady'))
      return
    }
    if (exportSkillPendingDiffs > 0) {
      toast.error(t('refinery.resolveDiffsFirst'))
      return
    }

    try {
      const { confirm, save } = await import('@tauri-apps/plugin-dialog')
      const dest = await save({
        title: t('refinery.saveOptimizedTitle'),
        defaultPath: 'SKILL.md',
      })
      if (!dest) return

      try {
        await invokeTauri('write_text_file', {
          path: dest,
          content: exportSkillOptimizedFinal,
          overwrite: false,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('already exists')) {
          const ok = await confirm(t('refinery.confirmOverwrite'), {
            kind: 'warning',
            title: t('refinery.confirmOverwriteTitle'),
          })
          if (!ok) return
          await invokeTauri('write_text_file', {
            path: dest,
            content: exportSkillOptimizedFinal,
            overwrite: true,
          })
        } else {
          throw err
        }
      }

      toast.success(t('refinery.savedTo', { dest }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [
    exportSkillOptimizedFinal,
    exportSkillPendingDiffs,
    invokeTauri,
    isTauri,
    t,
  ])

  const onSubmitExportWorkRule = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }

    if (exportMode !== 'fusion') {
      toast.error(t('refinery.fusionOnly'))
      return
    }

    if (!exportResult.trim()) {
      toast.error(t('refinery.fusionNotReady'))
      return
    }

    const name = exportName.trim()
    if (!name) {
      toast.error(t('refinery.exportMissingName'))
      return
    }

    const tags = exportTags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const scoreRaw = exportScore.trim()
    let score: number | null = null
    if (scoreRaw) {
      const v = Number(scoreRaw)
      if (!Number.isFinite(v)) {
        toast.error(t('workRules.invalidScore'))
        return
      }
      score = v
    }

    setExportLoading(true)
    try {
      await invokeTauri('create_work_rule', {
        name,
        entryFile: exportEntryFile.trim() || 'AGENTS.md',
        content: exportResult,
        tags,
        score,
        description: exportDescription.trim() ? exportDescription.trim() : null,
      })
      toast.success(t('workRules.created'))
      setShowExportWorkRule(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExportLoading(false)
    }
  }, [
    exportDescription,
    exportEntryFile,
    exportName,
    exportMode,
    exportResult,
    exportScore,
    exportTags,
    invokeTauri,
    isTauri,
    t,
  ])

  const onSubmitExportSkill = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }

    if (exportSkillMode !== 'fusion') {
      toast.error(t('refinery.fusionOnly'))
      return
    }

    const name = exportSkillName.trim()
    if (!name) {
      toast.error(t('refinery.exportMissingSkillName'))
      return
    }

    if (!exportSkillResult.trim()) {
      toast.error(t('refinery.fusionNotReady'))
      return
    }

    setExportSkillLoading(true)
    try {
      const dest = await invokeTauri<string>('export_refinery_skill', {
        name,
        skillMd: ensureSkillFrontmatter(exportSkillResult, name),
        overwrite: exportSkillOverwrite,
      })
      toast.success(t('refinery.skillExported', { dest }))
      setShowExportSkill(false)
      void loadCodexSkills()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExportSkillLoading(false)
    }
  }, [
    ensureSkillFrontmatter,
    exportSkillName,
    exportSkillMode,
    exportSkillOverwrite,
    exportSkillResult,
    invokeTauri,
    isTauri,
    loadCodexSkills,
    t,
  ])

  const removeLocalSource = useCallback(
    (kind: LocalSource['kind'], path: string) => {
      setLocalSources((prev) => prev.filter((s) => !(s.kind === kind && s.path === path)))
      setSelected((prev) => {
        if (!prev) return prev
        if (kind === 'file' && prev.kind === 'local_file' && prev.path === path) return null
        if (kind === 'dir' && prev.kind === 'local_dir' && prev.path === path) return null
        return prev
      })
      setSnapshot((prev) => {
        if (kind === 'dir' && selected?.kind === 'local_dir' && selected.path === path) return null
        return prev
      })
      setFilePreview((prev) => {
        if (kind === 'file' && selected?.kind === 'local_file' && selected.path === path) return null
        return prev
      })
    },
    [selected],
  )

  if (!isTauri) {
    return (
      <div className="analytics-page">
        <div className="analytics-card">
          <div className="analytics-card-title">{t('refinery.title')}</div>
          <div className="analytics-error">{t('errors.notTauri')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="analytics-page">
        <div className="analytics-grid">
        <div className="analytics-card">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <div className="refinery-sources-toolbar">
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('refinery.searchPlaceholder')}
                aria-label={t('refinery.search')}
              />
              <button
                className="icon-btn"
                type="button"
                onClick={() => {
                  void loadManagedSkills()
                  void loadCodexSkills()
                }}
                disabled={skillsLoading || codexSkillsLoading}
                title={t('refinery.refresh')}
                aria-label={t('refinery.refresh')}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </button>
              <div className="refinery-import" ref={importMenuRef}>
                <button
                  className="icon-btn"
                  type="button"
                  onClick={() => setShowImportMenu((v) => !v)}
                  disabled={skillsLoading}
                  title={t('refinery.import')}
                  aria-label={t('refinery.import')}
                  aria-haspopup="menu"
                  aria-expanded={showImportMenu}
                >
                  <FileUp size={16} aria-hidden="true" />
                </button>
                {showImportMenu ? (
                  <div className="refinery-import-menu" role="menu">
                    <button
                      className="refinery-import-item"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowImportMenu(false)
                        void importLocalFiles()
                      }}
                    >
                      <FileUp size={16} aria-hidden="true" />
                      {t('refinery.importFiles')}
                    </button>
                    <button
                      className="refinery-import-item"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowImportMenu(false)
                        void importLocalDir()
                      }}
                    >
                      <FolderOpen size={16} aria-hidden="true" />
                      {t('refinery.importDir')}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            {localSources.length ? (
              <div className="analytics-note" style={{ marginTop: 0 }}>
                <div className="analytics-note-title">{t('refinery.localSourcesTitle')}</div>
                {filteredLocalSources.length === 0 ? (
                  <div className="analytics-empty">{t('refinery.noMatches')}</div>
                ) : (
                  <div className="analytics-table" role="table">
                    <div className="analytics-row analytics-row-head refinery-local-row" role="row">
                      <div className="analytics-cell" role="columnheader">
                        {t('refinery.colName')}
                      </div>
                    </div>
                    {filteredLocalSources.map((src) => (
                      <div
                        key={`${src.kind}:${src.path}`}
                        className={`analytics-row analytics-row-body refinery-local-row${
                          (src.kind === 'file' &&
                            selected?.kind === 'local_file' &&
                            selected.path === src.path) ||
                          (src.kind === 'dir' &&
                            selected?.kind === 'local_dir' &&
                            selected.path === src.path)
                            ? ' selected'
                            : ''
                        }`}
                        role="row"
                        onClick={() =>
                          src.kind === 'file'
                            ? void onSelectLocalFile(src.path)
                            : void onSelectLocalDir(src.path)
                        }
                        onDoubleClick={() => {
                          if (src.kind === 'file') {
                            addToSession(src.label, { kind: 'local_file', path: src.path }, false)
                            return
                          }
                          const codexSkill = codexSkills.find((s) => s.path === src.path)
                          addToSession(
                            src.label,
                            { kind: 'local_dir', path: src.path },
                            codexSkill?.is_system ?? false,
                          )
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="analytics-cell analytics-skill-cell" role="cell">
                          <div className="analytics-skill-name">{src.label}</div>
                          <div className="analytics-skill-id">
                            {src.kind === 'file' ? t('refinery.localFile') : t('refinery.localDir')}
                            {' · '}
                            {src.path}
                          </div>
                        </div>
                        <div className="analytics-cell" role="cell" style={{ textAlign: 'right' }}>
                          <button
                            className="icon-btn"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              removeLocalSource(src.kind, src.path)
                            }}
                            title={t('remove')}
                            aria-label={t('remove')}
                          >
                            <X size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="analytics-note">
              <div className="refinery-note-header">
                <div className="analytics-note-title" style={{ marginBottom: 0 }}>
                  {t('refinery.installedTitle')}
                </div>
                <div className="refinery-note-actions">
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => setCodexInstalledCollapsed((v) => !v)}
                    title={
                      codexInstalledCollapsed
                        ? t('refinery.expand')
                        : t('refinery.collapse')
                    }
                    aria-label={
                      codexInstalledCollapsed
                        ? t('refinery.expand')
                        : t('refinery.collapse')
                    }
                  >
                    {codexInstalledCollapsed ? (
                      <ChevronRight size={16} aria-hidden="true" />
                    ) : (
                      <ChevronDown size={16} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {codexInstalledCollapsed ? null : codexSkillsLoading ? (
                <div className="analytics-empty">{t('analytics.loading')}</div>
              ) : codexSkillsError ? (
                <div className="analytics-error">{codexSkillsError}</div>
              ) : filteredCodexSkills.length === 0 ? (
                <div className="analytics-empty">{t('refinery.installedEmpty')}</div>
              ) : (
                <>
                  <div className="analytics-table" role="table">
                    <div className="analytics-row analytics-row-head refinery-managed-row" role="row">
                      <div className="analytics-cell" role="columnheader">
                        {t('refinery.colName')}
                      </div>
                    </div>
                    {pagedCodexSkills.map((skill) => (
                      <div
                        key={`${skill.is_system ? 'system' : 'user'}:${skill.path}`}
                        className={`analytics-row analytics-row-body refinery-managed-row${
                          selected?.kind === 'local_dir' && selected.path === skill.path ? ' selected' : ''
                        }`}
                        role="row"
                        onClick={() => void onSelectLocalDir(skill.path)}
                        onDoubleClick={() =>
                          addToSession(
                            skill.name,
                            { kind: 'local_dir', path: skill.path },
                            skill.is_system,
                          )
                        }
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="analytics-cell analytics-skill-cell" role="cell">
                          <div className="analytics-skill-name">
                            {skill.name}
                            {skill.is_system ? (
                              <span className="analytics-badge">{t('analytics.badgeSystem')}</span>
                            ) : null}
                          </div>
                          <div className="analytics-skill-id">{skill.path}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {filteredCodexSkills.length > CODEX_INSTALLED_PAGE_SIZE ? (
                    <div className="refinery-pagination">
                      <button
                        className="icon-btn"
                        type="button"
                        onClick={() => setCodexInstalledPage((p) => Math.max(1, p - 1))}
                        disabled={codexInstalledPage <= 1}
                        title={t('refinery.prevPage')}
                        aria-label={t('refinery.prevPage')}
                      >
                        <ChevronLeft size={16} aria-hidden="true" />
                      </button>
                      <div className="refinery-pagination-label">
                        {codexInstalledPage} / {codexInstalledPages}
                      </div>
                      <button
                        className="icon-btn"
                        type="button"
                        onClick={() =>
                          setCodexInstalledPage((p) => Math.min(codexInstalledPages, p + 1))
                        }
                        disabled={codexInstalledPage >= codexInstalledPages}
                        title={t('refinery.nextPage')}
                        aria-label={t('refinery.nextPage')}
                      >
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="refinery-managed-section">
              {skillsLoading || codexSkillsLoading ? (
                <div className="analytics-empty">{t('analytics.loading')}</div>
              ) : skillsError ? (
                <div className="analytics-error">{skillsError}</div>
              ) : skills.length === 0 ? null : filteredSkills.length === 0 ? (
                <div className="analytics-empty">{t('refinery.noMatches')}</div>
              ) : (
                <div className="analytics-table" role="table">
                  <div className="analytics-row analytics-row-head refinery-managed-row" role="row">
                    <div className="analytics-cell" role="columnheader">
                      {t('refinery.colName')}
                    </div>
                  </div>
                  {filteredSkills.map((skill) => (
                    <div
                      key={skill.id}
                      className={`analytics-row analytics-row-body refinery-managed-row${
                        selected?.kind === 'managed' && selected.id === skill.id ? ' selected' : ''
                      }`}
                      role="row"
                      onClick={() => void onSelectSkill(skill)}
                      onDoubleClick={() =>
                        addToSession(skill.name, { kind: 'managed', id: skill.id }, false)
                      }
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="analytics-cell analytics-skill-cell" role="cell">
                        <div className="analytics-skill-name">{skill.name}</div>
                        <div className="analytics-skill-id">{skill.source_type}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="refinery-right-column">
          <div className="analytics-card">
            <div className="refinery-card-header">
              <div className="analytics-card-title">{t('refinery.sessionTitle')}</div>
              <div className="refinery-card-actions">
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => void openExportWorkRule()}
                  disabled={exportLoading || exportSkillLoading}
                >
                  {t('refinery.exportWorkRule')}
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void openExportSkill()}
                  disabled={exportLoading || exportSkillLoading}
                >
                  {t('refinery.exportSkill')}
                </button>
              </div>
            </div>
            {session.length === 0 ? (
              <div className="analytics-empty">{t('refinery.sessionEmptyHint')}</div>
            ) : (
              <div className="refinery-session-list">
                {session.map((item, idx) => (
                  <div
                    key={item.key}
                    className="refinery-session-row"
                    onClick={() => void selectSessionItem(item)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="refinery-session-main">
                      <div className="analytics-skill-name">
                        {item.label}
                        {item.badgeSystem ? (
                          <span className="analytics-badge">{t('analytics.badgeSystem')}</span>
                        ) : null}
                      </div>
                      <div className="analytics-skill-id">
                        {item.source.kind === 'managed'
                          ? item.source.id
                          : item.source.path}
                      </div>
                      <input
                        className="input input-sm"
                        value={item.note}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateSessionNote(item.key, e.target.value)}
                        placeholder={t('refinery.notePlaceholder')}
                      />
                    </div>
                    <div className="refinery-session-actions">
                      <button
                        className="icon-btn"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          moveSessionItem(idx, -1)
                        }}
                        disabled={idx === 0}
                        title={t('moveUp')}
                        aria-label={t('moveUp')}
                      >
                        <ArrowUp size={16} aria-hidden="true" />
                      </button>
                      <button
                        className="icon-btn"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          moveSessionItem(idx, 1)
                        }}
                        disabled={idx === session.length - 1}
                        title={t('moveDown')}
                        aria-label={t('moveDown')}
                      >
                        <ArrowDown size={16} aria-hidden="true" />
                      </button>
                      <button
                        className="icon-btn"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeSessionItem(item.key)
                        }}
                        title={t('remove')}
                        aria-label={t('remove')}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="analytics-card">
            <div className="refinery-card-header">
              <div className="analytics-card-title">{t('refinery.previewTitle')}</div>
              <div className="refinery-card-actions">
                <button
                  className="icon-btn"
                  type="button"
                  onClick={addSelectedToSession}
                  disabled={!selected || session.some((s) => s.key === sessionKeyForSource(selected))}
                  title={t('refinery.addToSession')}
                  aria-label={t('refinery.addToSession')}
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            {loading ? <div className="analytics-empty">{t('analytics.loading')}</div> : null}
            {error ? <div className="analytics-error">{error}</div> : null}
            {!loading && !error && !snapshot && !filePreview ? (
              <div className="analytics-empty">{t('refinery.pickOne')}</div>
            ) : null}
            {filePreview ? (
              <>
                <div className="analytics-note" style={{ marginTop: 0 }}>
                  <div className="analytics-note-title">{t('refinery.filePath')}</div>
                  <div className="analytics-skill-id">{filePreview.path}</div>
                </div>
                <div className="analytics-note">
                  <div className="analytics-note-title">{t('refinery.filePreviewTitle')}</div>
                  <div className="markdown-preview">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {filePreview.content.trim()
                        ? filePreview.content
                        : t('workRules.previewEmpty')}
                    </ReactMarkdown>
                  </div>
                </div>
              </>
            ) : null}
            {snapshot ? (
              <>
                <div className="analytics-note" style={{ marginTop: 0 }}>
                  <div className="analytics-note-title">{t('refinery.snapshotRoot')}</div>
                  <div className="analytics-skill-id">{snapshot.root}</div>
                </div>

                {snapshot.truncated ? (
                  <div className="analytics-note">
                    <div className="analytics-note-title">{t('refinery.truncatedTitle')}</div>
                    <div className="analytics-skill-id">
                      {snapshot.truncated_reason ?? t('refinery.truncatedDefault')}
                    </div>
                  </div>
                ) : null}

                <div className="analytics-note">
                  <div className="analytics-note-title">{t('refinery.skillMdTitle')}</div>
                  {snapshot.skill_md_error ? (
                    <div className="analytics-error">{snapshot.skill_md_error}</div>
                  ) : snapshot.skill_md ? (
                    <div className="markdown-preview">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {snapshot.skill_md}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="analytics-empty">{t('refinery.noSkillMd')}</div>
                  )}
                </div>

                <div className="analytics-note">
                  <div className="analytics-note-title">
                    {t('refinery.filesTitle', { count: snapshot.files.length })}
                  </div>
                  <div className="markdown-preview" style={{ fontFamily: 'var(--font-mono)' }}>
                    {snapshot.files.map((f) => f.rel_path).join('\n')}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {showExportWorkRule ? (
        <div className="modal-backdrop" onClick={() => (exportLoading ? null : closeExportWorkRule())}>
          <div className="modal modal-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{t('refinery.exportWorkRule')}</div>
              <button
                className="modal-close"
                type="button"
                onClick={closeExportWorkRule}
                aria-label={t('close')}
                disabled={exportLoading}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="tabs" style={{ marginTop: 0 }}>
                <button
                  className={`tab-item${exportMode === 'fusion' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setExportMode('fusion')}
                  disabled={exportLoading}
                >
                  {t('refinery.modeFusion')}
                </button>
                <button
                  className={`tab-item${exportMode === 'analysis' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setExportMode('analysis')}
                  disabled={exportLoading}
                >
                  {t('refinery.modeAnalysis')}
                </button>
              </div>

	              {exportMode === 'analysis' ? (
	                <>
	                  <div className="refinery-analysis-toolbar">
	                    <div className="form-group" style={{ marginBottom: 0, maxWidth: 360 }}>
	                      <label className="label">{t('refinery.agent')}</label>
	                      <select
	                        className="input"
	                        value={exportAgentId}
	                        onChange={(e) => setExportAgentId(e.target.value)}
	                        disabled={exportLoading || llmAgentsLoading}
	                      >
	                        <option value="">{t('refinery.pickAgent')}</option>
	                        {llmAgents.map((a) => (
	                          <option key={a.id} value={a.id}>
	                            {a.name}
	                          </option>
	                        ))}
	                      </select>
	                      {llmAgentsLoading ? (
	                        <div className="helper-text">{t('analytics.loading')}</div>
	                      ) : llmAgentsError ? (
	                        <div className="helper-text">{llmAgentsError}</div>
	                      ) : llmAgents.length === 0 ? (
	                        <div className="helper-text">{t('refinery.noAgents')}</div>
	                      ) : null}
	                    </div>
	                  </div>

	                  {exportOptimized.trim() && exportPendingDiffs > 0 ? (
	                    <div className="refinery-diff-pane">
	                      <div className="refinery-diff-title-row">
	                        <div className="refinery-diff-title">{t('refinery.diffOptimized')}</div>
	                        <button
	                          className="btn btn-secondary btn-sm"
	                          type="button"
	                          onClick={() => {
	                            setExportOptimized('')
	                            setExportDiffHunks([])
	                          }}
	                          disabled={exportLoading}
	                        >
	                          {t('refinery.backToAnalysis')}
	                        </button>
	                      </div>
	                      <div className="refinery-monaco-diff-stack">
	                        <div className="refinery-monaco-editor">
	                          <MonacoDiffEditor
	                            original={exportContent}
	                            modified={exportOptimizedCandidate}
	                            language="markdown"
	                            height="min(60vh, 520px)"
	                            className="monaco-diff-root"
	                            onMount={(editor, monaco) => {
	                              cleanupWorkRuleDiffMouse()
	                              workRuleDiffEditorRef.current = editor as MonacoStandaloneDiffEditorWithHost
	                              exportDiffMonacoRef.current = monaco as MonacoApi

	                              const ed = workRuleDiffEditorRef.current
	                              const original = ed.getOriginalEditor()
	                              const modified = ed.getModifiedEditor()
	                              const attach = (side: MonacoStandaloneEditor) => {
	                                const disp = side.onMouseDown?.((e) => {
	                                  const line = e.target.position?.lineNumber
	                                  if (line) selectWorkRuleHunkByLine(line)
	                                })
	                                if (disp) exportDiffMouseDisposablesRef.current.push(disp)
	                              }
	                              attach(original)
	                              attach(modified)

	                              if (exportActiveHunk) revealWorkRuleHunk(exportActiveHunk)
	                            }}
	                          />
	                        </div>
		                        {exportActiveHunk ? (
		                          <div className="refinery-diff-pane refinery-diff-controls">
		                            <div className="refinery-diff-navigator">
		                              <div className="helper-text">
		                                {t('refinery.diffRemaining', { count: exportPendingDiffs })}{' '}
	                                {exportActiveHunkIndex >= 0
	                                  ? t('refinery.diffCurrent', {
	                                      line: exportActiveHunk.oldStart + 1,
	                                      current: exportActiveHunkIndex + 1,
	                                      total: exportPendingHunks.length,
	                                    })
	                                  : null}
	                              </div>
	                              <div className="refinery-diff-nav-actions">
	                                <button
	                                  className="btn btn-secondary btn-sm"
	                                  type="button"
	                                  onClick={() => navWorkRuleDiff(-1)}
	                                  disabled={exportPendingHunks[0]?.id === exportActiveHunk.id}
	                                >
	                                  {t('refinery.diffPrev')}
	                                </button>
	                                <button
	                                  className="btn btn-secondary btn-sm"
	                                  type="button"
	                                  onClick={() => navWorkRuleDiff(1)}
	                                  disabled={
	                                    exportPendingHunks[exportPendingHunks.length - 1]?.id === exportActiveHunk.id
	                                  }
	                                >
	                                  {t('refinery.diffNext')}
	                                </button>
	                                <button
	                                  className="btn btn-secondary btn-sm"
	                                  type="button"
	                                  onClick={() => decideActiveWorkRuleDiff('reject')}
	                                >
	                                  {t('refinery.diffReject')}
	                                </button>
	                                <button
	                                  className="btn btn-primary btn-sm"
	                                  type="button"
	                                  onClick={() => decideActiveWorkRuleDiff('accept')}
	                                >
	                                  {t('refinery.diffAccept')}
	                                </button>
	                              </div>
	                            </div>
	                          </div>
	                        ) : null}
	                      </div>
	                    </div>
	                  ) : (
	                    <div className="refinery-diff-grid">
	                      <div className="refinery-diff-pane">
	                        <div className="refinery-diff-title">{t('refinery.diffSource')}</div>
	                        {exportLoading ? (
	                          <div className="analytics-empty">{t('analytics.loading')}</div>
	                        ) : (
	                          <div className="markdown-preview">
	                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
	                              {exportContent.trim() ? exportContent : t('workRules.previewEmpty')}
	                            </ReactMarkdown>
	                          </div>
	                        )}
	                      </div>
	                      <div className="refinery-diff-pane">
	                        <div className="refinery-diff-title-row">
	                          <div className="refinery-diff-title">
	                            {exportOptimized.trim()
	                              ? t('refinery.diffOptimized')
	                              : t('refinery.diffAnalysis')}
	                          </div>
	                          {exportOptimized.trim() ? (
	                            <button
	                              className="btn btn-secondary btn-sm"
	                              type="button"
	                              onClick={() => {
	                                setExportOptimized('')
	                                setExportDiffHunks([])
	                              }}
	                              disabled={exportLoading}
	                            >
	                              {t('refinery.backToAnalysis')}
	                            </button>
	                          ) : (
	                            <div className="refinery-review-actions">
	                              <div className="refinery-review-popover-anchor">
	                                <button
	                                  ref={exportReviewButtonRef}
	                                  className="btn btn-secondary btn-sm"
	                                  type="button"
	                                  onClick={() => setExportReviewOpen((v) => !v)}
	                                  disabled={exportLoading}
	                                >
	                                  {t('refinery.review')} · {exportReviewCount}
	                                </button>
	                                {exportReviewOpen ? (
	                                  <div className="refinery-review-popover" ref={exportReviewPopoverRef}>
	                                    <div className="refinery-review-title">{t('refinery.reviewTitle')}</div>
	                                    <div className="refinery-review-row">
	                                      <textarea
	                                        className="input refinery-review-textarea"
	                                        rows={2}
	                                        value={exportReviewMessage}
	                                        onChange={(e) => setExportReviewMessage(e.target.value)}
	                                        placeholder={t('refinery.reviewPlaceholder')}
	                                      />
	                                      <button
	                                        className="btn btn-primary btn-sm"
	                                        type="button"
	                                        onClick={() => setExportReviewOpen(false)}
	                                      >
	                                        {t('refinery.reviewSubmit')}
	                                      </button>
	                                    </div>
	                                    <details className="refinery-review-details">
	                                      <summary className="refinery-review-summary">
	                                        {t('refinery.reviewLineComments', { count: exportLineComments.length })}
	                                      </summary>
	                                      {exportReviewGroups.length === 0 ? (
	                                        <div className="helper-text">{t('refinery.reviewNoLineComments')}</div>
	                                      ) : (
	                                        <div className="refinery-review-list">
	                                          {exportReviewGroups.map((g) => (
	                                              <div
	                                                key={`line-${g.line}`}
	                                                className="refinery-review-item"
	                                                role="button"
	                                                tabIndex={0}
	                                                onClick={() => openWorkRuleLineComment(g.line)}
	                                                onKeyDown={(e) => {
	                                                  if (e.key === 'Enter' || e.key === ' ') openWorkRuleLineComment(g.line)
	                                                }}
	                                              >
	                                                <div className="refinery-review-item-main">
	                                                  <div className="refinery-review-item-title">
	                                                    L{g.line}
	                                                    <span className="refinery-review-badge">{g.count}</span>
	                                                  </div>
	                                                  <div className="refinery-review-item-body">
	                                                    {g.preview}
	                                                  </div>
	                                                </div>
	                                              </div>
	                                          ))}
	                                        </div>
	                                      )}
	                                    </details>
	                                  </div>
	                                ) : null}
	                              </div>
	                              <button
	                                className="btn btn-primary btn-sm"
	                                type="button"
	                                onClick={() => void runWorkRuleOptimize()}
	                                disabled={exportLoading || !exportAnalysis.trim()}
	                              >
	                                {t('refinery.proceed')} · {exportReviewCount}
	                              </button>
	                            </div>
	                          )}
	                        </div>
	                        {exportLoading ? (
	                          <div className="analytics-empty">{t('analytics.loading')}</div>
	                        ) : exportOptimized.trim() ? (
	                          <div className="markdown-preview">
	                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
	                              {exportOptimizedFinal.trim()
	                                ? exportOptimizedFinal
	                                : t('refinery.optimizeEmpty')}
	                            </ReactMarkdown>
	                          </div>
	                        ) : (
	                          <div className="refinery-analysis-editor-wrap" ref={exportAnalysisWrapRef}>
	                            <div className="markdown-preview markdown-line-review">
	                              <ReactMarkdown
	                                remarkPlugins={[remarkGfm]}
	                                components={exportAnalysisMarkdownComponents}
	                              >
	                                {exportAnalysis.trim() ? exportAnalysis : t('refinery.analysisEmpty')}
	                              </ReactMarkdown>
	                            </div>
	                            {exportCommentLine ? (
	                              <div className="refinery-line-comment-card" style={{ top: exportCommentCardTop }}>
	                                <div className="refinery-line-comment-header">
	                                  <div className="refinery-line-comment-title">
	                                    {t('refinery.commentOnLine', { line: exportCommentLine })}
	                                  </div>
	                                  <button
	                                    className="icon-btn"
	                                    type="button"
	                                    onClick={() => {
	                                      setExportCommentLine(null)
	                                      setExportCommentComposerOpen(false)
	                                      setExportCommentDraft('')
	                                      setExportEditingCommentId(null)
	                                    }}
	                                    aria-label={t('close')}
	                                  >
	                                    <X size={16} />
	                                  </button>
	                                </div>
	                                {exportActiveLineComments.length === 0 ? (
	                                  <div className="helper-text">{t('refinery.reviewNoLineComments')}</div>
	                                ) : (
	                                  <div className="refinery-line-comment-list">
	                                    {exportActiveLineComments.map((c) => (
	                                      <div key={c.id} className="refinery-line-comment-item">
	                                        <div className="refinery-line-comment-text">{c.body}</div>
	                                        <div className="refinery-line-comment-item-actions">
	                                          <button
	                                            className="btn btn-secondary btn-sm btn-icon"
	                                            type="button"
	                                            onClick={() => startEditWorkRuleLineComment(c)}
	                                            title={t('refinery.commentEdit')}
	                                            aria-label={t('refinery.commentEdit')}
	                                          >
	                                            <Pencil size={14} />
	                                          </button>
	                                          <button
	                                            className="btn btn-danger btn-sm btn-icon"
	                                            type="button"
	                                            onClick={() => deleteWorkRuleLineComment(c.id)}
	                                            title={t('refinery.commentDelete')}
	                                            aria-label={t('refinery.commentDelete')}
	                                          >
	                                            <Trash2 size={14} />
	                                          </button>
	                                        </div>
	                                      </div>
	                                    ))}
	                                  </div>
	                                )}

	                                {!exportCommentComposerOpen ? (
	                                  <button
	                                    className="btn btn-secondary btn-sm"
	                                    type="button"
	                                    onClick={() => {
	                                      setExportCommentComposerOpen(true)
	                                      setExportCommentDraft('')
	                                      setExportEditingCommentId(null)
	                                    }}
	                                  >
	                                    {t('refinery.addLineComment')}
	                                  </button>
	                                ) : null}

	                                {exportCommentComposerOpen ? (
	                                  <>
	                                    <textarea
	                                      className="input"
	                                      rows={3}
	                                      value={exportCommentDraft}
	                                      onChange={(e) => setExportCommentDraft(e.target.value)}
	                                      placeholder={t('refinery.commentPlaceholder')}
	                                    />
	                                    <div className="refinery-line-comment-actions">
	                                      <button
	                                        className="btn btn-primary btn-sm"
	                                        type="button"
	                                        onClick={submitWorkRuleLineComment}
	                                      >
	                                        {exportEditingCommentId
	                                          ? t('refinery.commentUpdate')
	                                          : t('refinery.commentSave')}
	                                      </button>
	                                      <button
	                                        className="btn btn-secondary btn-sm"
	                                        type="button"
	                                        onClick={() => {
	                                          setExportCommentComposerOpen(false)
	                                          setExportCommentDraft('')
	                                          setExportEditingCommentId(null)
	                                        }}
	                                      >
	                                        {t('cancel')}
	                                      </button>
	                                    </div>
	                                  </>
	                                ) : null}
	                              </div>
	                            ) : null}
	                          </div>
	                        )}
	                      </div>
	                    </div>
	                  )}
	                </>
	              ) : (
	                <div className="work-rules-editor-grid">
	                  <div className="work-rules-editor-left">
	                    <div className="form-group">
	                      <label className="label">{t('workRules.name')}</label>
	                      <input
	                        className="input"
	                        value={exportName}
	                        onChange={(e) => setExportName(e.target.value)}
	                        placeholder="my-work-rules"
	                      />
	                    </div>
	                    <div className="form-group">
	                      <label className="label">{t('workRules.entryFile')}</label>
	                      <input
	                        className="input"
	                        value={exportEntryFile}
	                        onChange={(e) => setExportEntryFile(e.target.value)}
	                      />
	                    </div>
	                    <div className="form-group">
	                      <label className="label">{t('workRules.tags')}</label>
	                      <input
	                        className="input"
	                        value={exportTags}
	                        onChange={(e) => setExportTags(e.target.value)}
	                        placeholder="refinery"
	                      />
	                    </div>
	                    <div className="form-group">
	                      <label className="label">{t('workRules.score')}</label>
	                      <input
	                        className="input"
	                        value={exportScore}
	                        onChange={(e) => setExportScore(e.target.value)}
	                        placeholder="10"
	                      />
	                    </div>
	                    <div className="form-group">
	                      <label className="label">{t('workRules.description')}</label>
	                      <input
	                        className="input"
	                        value={exportDescription}
	                        onChange={(e) => setExportDescription(e.target.value)}
	                        placeholder={t('workRules.descriptionPlaceholder')}
	                      />
	                    </div>

	                    <div className="form-group">
	                      <label className="label">{t('refinery.agent')}</label>
	                      <select
	                        className="input"
	                        value={exportAgentId}
	                        onChange={(e) => setExportAgentId(e.target.value)}
	                        disabled={exportLoading || llmAgentsLoading}
	                      >
	                        <option value="">{t('refinery.pickAgent')}</option>
	                        {llmAgents.map((a) => (
	                          <option key={a.id} value={a.id}>
	                            {a.name}
	                          </option>
	                        ))}
	                      </select>
	                      {llmAgentsLoading ? (
	                        <div className="helper-text">{t('analytics.loading')}</div>
	                      ) : llmAgentsError ? (
	                        <div className="helper-text">{llmAgentsError}</div>
	                      ) : llmAgents.length === 0 ? (
	                        <div className="helper-text">{t('refinery.noAgents')}</div>
	                      ) : null}
	                    </div>
	                  </div>

	                  <div className="work-rules-editor-right">
	                    <div className="refinery-diff-grid">
	                      <div className="refinery-diff-pane">
	                        <div className="refinery-diff-title">{t('refinery.diffSource')}</div>
	                        {exportLoading ? (
	                          <div className="analytics-empty">{t('analytics.loading')}</div>
	                        ) : (
	                          <div className="markdown-preview">
	                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
	                              {exportContent.trim() ? exportContent : t('workRules.previewEmpty')}
	                            </ReactMarkdown>
	                          </div>
	                        )}
	                      </div>
	                      <div className="refinery-diff-pane">
	                        <div className="refinery-diff-title">{t('refinery.diffFused')}</div>
	                        <div className="tabs" style={{ marginTop: 0 }}>
	                          <button
	                            className={`tab-item${exportContentTab === 'edit' ? ' active' : ''}`}
	                            type="button"
	                            onClick={() => setExportContentTab('edit')}
	                            disabled={exportLoading}
	                          >
	                            {t('workRules.contentEditTab')}
	                          </button>
	                          <button
	                            className={`tab-item${exportContentTab === 'preview' ? ' active' : ''}`}
	                            type="button"
	                            onClick={() => setExportContentTab('preview')}
	                            disabled={exportLoading}
	                          >
	                            {t('workRules.contentPreviewTab')}
	                          </button>
	                        </div>
	                        {exportLoading ? (
	                          <div className="analytics-empty">{t('analytics.loading')}</div>
	                        ) : exportContentTab === 'edit' ? (
	                          <textarea
	                            className="input"
	                            value={exportResult}
	                            onChange={(e) => setExportResult(e.target.value)}
	                            rows={16}
	                          />
	                        ) : (
	                          <div className="markdown-preview">
	                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
	                              {exportResult.trim() ? exportResult : t('refinery.resultEmpty')}
	                            </ReactMarkdown>
	                          </div>
	                        )}
	                      </div>
	                    </div>
	                  </div>
	                </div>
	              )}
	              <div className="modal-footer">
	                <button
	                  className="btn btn-secondary"
	                  type="button"
	                  onClick={() => void runWorkRuleLlm()}
	                  disabled={exportLoading}
	                >
	                  {exportMode === 'fusion' ? t('refinery.runFusion') : t('refinery.runAnalysis')}
	                </button>
	                {exportMode === 'analysis' && exportOptimizedFinal.trim() && exportPendingDiffs === 0 ? (
	                  <button
	                    className="btn btn-primary"
	                    type="button"
	                    onClick={() => void saveWorkRuleOptimized()}
	                    disabled={exportLoading}
	                  >
	                    {t('refinery.saveOptimized')}
	                  </button>
	                ) : null}
	                <button
	                  className="btn btn-secondary"
	                  type="button"
	                  onClick={closeExportWorkRule}
	                  disabled={exportLoading}
	                >
	                  {t('cancel')}
	                </button>
                {exportMode === 'fusion' ? (
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void onSubmitExportWorkRule()}
                    disabled={exportLoading}
                  >
                    {t('workRules.create')}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showExportSkill ? (
        <div className="modal-backdrop" onClick={() => (exportSkillLoading ? null : closeExportSkill())}>
          <div className="modal modal-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{t('refinery.exportSkill')}</div>
              <button
                className="modal-close"
                type="button"
                onClick={closeExportSkill}
                aria-label={t('close')}
                disabled={exportSkillLoading}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="tabs" style={{ marginTop: 0 }}>
                <button
                  className={`tab-item${exportSkillMode === 'fusion' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setExportSkillMode('fusion')}
                  disabled={exportSkillLoading}
                >
                  {t('refinery.modeFusion')}
                </button>
                <button
                  className={`tab-item${exportSkillMode === 'analysis' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setExportSkillMode('analysis')}
                  disabled={exportSkillLoading}
                >
                  {t('refinery.modeAnalysis')}
                </button>
              </div>
	              {exportSkillMode === 'analysis' ? (
	                <>
	                  <div className="refinery-analysis-toolbar">
	                    <div className="form-group" style={{ marginBottom: 0, maxWidth: 360 }}>
	                      <label className="label">{t('refinery.agent')}</label>
	                      <select
	                        className="input"
	                        value={exportSkillAgentId}
	                        onChange={(e) => setExportSkillAgentId(e.target.value)}
	                        disabled={exportSkillLoading || llmAgentsLoading}
	                      >
	                        <option value="">{t('refinery.pickAgent')}</option>
	                        {llmAgents.map((a) => (
	                          <option key={a.id} value={a.id}>
	                            {a.name}
	                          </option>
	                        ))}
	                      </select>
	                      {llmAgentsLoading ? (
	                        <div className="helper-text">{t('analytics.loading')}</div>
	                      ) : llmAgentsError ? (
	                        <div className="helper-text">{llmAgentsError}</div>
	                      ) : llmAgents.length === 0 ? (
	                        <div className="helper-text">{t('refinery.noAgents')}</div>
	                      ) : null}
	                    </div>
	                  </div>

	                  {exportSkillOptimized.trim() && exportSkillPendingDiffs > 0 ? (
	                    <div className="refinery-diff-pane">
	                      <div className="refinery-diff-title-row">
	                        <div className="refinery-diff-title">{t('refinery.diffOptimized')}</div>
	                        <button
	                          className="btn btn-secondary btn-sm"
	                          type="button"
	                          onClick={() => {
	                            setExportSkillOptimized('')
	                            setExportSkillDiffHunks([])
	                          }}
	                          disabled={exportSkillLoading}
	                        >
	                          {t('refinery.backToAnalysis')}
	                        </button>
	                      </div>
	                      <div className="refinery-monaco-diff-stack">
	                        <div className="refinery-monaco-editor">
	                          <MonacoDiffEditor
	                            original={exportSkillContent}
	                            modified={exportSkillOptimizedCandidate}
	                            language="markdown"
	                            height="min(60vh, 520px)"
	                            className="monaco-diff-root"
	                            onMount={(editor, monaco) => {
	                              cleanupSkillDiffMouse()
	                              skillDiffEditorRef.current = editor as MonacoStandaloneDiffEditorWithHost
	                              exportSkillDiffMonacoRef.current = monaco as MonacoApi

	                              const ed = skillDiffEditorRef.current
	                              const original = ed.getOriginalEditor()
	                              const modified = ed.getModifiedEditor()
	                              const attach = (side: MonacoStandaloneEditor) => {
	                                const disp = side.onMouseDown?.((e) => {
	                                  const line = e.target.position?.lineNumber
	                                  if (line) selectSkillHunkByLine(line)
	                                })
	                                if (disp) exportSkillDiffMouseDisposablesRef.current.push(disp)
	                              }
	                              attach(original)
	                              attach(modified)

	                              if (exportSkillActiveHunk) revealSkillHunk(exportSkillActiveHunk)
	                            }}
	                          />
	                        </div>
		                        {exportSkillActiveHunk ? (
		                          <div className="refinery-diff-pane refinery-diff-controls">
		                            <div className="refinery-diff-navigator">
		                              <div className="helper-text">
		                                {t('refinery.diffRemaining', { count: exportSkillPendingDiffs })}{' '}
	                                {exportSkillActiveHunkIndex >= 0
	                                  ? t('refinery.diffCurrent', {
	                                      line: exportSkillActiveHunk.oldStart + 1,
	                                      current: exportSkillActiveHunkIndex + 1,
	                                      total: exportSkillPendingHunks.length,
	                                    })
	                                  : null}
	                              </div>
	                              <div className="refinery-diff-nav-actions">
	                                <button
	                                  className="btn btn-secondary btn-sm"
	                                  type="button"
	                                  onClick={() => navSkillDiff(-1)}
	                                  disabled={exportSkillPendingHunks[0]?.id === exportSkillActiveHunk.id}
	                                >
	                                  {t('refinery.diffPrev')}
	                                </button>
	                                <button
	                                  className="btn btn-secondary btn-sm"
	                                  type="button"
	                                  onClick={() => navSkillDiff(1)}
	                                  disabled={
	                                    exportSkillPendingHunks[exportSkillPendingHunks.length - 1]?.id === exportSkillActiveHunk.id
	                                  }
	                                >
	                                  {t('refinery.diffNext')}
	                                </button>
	                                <button
	                                  className="btn btn-secondary btn-sm"
	                                  type="button"
	                                  onClick={() => decideActiveSkillDiff('reject')}
	                                >
	                                  {t('refinery.diffReject')}
	                                </button>
	                                <button
	                                  className="btn btn-primary btn-sm"
	                                  type="button"
	                                  onClick={() => decideActiveSkillDiff('accept')}
	                                >
	                                  {t('refinery.diffAccept')}
	                                </button>
	                              </div>
	                            </div>
	                          </div>
	                        ) : null}
	                      </div>
	                    </div>
	                  ) : (
	                    <div className="refinery-diff-grid">
	                      <div className="refinery-diff-pane">
	                        <div className="refinery-diff-title">{t('refinery.diffSource')}</div>
	                        {exportSkillLoading ? (
	                          <div className="analytics-empty">{t('analytics.loading')}</div>
	                        ) : (
	                          <div className="markdown-preview">
	                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
	                              {exportSkillContent.trim()
	                                ? exportSkillContent
	                                : t('workRules.previewEmpty')}
	                            </ReactMarkdown>
	                          </div>
	                        )}
	                      </div>
	                      <div className="refinery-diff-pane">
	                        <div className="refinery-diff-title-row">
	                          <div className="refinery-diff-title">
	                            {exportSkillOptimized.trim()
	                              ? t('refinery.diffOptimized')
	                              : t('refinery.diffAnalysis')}
	                          </div>
	                          {exportSkillOptimized.trim() ? (
	                            <button
	                              className="btn btn-secondary btn-sm"
	                              type="button"
	                              onClick={() => {
	                                setExportSkillOptimized('')
	                                setExportSkillDiffHunks([])
	                              }}
	                              disabled={exportSkillLoading}
	                            >
	                              {t('refinery.backToAnalysis')}
	                            </button>
	                          ) : (
	                            <div className="refinery-review-actions">
	                              <div className="refinery-review-popover-anchor">
	                                <button
	                                  ref={exportSkillReviewButtonRef}
	                                  className="btn btn-secondary btn-sm"
	                                  type="button"
	                                  onClick={() => setExportSkillReviewOpen((v) => !v)}
	                                  disabled={exportSkillLoading}
	                                >
	                                  {t('refinery.review')} · {exportSkillReviewCount}
	                                </button>
	                                {exportSkillReviewOpen ? (
	                                  <div className="refinery-review-popover" ref={exportSkillReviewPopoverRef}>
	                                    <div className="refinery-review-title">{t('refinery.reviewTitle')}</div>
	                                    <div className="refinery-review-row">
	                                      <textarea
	                                        className="input refinery-review-textarea"
	                                        rows={2}
	                                        value={exportSkillReviewMessage}
	                                        onChange={(e) => setExportSkillReviewMessage(e.target.value)}
	                                        placeholder={t('refinery.reviewPlaceholder')}
	                                      />
	                                      <button
	                                        className="btn btn-primary btn-sm"
	                                        type="button"
	                                        onClick={() => setExportSkillReviewOpen(false)}
	                                      >
	                                        {t('refinery.reviewSubmit')}
	                                      </button>
	                                    </div>
	                                    <details className="refinery-review-details">
	                                      <summary className="refinery-review-summary">
	                                        {t('refinery.reviewLineComments', { count: exportSkillLineComments.length })}
	                                      </summary>
	                                      {exportSkillReviewGroups.length === 0 ? (
	                                        <div className="helper-text">{t('refinery.reviewNoLineComments')}</div>
	                                      ) : (
	                                        <div className="refinery-review-list">
	                                          {exportSkillReviewGroups.map((g) => (
	                                              <div
	                                                key={`line-${g.line}`}
	                                                className="refinery-review-item"
	                                                role="button"
	                                                tabIndex={0}
	                                                onClick={() => openSkillLineComment(g.line)}
	                                                onKeyDown={(e) => {
	                                                  if (e.key === 'Enter' || e.key === ' ') openSkillLineComment(g.line)
	                                                }}
	                                              >
	                                                <div className="refinery-review-item-main">
	                                                  <div className="refinery-review-item-title">
	                                                    L{g.line}
	                                                    <span className="refinery-review-badge">{g.count}</span>
	                                                  </div>
	                                                  <div className="refinery-review-item-body">
	                                                    {g.preview}
	                                                  </div>
	                                                </div>
	                                              </div>
	                                          ))}
	                                        </div>
	                                      )}
	                                    </details>
	                                  </div>
	                                ) : null}
	                              </div>
	                              <button
	                                className="btn btn-primary btn-sm"
	                                type="button"
	                                onClick={() => void runSkillOptimize()}
	                                disabled={exportSkillLoading || !exportSkillAnalysis.trim()}
	                              >
	                                {t('refinery.proceed')} · {exportSkillReviewCount}
	                              </button>
	                            </div>
	                          )}
	                        </div>
	                        {exportSkillLoading ? (
	                          <div className="analytics-empty">{t('analytics.loading')}</div>
	                        ) : exportSkillOptimized.trim() ? (
	                          <div className="markdown-preview">
	                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
	                              {exportSkillOptimizedFinal.trim()
	                                ? exportSkillOptimizedFinal
	                                : t('refinery.optimizeEmpty')}
	                            </ReactMarkdown>
	                          </div>
	                        ) : (
	                          <div className="refinery-analysis-editor-wrap" ref={exportSkillAnalysisWrapRef}>
	                            <div className="markdown-preview markdown-line-review">
	                              <ReactMarkdown
	                                remarkPlugins={[remarkGfm]}
	                                components={exportSkillAnalysisMarkdownComponents}
	                              >
	                                {exportSkillAnalysis.trim()
	                                  ? exportSkillAnalysis
	                                  : t('refinery.analysisEmpty')}
	                              </ReactMarkdown>
	                            </div>
	                            {exportSkillCommentLine ? (
	                              <div className="refinery-line-comment-card" style={{ top: exportSkillCommentCardTop }}>
	                                <div className="refinery-line-comment-header">
	                                  <div className="refinery-line-comment-title">
	                                    {t('refinery.commentOnLine', { line: exportSkillCommentLine })}
	                                  </div>
	                                  <button
	                                    className="icon-btn"
	                                    type="button"
	                                    onClick={() => {
	                                      setExportSkillCommentLine(null)
	                                      setExportSkillCommentComposerOpen(false)
	                                      setExportSkillCommentDraft('')
	                                      setExportSkillEditingCommentId(null)
	                                    }}
	                                    aria-label={t('close')}
	                                  >
	                                    <X size={16} />
	                                  </button>
	                                </div>
	                                {exportSkillActiveLineComments.length === 0 ? (
	                                  <div className="helper-text">{t('refinery.reviewNoLineComments')}</div>
	                                ) : (
	                                  <div className="refinery-line-comment-list">
	                                    {exportSkillActiveLineComments.map((c) => (
	                                      <div key={c.id} className="refinery-line-comment-item">
	                                        <div className="refinery-line-comment-text">{c.body}</div>
	                                        <div className="refinery-line-comment-item-actions">
	                                          <button
	                                            className="btn btn-secondary btn-sm btn-icon"
	                                            type="button"
	                                            onClick={() => startEditSkillLineComment(c)}
	                                            title={t('refinery.commentEdit')}
	                                            aria-label={t('refinery.commentEdit')}
	                                          >
	                                            <Pencil size={14} />
	                                          </button>
	                                          <button
	                                            className="btn btn-danger btn-sm btn-icon"
	                                            type="button"
	                                            onClick={() => deleteSkillLineComment(c.id)}
	                                            title={t('refinery.commentDelete')}
	                                            aria-label={t('refinery.commentDelete')}
	                                          >
	                                            <Trash2 size={14} />
	                                          </button>
	                                        </div>
	                                      </div>
	                                    ))}
	                                  </div>
	                                )}

	                                {!exportSkillCommentComposerOpen ? (
	                                  <button
	                                    className="btn btn-secondary btn-sm"
	                                    type="button"
	                                    onClick={() => {
	                                      setExportSkillCommentComposerOpen(true)
	                                      setExportSkillCommentDraft('')
	                                      setExportSkillEditingCommentId(null)
	                                    }}
	                                  >
	                                    {t('refinery.addLineComment')}
	                                  </button>
	                                ) : null}

	                                {exportSkillCommentComposerOpen ? (
	                                  <>
	                                    <textarea
	                                      className="input"
	                                      rows={3}
	                                      value={exportSkillCommentDraft}
	                                      onChange={(e) => setExportSkillCommentDraft(e.target.value)}
	                                      placeholder={t('refinery.commentPlaceholder')}
	                                    />
	                                    <div className="refinery-line-comment-actions">
	                                      <button
	                                        className="btn btn-primary btn-sm"
	                                        type="button"
	                                        onClick={submitSkillLineComment}
	                                      >
	                                        {exportSkillEditingCommentId
	                                          ? t('refinery.commentUpdate')
	                                          : t('refinery.commentSave')}
	                                      </button>
	                                      <button
	                                        className="btn btn-secondary btn-sm"
	                                        type="button"
	                                        onClick={() => {
	                                          setExportSkillCommentComposerOpen(false)
	                                          setExportSkillCommentDraft('')
	                                          setExportSkillEditingCommentId(null)
	                                        }}
	                                      >
	                                        {t('cancel')}
	                                      </button>
	                                    </div>
	                                  </>
	                                ) : null}
	                              </div>
	                            ) : null}
	                          </div>
	                        )}
	                      </div>
	                    </div>
	                  )}
	                </>
	              ) : (
	                <div className="work-rules-editor-grid">
	                  <div className="work-rules-editor-left">
	                    <div className="form-group">
	                      <label className="label">{t('workRules.name')}</label>
	                      <input
	                        className="input"
	                        value={exportSkillName}
	                        onChange={(e) => setExportSkillName(e.target.value)}
	                        placeholder="my-skill"
	                      />
	                    </div>
	                    <div className="form-group">
	                      <label className="inline-checkbox">
	                        <input
	                          type="checkbox"
	                          checked={exportSkillOverwrite}
	                          onChange={(e) => setExportSkillOverwrite(e.target.checked)}
	                        />
	                        {t('workRules.overwrite')}
	                      </label>
	                      <div className="analytics-skill-id">{t('refinery.skillExportHint')}</div>
	                    </div>

	                    <div className="form-group">
	                      <label className="label">{t('refinery.agent')}</label>
	                      <select
	                        className="input"
	                        value={exportSkillAgentId}
	                        onChange={(e) => setExportSkillAgentId(e.target.value)}
	                        disabled={exportSkillLoading || llmAgentsLoading}
	                      >
	                        <option value="">{t('refinery.pickAgent')}</option>
	                        {llmAgents.map((a) => (
	                          <option key={a.id} value={a.id}>
	                            {a.name}
	                          </option>
	                        ))}
	                      </select>
	                      {llmAgentsLoading ? (
	                        <div className="helper-text">{t('analytics.loading')}</div>
	                      ) : llmAgentsError ? (
	                        <div className="helper-text">{llmAgentsError}</div>
	                      ) : llmAgents.length === 0 ? (
	                        <div className="helper-text">{t('refinery.noAgents')}</div>
	                      ) : null}
	                    </div>
	                  </div>

	                  <div className="work-rules-editor-right">
	                    <div className="refinery-diff-grid">
	                      <div className="refinery-diff-pane">
	                        <div className="refinery-diff-title">{t('refinery.diffSource')}</div>
	                        {exportSkillLoading ? (
	                          <div className="analytics-empty">{t('analytics.loading')}</div>
	                        ) : (
	                          <div className="markdown-preview">
	                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
	                              {exportSkillContent.trim()
	                                ? exportSkillContent
	                                : t('workRules.previewEmpty')}
	                            </ReactMarkdown>
	                          </div>
	                        )}
	                      </div>
	                      <div className="refinery-diff-pane">
	                        <div className="refinery-diff-title">{t('refinery.diffFused')}</div>
	                        <div className="tabs" style={{ marginTop: 0 }}>
	                          <button
	                            className={`tab-item${exportSkillContentTab === 'edit' ? ' active' : ''}`}
	                            type="button"
	                            onClick={() => setExportSkillContentTab('edit')}
	                            disabled={exportSkillLoading}
	                          >
	                            {t('workRules.contentEditTab')}
	                          </button>
	                          <button
	                            className={`tab-item${exportSkillContentTab === 'preview' ? ' active' : ''}`}
	                            type="button"
	                            onClick={() => setExportSkillContentTab('preview')}
	                            disabled={exportSkillLoading}
	                          >
	                            {t('workRules.contentPreviewTab')}
	                          </button>
	                        </div>
	                        {exportSkillLoading ? (
	                          <div className="analytics-empty">{t('analytics.loading')}</div>
	                        ) : exportSkillContentTab === 'edit' ? (
	                          <textarea
	                            className="input"
	                            value={exportSkillResult}
	                            onChange={(e) => setExportSkillResult(e.target.value)}
	                            rows={16}
	                          />
	                        ) : (
	                          <div className="markdown-preview">
	                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
	                              {exportSkillResult.trim() ? exportSkillResult : t('refinery.resultEmpty')}
	                            </ReactMarkdown>
	                          </div>
	                        )}
	                      </div>
	                    </div>
	                  </div>
	                </div>
	              )}

	              <div className="modal-footer">
	                <button
	                  className="btn btn-secondary"
	                  type="button"
	                  onClick={() => void runSkillLlm()}
	                  disabled={exportSkillLoading}
	                >
	                  {exportSkillMode === 'fusion' ? t('refinery.runFusion') : t('refinery.runAnalysis')}
	                </button>
	                {exportSkillMode === 'analysis' &&
	                exportSkillOptimizedFinal.trim() &&
	                exportSkillPendingDiffs === 0 ? (
	                  <button
	                    className="btn btn-primary"
	                    type="button"
	                    onClick={() => void saveSkillOptimized()}
	                    disabled={exportSkillLoading}
	                  >
	                    {t('refinery.saveOptimized')}
	                  </button>
	                ) : null}
	                <button
	                  className="btn btn-secondary"
	                  type="button"
	                  onClick={closeExportSkill}
	                  disabled={exportSkillLoading}
	                >
                  {t('cancel')}
                </button>
                {exportSkillMode === 'fusion' ? (
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void onSubmitExportSkill()}
                    disabled={exportSkillLoading}
                  >
                    {t('refinery.exportSkill')}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
