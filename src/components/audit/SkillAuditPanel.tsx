import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FolderOpen, RefreshCw } from 'lucide-react'
import type { GitSkillCandidate } from '../skills/types'

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

type LlmAgent = {
  id: string
  name: string
}

type SkillAuditPanelProps = {
  isTauri: boolean
  invokeTauri: <T,>(command: string, args?: Record<string, unknown>) => Promise<T>
  t: TFunction
}

type ParsedGitInput = {
  repoUrl: string
}

type SkillDirOption = {
  value: string
  label: string
}

const fileTreeFromSnapshot = (snapshot: SkillSnapshot | null) => {
  if (!snapshot) return ''
  const paths = snapshot.files.map((f) => f.rel_path).sort((a, b) => a.localeCompare(b))
  const seen = new Set<string>()
  const lines: string[] = []
  for (const p of paths) {
    const parts = p.split('/').filter(Boolean)
    for (let i = 0; i < parts.length; i += 1) {
      const key = parts.slice(0, i + 1).join('/')
      if (seen.has(key)) continue
      seen.add(key)
      const indent = '  '.repeat(i)
      const isDir = i < parts.length - 1
      lines.push(`${indent}${parts[i]}${isDir ? '/' : ''}`)
    }
  }
  return lines.join('\n')
}

const joinPath = (a: string, b: string) => `${a.replace(/[\\/]+$/, '')}/${b.replace(/^[\\/]+/, '')}`

const normalizeGithubRepoUrl = (raw: string) => {
  const trimmed = raw.trim().replace(/^git\+/, '').replace(/^['"]|['"]$/g, '')
  if (!trimmed) return ''
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}`
  }
  if (/^github\.com\//i.test(trimmed)) {
    return `https://${trimmed}`
  }
  try {
    const url = new URL(trimmed)
    if (!url.hostname.includes('github.com')) return trimmed
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return trimmed
    const owner = parts[0]
    const repo = parts[1]?.replace(/\.git$/i, '')
    if (!owner || !repo) return trimmed
    return `https://github.com/${owner}/${repo}`
  } catch {
    return trimmed
  }
}

const parseGitInput = (raw: string): ParsedGitInput => {
  const text = raw.trim()
  if (!text) return { repoUrl: '' }
  const tokens = text.split(/\s+/).filter(Boolean).map((t) => t.replace(/^['"]|['"]$/g, ''))

  const urlToken =
    tokens.find((t) => /^(https?:\/\/|ssh:\/\/|git@)/i.test(t)) ??
    tokens.find((t) => /github\.com\//i.test(t)) ??
    tokens.find((t) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(t)) ??
    tokens[0] ??
    ''

  return { repoUrl: normalizeGithubRepoUrl(urlToken) }
}

export default function SkillAuditPanel({ isTauri, invokeTauri, t }: SkillAuditPanelProps) {
  const [gitUrl, setGitUrl] = useState('')
  const [snapshot, setSnapshot] = useState<SkillSnapshot | null>(null)
  const [containerSnapshot, setContainerSnapshot] = useState<SkillSnapshot | null>(null)
  const [containerRootPath, setContainerRootPath] = useState<string | null>(null)
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedSkillDir, setSelectedSkillDir] = useState<string>('')
  const [gitCandidates, setGitCandidates] = useState<GitSkillCandidate[]>([])

  const [agents, setAgents] = useState<LlmAgent[]>([])
  const [agentId, setAgentId] = useState('')

  const [result, setResult] = useState('')
  const [resultTab, setResultTab] = useState<'preview' | 'edit'>('preview')

  const loadAgents = useCallback(async () => {
    if (!isTauri) return
    try {
      const list = await invokeTauri<LlmAgent[]>('list_llm_agents')
      setAgents(list)
      if (!agentId && list[0]?.id) {
        setAgentId(list[0].id)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [agentId, invokeTauri, isTauri])

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  const treeText = useMemo(() => fileTreeFromSnapshot(snapshot), [snapshot])

  const skillDirOptions = useMemo<SkillDirOption[]>(() => {
    if (gitCandidates.length > 0) {
      const byValue = new Map<string, SkillDirOption>()
      // Always provide a repo-root option to preview the container tree.
      byValue.set('', { value: '', label: t('audit.repoRoot') })
      for (const cand of gitCandidates) {
        const value = cand.subpath === '.' ? '' : cand.subpath
        if (byValue.has(value)) continue
        const label = cand.subpath === '.'
          ? `${cand.name} · ${t('audit.repoRoot')}`
          : `${cand.name} · ${cand.subpath}`
        byValue.set(value, { value, label })
      }
      return Array.from(byValue.values())
    }

    const base = containerSnapshot ?? snapshot
    if (!base) return [{ value: '', label: t('audit.repoRoot') }]
    const dirs = new Set<string>()
    dirs.add('')
    for (const f of base.files) {
      const parts = f.rel_path.split('/').filter(Boolean)
      const fileName = parts[parts.length - 1]?.toLowerCase()
      if (fileName !== 'skill.md') continue
      const dir = parts.slice(0, -1).join('/')
      dirs.add(dir)
    }
    return Array.from(dirs)
      .sort((a, b) => a.localeCompare(b))
      .map((dir) => ({ value: dir, label: dir ? dir : t('audit.repoRoot') }))
  }, [containerSnapshot, gitCandidates, snapshot, t])

  const selectSkillDir = useCallback(
    async (dir: string) => {
      if (!isTauri) {
        toast.error(t('errors.notTauri'))
        return
      }
      if (!containerRootPath || !containerSnapshot) {
        // No container context; treat current snapshot as container.
        if (!snapshot) return
        if (!dir) {
          setSelectedSkillDir('')
          setRootPath(snapshot.root)
          return
        }
        setLoading(true)
        try {
          const target = joinPath(snapshot.root, dir)
          const sub = await invokeTauri<SkillSnapshot>('get_path_snapshot', { path: target })
          setSelectedSkillDir(dir)
          setSnapshot(sub)
          setRootPath(sub.root)
          setResult('')
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err))
        } finally {
          setLoading(false)
        }
        return
      }

      if (!dir) {
        setSelectedSkillDir('')
        setSnapshot(containerSnapshot)
        setRootPath(containerRootPath)
        setResult('')
        return
      }

      setLoading(true)
      try {
        const target = joinPath(containerRootPath, dir)
        const sub = await invokeTauri<SkillSnapshot>('get_path_snapshot', { path: target })
        setSelectedSkillDir(dir)
        setSnapshot(sub)
        setRootPath(sub.root)
        setResult('')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [containerRootPath, containerSnapshot, invokeTauri, isTauri, snapshot, t],
  )

  const pickLocalFolder = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      multiple: false,
      directory: true,
      title: t('audit.pickFolderTitle'),
    })
    if (!selected || Array.isArray(selected)) return

    setLoading(true)
    try {
      const snap = await invokeTauri<SkillSnapshot>('get_path_snapshot', { path: selected })
      setSnapshot(snap)
      setContainerSnapshot(snap)
      setContainerRootPath(snap.root)
      setRootPath(snap.root)
      setSelectedSkillDir('')
      setGitCandidates([])
      setResult('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [invokeTauri, isTauri, t])

  const previewGitRepo = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    const parsed = parseGitInput(gitUrl)
    if (!parsed.repoUrl) {
      toast.error(t('audit.gitUrlRequired'))
      return
    }

    setLoading(true)
    try {
      const snap = await invokeTauri<SkillSnapshot>('get_git_snapshot', { repoUrl: parsed.repoUrl })
      setSnapshot(snap)
      setContainerSnapshot(snap)
      setContainerRootPath(snap.root)
      setRootPath(snap.root)
      setSelectedSkillDir('')
      try {
        const candidates = await invokeTauri<GitSkillCandidate[]>('list_git_skills_cmd', { repoUrl: parsed.repoUrl })
        setGitCandidates(candidates)
      } catch {
        setGitCandidates([])
      }
      setResult('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [gitUrl, invokeTauri, isTauri, t])

  const runAudit = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!rootPath) {
      toast.error(t('audit.pickSourceFirst'))
      return
    }
    if (!agentId.trim()) {
      toast.error(t('audit.pickAgentFirst'))
      return
    }

    setLoading(true)
    try {
      const out = await invokeTauri<string>('run_skill_audit', {
        agentId,
        root: rootPath,
      })
      setResult(out)
      setResultTab('preview')
      toast.success(t('audit.auditDone'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [agentId, invokeTauri, isTauri, rootPath, t])

  const saveReport = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!result.trim()) {
      toast.error(t('audit.resultEmpty'))
      return
    }

    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const dest = await save({
        title: t('audit.saveTitle'),
        defaultPath: 'skill-audit.md',
      })
      if (!dest) return
      await invokeTauri('write_text_file', { path: dest, content: result, overwrite: false })
      toast.success(t('audit.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [invokeTauri, isTauri, result, t])

  return (
    <div className="analytics-page">
      <div className="analytics-card">
        <div className="analytics-card-title">{t('audit.title')}</div>

        <div className="audit-toolbar">
          <div className="audit-git-row">
            <input
              className="input"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder={t('audit.gitUrlPlaceholder')}
              disabled={loading}
            />
            <button className="btn btn-secondary" type="button" onClick={() => void previewGitRepo()} disabled={loading}>
              <RefreshCw size={16} />
              {t('audit.previewRepo')}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => void pickLocalFolder()} disabled={loading}>
              <FolderOpen size={16} />
              {t('audit.pickFolder')}
            </button>
          </div>

          <div className="audit-agent-row">
            <div className="form-group" style={{ marginBottom: 0, maxWidth: 360 }}>
              <label className="label">{t('audit.agent')}</label>
              <select
                className="input"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                disabled={loading}
              >
                <option value="">{t('audit.pickAgent')}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {agents.length === 0 ? <div className="helper-text">{t('audit.noAgents')}</div> : null}
            </div>

            <div className="audit-actions">
              <button className="btn btn-primary" type="button" onClick={() => void runAudit()} disabled={loading}>
                {t('audit.run')}
              </button>
              <button className="btn btn-secondary" type="button" onClick={() => void saveReport()} disabled={loading || !result.trim()}>
                {t('audit.save')}
              </button>
            </div>
          </div>
        </div>

        <div className="audit-grid">
          <div className="audit-pane">
            <div className="audit-pane-title">{t('audit.previewTitle')}</div>
            {!snapshot ? (
              <div className="analytics-empty">{t('audit.noSource')}</div>
            ) : (
              <>
                {skillDirOptions.length > 1 ? (
                  <div className="form-group" style={{ marginBottom: 0, maxWidth: 520 }}>
                    <label className="label">{t('audit.skillSelectorLabel')}</label>
                    <select
                      className="input"
                      value={selectedSkillDir}
                      onChange={(e) => void selectSkillDir(e.target.value)}
                      disabled={loading}
                    >
                      {skillDirOptions.map((opt) => (
                        <option key={opt.value || '__root__'} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <div className="helper-text">
                      {selectedSkillDir
                        ? t('audit.rootHintSkill', { dir: selectedSkillDir })
                        : t('audit.rootHintRepo')}
                    </div>
                  </div>
                ) : null}

                <div className="analytics-note">
                  <div className="analytics-note-title">{t('audit.treeTitle')}</div>
                  <pre className="markdown-preview tree-preview">{treeText || t('audit.treeEmpty')}</pre>
                </div>

                <div className="analytics-note">
                  <div className="analytics-note-title">{t('audit.skillMdTitle')}</div>
                  {snapshot.skill_md_error ? (
                    <div className="analytics-error">{snapshot.skill_md_error}</div>
                  ) : snapshot.skill_md ? (
                    <div className="markdown-preview">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {snapshot.skill_md}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="analytics-empty">
                      {t('audit.noSkillMd')}
                      {skillDirOptions.length > 1 ? (
                        <div className="helper-text">{t('audit.noSkillMdHintMulti')}</div>
                      ) : null}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="audit-pane">
            <div className="audit-pane-title">{t('audit.resultTitle')}</div>
            <div className="tabs" style={{ marginTop: 0 }}>
              <button
                className={`tab-item${resultTab === 'preview' ? ' active' : ''}`}
                type="button"
                onClick={() => setResultTab('preview')}
                disabled={loading}
              >
                {t('workRules.contentPreviewTab')}
              </button>
              <button
                className={`tab-item${resultTab === 'edit' ? ' active' : ''}`}
                type="button"
                onClick={() => setResultTab('edit')}
                disabled={loading}
              >
                {t('workRules.contentEditTab')}
              </button>
            </div>

            {loading ? (
              <div className="analytics-empty">{t('analytics.loading')}</div>
            ) : resultTab === 'edit' ? (
              <textarea className="input" rows={18} value={result} onChange={(e) => setResult(e.target.value)} />
            ) : (
              <div className="markdown-preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {result.trim() ? result : t('audit.resultEmpty')}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
