import { diffLines } from 'diff'

export type DiffHunk = {
  id: string
  oldStart: number
  oldEnd: number
  oldLines: string[]
  newLines: string[]
}

export type DiffHunkDecision = 'pending' | 'accept' | 'reject'

export type DiffHunkState = DiffHunk & {
  decision: DiffHunkDecision
}

const normalizeNewlines = (text: string) => text.replace(/\r\n/g, '\n')

const splitLines = (text: string) => normalizeNewlines(text).split('\n')

export const buildLineDiffHunks = (oldText: string, newText: string): DiffHunk[] => {
  const oldNorm = normalizeNewlines(oldText)
  const newNorm = normalizeNewlines(newText)
  const parts = diffLines(oldNorm, newNorm)

  const hunks: DiffHunk[] = []
  let oldIndex = 0
  let pendingStart: number | null = null
  let pendingOld: string[] = []
  let pendingNew: string[] = []

  const flush = () => {
    if (pendingStart == null) return
    hunks.push({
      id: `hunk-${hunks.length + 1}`,
      oldStart: pendingStart,
      oldEnd: pendingStart + pendingOld.length,
      oldLines: pendingOld,
      newLines: pendingNew,
    })
    pendingStart = null
    pendingOld = []
    pendingNew = []
  }

  for (const part of parts) {
    const lines = splitLines(part.value)
    if ((part as { added?: boolean }).added) {
      if (pendingStart == null) pendingStart = oldIndex
      pendingNew.push(...lines)
      continue
    }
    if ((part as { removed?: boolean }).removed) {
      if (pendingStart == null) pendingStart = oldIndex
      pendingOld.push(...lines)
      oldIndex += lines.length
      continue
    }

    flush()
    oldIndex += lines.length
  }

  flush()
  return hunks
}

export const initHunkStates = (hunks: DiffHunk[]): DiffHunkState[] =>
  hunks.map((h) => ({ ...h, decision: 'pending' as const }))

export const applyHunkDecisions = (
  oldText: string,
  hunks: DiffHunkState[],
  pendingDefault: 'accept' | 'reject' = 'reject',
): string => {
  const oldLines = splitLines(oldText)
  const sorted = [...hunks].sort((a, b) => a.oldStart - b.oldStart)

  let cursor = 0
  const out: string[] = []
  for (const hunk of sorted) {
    out.push(...oldLines.slice(cursor, hunk.oldStart))
    if (hunk.decision === 'accept' || (hunk.decision === 'pending' && pendingDefault === 'accept')) {
      out.push(...hunk.newLines)
    } else {
      out.push(...oldLines.slice(hunk.oldStart, hunk.oldEnd))
    }
    cursor = hunk.oldEnd
  }
  out.push(...oldLines.slice(cursor))
  return out.join('\n')
}
