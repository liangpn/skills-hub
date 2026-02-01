import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { Download, FileUp, Pencil, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type WorkRuleEntry = {
  name: string
  entry_file: string
  tags: string[]
  score: number | null
  description: string | null
  updated_at_ms: number
}

type WorkRuleManifest = {
  version: number
  kind: string
  name: string
  entry_file: string
  tags: string[]
  score: number | null
  description: string | null
  created_at_ms: number
  updated_at_ms: number
}

type WorkRuleDetails = {
  manifest: WorkRuleManifest
  content: string
}

type ExportMode = 'copy' | 'symlink'

type WorkRulesPanelProps = {
  isTauri: boolean
  invokeTauri: <T,>(command: string, args?: Record<string, unknown>) => Promise<T>
  t: TFunction
}

const fileNameFromPath = (path: string) => path.split(/[/\\\\]/).filter(Boolean).pop() ?? path

export default function WorkRulesPanel({ isTauri, invokeTauri, t }: WorkRulesPanelProps) {
  const [rules, setRules] = useState<WorkRuleEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [exportRuleName, setExportRuleName] = useState<string>('')

  const [newName, setNewName] = useState('')
  const [newEntryFile, setNewEntryFile] = useState('AGENTS.md')
  const [newTags, setNewTags] = useState('')
  const [newScore, setNewScore] = useState<string>('')
  const [newDescription, setNewDescription] = useState('')
  const [newContent, setNewContent] = useState('')
  const [contentTab, setContentTab] = useState<'edit' | 'preview'>('edit')

  const [showEdit, setShowEdit] = useState(false)
  const [editRuleName, setEditRuleName] = useState('')
  const [editEntryFile, setEditEntryFile] = useState('AGENTS.md')
  const [editTags, setEditTags] = useState('')
  const [editScore, setEditScore] = useState<string>('')
  const [editDescription, setEditDescription] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editContentTab, setEditContentTab] = useState<'edit' | 'preview'>('edit')

  const [exportProjectDir, setExportProjectDir] = useState('')
  const [exportDestFile, setExportDestFile] = useState('AGENTS.md')
  const [exportMode, setExportMode] = useState<ExportMode>('copy')
  const [exportOverwrite, setExportOverwrite] = useState(false)

  const loadRules = useCallback(async () => {
    if (!isTauri) return
    setLoading(true)
    try {
      const list = await invokeTauri<WorkRuleEntry[]>('list_work_rules')
      setRules(list)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [invokeTauri, isTauri])

  useEffect(() => {
    void loadRules()
  }, [loadRules])

  const openCreate = useCallback(() => {
    setNewName('')
    setNewEntryFile('AGENTS.md')
    setNewTags('')
    setNewScore('')
    setNewDescription('')
    setNewContent('')
    setContentTab('edit')
    setShowCreate(true)
  }, [])

  const openImportFile = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: false,
        directory: false,
        title: t('workRules.importPickFile'),
      })
      if (!selected || Array.isArray(selected)) return
      setLoading(true)
      const content = await invokeTauri<string>('read_text_file', {
        path: selected,
        maxBytes: 512 * 1024,
      })

      const base = fileNameFromPath(selected)
      const stem = base.replace(/\.[^/.]+$/, '')
      setNewName(stem || base)
      setNewEntryFile(base || 'AGENTS.md')
      setNewContent(content)
      setNewDescription('')
      setNewTags('')
      setNewScore('')
      setContentTab('edit')
      setShowCreate(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [invokeTauri, isTauri, t])

  const closeCreate = useCallback(() => setShowCreate(false), [])

  const onSubmitCreate = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    const tags = newTags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const scoreRaw = newScore.trim()
    let score: number | null = null
    if (scoreRaw) {
      const v = Number(scoreRaw)
      if (!Number.isFinite(v)) {
        toast.error(t('workRules.invalidScore'))
        return
      }
      score = v
    }

    setLoading(true)
    try {
      await invokeTauri('create_work_rule', {
        name: newName.trim(),
        entryFile: newEntryFile.trim(),
        content: newContent,
        tags,
        score,
        description: newDescription.trim() ? newDescription.trim() : null,
      })
      toast.success(t('workRules.created'))
      setShowCreate(false)
      await loadRules()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [
    invokeTauri,
    isTauri,
    loadRules,
    newContent,
    newDescription,
    newEntryFile,
    newName,
    newScore,
    newTags,
    t,
  ])

  const openEdit = useCallback(
    async (name: string) => {
      if (!isTauri) {
        toast.error(t('errors.notTauri'))
        return
      }
      setLoading(true)
      try {
        const details = await invokeTauri<WorkRuleDetails>('get_work_rule', { name })
        setEditRuleName(details.manifest.name)
        setEditEntryFile(details.manifest.entry_file)
        setEditTags(details.manifest.tags.join(', '))
        setEditScore(details.manifest.score == null ? '' : String(details.manifest.score))
        setEditDescription(details.manifest.description ?? '')
        setEditContent(details.content)
        setEditContentTab('edit')
        setShowEdit(true)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [invokeTauri, isTauri, t],
  )

  const closeEdit = useCallback(() => setShowEdit(false), [])

  const onSubmitEdit = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }

    const tags = editTags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const scoreRaw = editScore.trim()
    let score: number | null = null
    if (scoreRaw) {
      const v = Number(scoreRaw)
      if (!Number.isFinite(v)) {
        toast.error(t('workRules.invalidScore'))
        return
      }
      score = v
    }

    setLoading(true)
    try {
      await invokeTauri('update_work_rule', {
        name: editRuleName,
        entryFile: editEntryFile.trim(),
        content: editContent,
        tags,
        score,
        description: editDescription.trim() ? editDescription.trim() : null,
      })
      toast.success(t('workRules.saved'))
      setShowEdit(false)
      await loadRules()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [
    editContent,
    editDescription,
    editEntryFile,
    editRuleName,
    editScore,
    editTags,
    invokeTauri,
    isTauri,
    loadRules,
    t,
  ])

  const onDeleteRule = useCallback(
    async (name: string) => {
      if (!isTauri) {
        toast.error(t('errors.notTauri'))
        return
      }
      try {
        const { confirm } = await import('@tauri-apps/plugin-dialog')
        const ok = await confirm(t('workRules.confirmDelete', { name }), {
          title: t('workRules.title'),
          kind: 'warning',
        })
        if (!ok) return
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
        return
      }
      setLoading(true)
      try {
        await invokeTauri('delete_work_rule', { name })
        toast.success(t('workRules.deleted'))
        await loadRules()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [invokeTauri, isTauri, loadRules, t],
  )

  const openExport = useCallback((name: string, entryFile: string) => {
    setExportRuleName(name)
    setExportProjectDir('')
    setExportDestFile(entryFile || 'AGENTS.md')
    setExportMode('copy')
    setExportOverwrite(false)
    setShowExport(true)
  }, [])

  const closeExport = useCallback(() => setShowExport(false), [])

  const pickExportProjectDir = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('workRules.pickProjectDir'),
      })
      if (!selected || Array.isArray(selected)) return
      setExportProjectDir(selected)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [isTauri, t])

  const onSubmitExport = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!exportProjectDir.trim()) {
      toast.error(t('workRules.exportMissingDir'))
      return
    }
    setLoading(true)
    try {
      const dest = await invokeTauri<string>('export_work_rule', {
        name: exportRuleName,
        projectDir: exportProjectDir,
        destFileName: exportDestFile.trim(),
        mode: exportMode,
        overwrite: exportOverwrite,
      })
      toast.success(t('workRules.exported', { dest }))
      setShowExport(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [
    exportDestFile,
    exportMode,
    exportOverwrite,
    exportProjectDir,
    exportRuleName,
    invokeTauri,
    isTauri,
    t,
  ])

  const sortedRules = useMemo(() => {
    return [...rules].sort((a, b) => (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0))
  }, [rules])

  if (!isTauri) {
    return (
      <div className="analytics-page">
        <div className="analytics-card">
          <div className="analytics-card-title">{t('workRules.title')}</div>
          <div className="analytics-error">{t('errors.notTauri')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="analytics-page">
      <div className="analytics-grid">
        <div className="analytics-card">
          <div className="analytics-card-title">{t('workRules.title')}</div>
          <div className="analytics-actions">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => void loadRules()}
              disabled={loading}
            >
              {t('refresh')}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => void openImportFile()}
              disabled={loading}
              title={t('workRules.import')}
            >
              <FileUp size={16} aria-hidden="true" />
              {t('workRules.import')}
            </button>
            <button className="btn btn-primary" type="button" onClick={openCreate} disabled={loading}>
              {t('workRules.new')}
            </button>
          </div>
          <div className="analytics-note">
            <div className="analytics-note-title">{t('workRules.howItWorksTitle')}</div>
            <ul className="analytics-note-list">
              <li>{t('workRules.howItWorks1')}</li>
              <li>{t('workRules.howItWorks2')}</li>
            </ul>
          </div>
        </div>

        <div className="analytics-card">
          <div className="analytics-card-title">{t('workRules.library')}</div>
          {sortedRules.length === 0 ? (
            <div className="analytics-empty">{t('workRules.empty')}</div>
          ) : (
            <div className="analytics-table" role="table">
              <div className="analytics-row analytics-row-head work-rules-table-row" role="row">
                <div className="analytics-cell" role="columnheader">
                  {t('workRules.colName')}
                </div>
                <div className="analytics-cell" role="columnheader">
                  {t('workRules.colTags')}
                </div>
                <div className="analytics-cell" role="columnheader">
                  {t('workRules.colScore')}
                </div>
                <div className="analytics-cell" role="columnheader">
                  {t('workRules.colActions')}
                </div>
              </div>
              {sortedRules.map((rule) => (
                <div
                  className="analytics-row analytics-row-body work-rules-table-row"
                  role="row"
                  key={rule.name}
                  onDoubleClick={() => void openEdit(rule.name)}
                >
                  <div className="analytics-cell analytics-skill-cell" role="cell">
                    <div className="analytics-skill-name">{rule.name}</div>
                    <div className="analytics-skill-id">{rule.entry_file}</div>
                  </div>
                  <div className="analytics-cell" role="cell">
                    {rule.tags.length === 0 ? (
                      <span className="analytics-badge">-</span>
                    ) : (
                      rule.tags.map((tag) => (
                        <span className="analytics-badge" key={tag}>
                          {tag}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="analytics-cell" role="cell">
                    {rule.score ?? '-'}
                  </div>
                  <div className="analytics-cell" role="cell">
                    <div className="work-rules-row-actions">
                      <button
                        className="icon-btn"
                        type="button"
                        onDoubleClick={(e) => e.stopPropagation()}
                        onClick={() => void openEdit(rule.name)}
                        disabled={loading}
                        title={t('workRules.edit')}
                        aria-label={t('workRules.edit')}
                      >
                        <Pencil size={16} aria-hidden="true" />
                      </button>
                      <button
                        className="icon-btn"
                        type="button"
                        onDoubleClick={(e) => e.stopPropagation()}
                        onClick={() => openExport(rule.name, rule.entry_file)}
                        disabled={loading}
                        title={t('workRules.export')}
                        aria-label={t('workRules.export')}
                      >
                        <Download size={16} aria-hidden="true" />
                      </button>
                      <button
                        className="icon-btn icon-btn-danger"
                        type="button"
                        onDoubleClick={(e) => e.stopPropagation()}
                        onClick={() => void onDeleteRule(rule.name)}
                        disabled={loading}
                        title={t('delete')}
                        aria-label={t('delete')}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreate ? (
        <div className="modal-backdrop" onClick={() => (loading ? null : closeCreate())}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{t('workRules.new')}</div>
              <button
                className="modal-close"
                type="button"
                onClick={closeCreate}
                aria-label={t('close')}
                disabled={loading}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="label">{t('workRules.name')}</label>
                <input
                  className="input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="my-rules"
                />
              </div>
              <div className="form-group">
                <label className="label">{t('workRules.entryFile')}</label>
                <input
                  className="input"
                  value={newEntryFile}
                  onChange={(e) => setNewEntryFile(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="label">{t('workRules.tags')}</label>
                <input
                  className="input"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="frontend,tauri"
                />
              </div>
              <div className="form-group">
                <label className="label">{t('workRules.score')}</label>
                <input
                  className="input"
                  value={newScore}
                  onChange={(e) => setNewScore(e.target.value)}
                  placeholder="10"
                />
              </div>
              <div className="form-group">
                <label className="label">{t('workRules.description')}</label>
                <input
                  className="input"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder={t('workRules.descriptionPlaceholder')}
                />
              </div>
              <div className="form-group">
                <label className="label">{t('workRules.content')}</label>
                <div className="tabs">
                  <button
                    className={`tab-item${contentTab === 'edit' ? ' active' : ''}`}
                    type="button"
                    onClick={() => setContentTab('edit')}
                  >
                    {t('workRules.contentEditTab')}
                  </button>
                  <button
                    className={`tab-item${contentTab === 'preview' ? ' active' : ''}`}
                    type="button"
                    onClick={() => setContentTab('preview')}
                  >
                    {t('workRules.contentPreviewTab')}
                  </button>
                </div>
                {contentTab === 'edit' ? (
                  <textarea
                    className="input"
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    rows={12}
                  />
                ) : (
                  <div className="markdown-preview">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {newContent.trim() ? newContent : t('workRules.previewEmpty')}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" type="button" onClick={closeCreate}>
                  {t('cancel')}
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void onSubmitCreate()}
                >
                  {t('workRules.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showEdit ? (
        <div className="modal-backdrop" onClick={() => (loading ? null : closeEdit())}>
          <div className="modal modal-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{t('workRules.edit')}</div>
              <button
                className="modal-close"
                type="button"
                onClick={closeEdit}
                aria-label={t('close')}
                disabled={loading}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="work-rules-editor-grid">
                <div className="work-rules-editor-left">
                  <div className="form-group">
                    <label className="label">{t('workRules.name')}</label>
                    <input className="input" value={editRuleName} readOnly />
                  </div>
                  <div className="form-group">
                    <label className="label">{t('workRules.entryFile')}</label>
                    <input
                      className="input"
                      value={editEntryFile}
                      onChange={(e) => setEditEntryFile(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">{t('workRules.tags')}</label>
                    <input
                      className="input"
                      value={editTags}
                      onChange={(e) => setEditTags(e.target.value)}
                      placeholder="frontend,tauri"
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">{t('workRules.score')}</label>
                    <input
                      className="input"
                      value={editScore}
                      onChange={(e) => setEditScore(e.target.value)}
                      placeholder="10"
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">{t('workRules.description')}</label>
                    <input
                      className="input"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder={t('workRules.descriptionPlaceholder')}
                    />
                  </div>
                </div>

                <div className="work-rules-editor-right">
                  <div className="form-group">
                    <label className="label">{t('workRules.content')}</label>
                    <div className="tabs">
                      <button
                        className={`tab-item${editContentTab === 'edit' ? ' active' : ''}`}
                        type="button"
                        onClick={() => setEditContentTab('edit')}
                      >
                        {t('workRules.contentEditTab')}
                      </button>
                      <button
                        className={`tab-item${editContentTab === 'preview' ? ' active' : ''}`}
                        type="button"
                        onClick={() => setEditContentTab('preview')}
                      >
                        {t('workRules.contentPreviewTab')}
                      </button>
                    </div>
                    {editContentTab === 'edit' ? (
                      <textarea
                        className="input"
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={16}
                      />
                    ) : (
                      <div className="markdown-preview">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {editContent.trim() ? editContent : t('workRules.previewEmpty')}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" type="button" onClick={closeEdit}>
                  {t('cancel')}
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void onSubmitEdit()}
                >
                  {t('workRules.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showExport ? (
        <div className="modal-backdrop" onClick={() => (loading ? null : closeExport())}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{t('workRules.export')}</div>
              <button
                className="modal-close"
                type="button"
                onClick={closeExport}
                aria-label={t('close')}
                disabled={loading}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="label">{t('workRules.projectDir')}</label>
                <div className="input-row">
                  <input className="input" value={exportProjectDir} readOnly />
                  <button
                    className="btn btn-secondary input-action"
                    type="button"
                    onClick={() => void pickExportProjectDir()}
                    disabled={loading}
                  >
                    {t('browse')}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="label">{t('workRules.destFile')}</label>
                <input
                  className="input"
                  value={exportDestFile}
                  onChange={(e) => setExportDestFile(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="label">{t('workRules.mode')}</label>
                <select
                  className="input"
                  value={exportMode}
                  onChange={(e) => setExportMode(e.target.value as ExportMode)}
                >
                  <option value="copy">{t('workRules.modeCopy')}</option>
                  <option value="symlink">{t('workRules.modeSymlink')}</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">{t('workRules.overwrite')}</label>
                <div className="toggle-row">
                  <input
                    type="checkbox"
                    checked={exportOverwrite}
                    onChange={(e) => setExportOverwrite(e.target.checked)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" type="button" onClick={closeExport}>
                  {t('cancel')}
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void onSubmitExport()}
                >
                  {t('workRules.export')}
                </button>
              </div>
              <div className="analytics-note">
                <div className="analytics-note-title">{t('workRules.symlinkRiskTitle')}</div>
                <ul className="analytics-note-list">
                  <li>{t('workRules.symlinkRisk1')}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
