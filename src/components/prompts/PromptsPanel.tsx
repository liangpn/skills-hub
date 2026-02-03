import { useCallback, useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type LlmPrompt = {
  id: string
  name: string
  prompt_md: string
  created_at_ms: number
  updated_at_ms: number
}

type PromptsPanelProps = {
  isTauri: boolean
  invokeTauri: <T,>(command: string, args?: Record<string, unknown>) => Promise<T>
  t: TFunction
}

export default function PromptsPanel({ isTauri, invokeTauri, t }: PromptsPanelProps) {
  const [prompts, setPrompts] = useState<LlmPrompt[]>([])
  const [loading, setLoading] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [promptTab, setPromptTab] = useState<'edit' | 'preview'>('edit')

  const loadPrompts = useCallback(async () => {
    if (!isTauri) return
    setLoading(true)
    try {
      const list = await invokeTauri<LlmPrompt[]>('list_llm_prompts')
      setPrompts(list)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [invokeTauri, isTauri])

  useEffect(() => {
    void loadPrompts()
  }, [loadPrompts])

  const openCreate = useCallback(() => {
    setName('')
    setPrompt('')
    setPromptTab('edit')
    setShowCreate(true)
  }, [])

  const closeCreate = useCallback(() => setShowCreate(false), [])

  const openEdit = useCallback(
    async (id: string) => {
      if (!isTauri) {
        toast.error(t('errors.notTauri'))
        return
      }
      setLoading(true)
      try {
        const p = await invokeTauri<LlmPrompt>('get_llm_prompt', { id })
        setEditId(p.id)
        setName(p.name)
        setPrompt(p.prompt_md)
        setPromptTab('edit')
        setShowEdit(true)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [invokeTauri, isTauri, t],
  )

  const closeEdit = useCallback(() => {
    setShowEdit(false)
    setEditId(null)
  }, [])

  const onSubmitCreate = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!name.trim()) {
      toast.error(t('prompts.nameRequired'))
      return
    }
    if (!prompt.trim()) {
      toast.error(t('prompts.promptRequired'))
      return
    }
    setLoading(true)
    try {
      await invokeTauri<LlmPrompt>('create_llm_prompt', {
        name: name.trim(),
        promptMd: prompt,
      })
      toast.success(t('prompts.created'))
      setShowCreate(false)
      await loadPrompts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [invokeTauri, isTauri, loadPrompts, name, prompt, t])

  const onSubmitEdit = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!editId) return
    if (!name.trim()) {
      toast.error(t('prompts.nameRequired'))
      return
    }
    if (!prompt.trim()) {
      toast.error(t('prompts.promptRequired'))
      return
    }
    setLoading(true)
    try {
      await invokeTauri('update_llm_prompt', {
        id: editId,
        name: name.trim(),
        promptMd: prompt,
      })
      toast.success(t('prompts.saved'))
      setShowEdit(false)
      setEditId(null)
      await loadPrompts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [editId, invokeTauri, isTauri, loadPrompts, name, prompt, t])

  const deletePrompt = useCallback(
    async (id: string) => {
      if (!isTauri) {
        toast.error(t('errors.notTauri'))
        return
      }
      if (!confirm(t('prompts.confirmDelete'))) return
      setLoading(true)
      try {
        await invokeTauri('delete_llm_prompt', { id })
        toast.success(t('prompts.deleted'))
        await loadPrompts()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [invokeTauri, isTauri, loadPrompts, t],
  )

  if (!isTauri) {
    return (
      <div className="analytics-page">
        <div className="analytics-card">
          <div className="analytics-card-title">{t('prompts.title')}</div>
          <div className="analytics-error">{t('errors.notTauri')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="analytics-page">
      <div className="analytics-card">
        <div className="refinery-card-header">
          <div className="analytics-card-title">{t('prompts.title')}</div>
          <div className="refinery-card-actions">
            <button className="btn btn-primary" type="button" onClick={openCreate} disabled={loading}>
              <Plus size={16} aria-hidden="true" />
              {t('prompts.newPrompt')}
            </button>
          </div>
        </div>

        {prompts.length === 0 ? (
          <div className="analytics-empty">{t('prompts.empty')}</div>
        ) : (
          <div className="analytics-table" role="table">
            <div className="analytics-row analytics-row-head agents-table-row" role="row">
              <div className="analytics-cell" role="columnheader">
                {t('prompts.name')}
              </div>
              <div className="analytics-cell" role="columnheader" style={{ textAlign: 'right' }}>
                {t('workRules.colActions')}
              </div>
            </div>
            {prompts.map((p) => {
              const firstLine = p.prompt_md
                .split('\n')
                .map((l) => l.trim())
                .find((l) => l.length > 0)
              return (
                <div
                  key={p.id}
                  className="analytics-row analytics-row-body agents-table-row"
                  role="row"
                  onDoubleClick={() => void openEdit(p.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="analytics-cell analytics-skill-cell" role="cell">
                    <div className="analytics-skill-name">{p.name}</div>
                    <div className="analytics-skill-id">{firstLine ?? t('prompts.noSummary')}</div>
                  </div>
                  <div className="analytics-cell agents-row-actions" role="cell">
                    <button
                      className="icon-btn"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void openEdit(p.id)
                      }}
                      title={t('workRules.edit')}
                      aria-label={t('workRules.edit')}
                      disabled={loading}
                    >
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-btn icon-btn-danger"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void deletePrompt(p.id)
                      }}
                      title={t('remove')}
                      aria-label={t('remove')}
                      disabled={loading}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showCreate ? (
        <div className="modal-backdrop" onClick={() => (loading ? null : closeCreate())}>
          <div className="modal modal-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{t('prompts.newPrompt')}</div>
              <button className="modal-close" type="button" onClick={closeCreate} aria-label={t('close')} disabled={loading}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="work-rules-editor-grid">
                <div className="work-rules-editor-left">
                  <div className="form-group">
                    <label className="label">{t('prompts.name')}</label>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="analysis-default" />
                  </div>
                </div>
                <div className="work-rules-editor-right">
                  <div className="form-group">
                    <label className="label">{t('prompts.prompt')}</label>
                    <div className="tabs">
                      <button className={`tab-item${promptTab === 'edit' ? ' active' : ''}`} type="button" onClick={() => setPromptTab('edit')} disabled={loading}>
                        {t('workRules.contentEditTab')}
                      </button>
                      <button className={`tab-item${promptTab === 'preview' ? ' active' : ''}`} type="button" onClick={() => setPromptTab('preview')} disabled={loading}>
                        {t('workRules.contentPreviewTab')}
                      </button>
                    </div>
                    {promptTab === 'edit' ? (
                      <textarea className="input" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={16} />
                    ) : (
                      <div className="markdown-preview">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {prompt.trim() ? prompt : t('workRules.previewEmpty')}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" type="button" onClick={closeCreate} disabled={loading}>
                  {t('cancel')}
                </button>
                <button className="btn btn-primary" type="button" onClick={() => void onSubmitCreate()} disabled={loading}>
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
              <div className="modal-title">{t('prompts.editPrompt')}</div>
              <button className="modal-close" type="button" onClick={closeEdit} aria-label={t('close')} disabled={loading}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="work-rules-editor-grid">
                <div className="work-rules-editor-left">
                  <div className="form-group">
                    <label className="label">{t('prompts.name')}</label>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                </div>
                <div className="work-rules-editor-right">
                  <div className="form-group">
                    <label className="label">{t('prompts.prompt')}</label>
                    <div className="tabs">
                      <button className={`tab-item${promptTab === 'edit' ? ' active' : ''}`} type="button" onClick={() => setPromptTab('edit')} disabled={loading}>
                        {t('workRules.contentEditTab')}
                      </button>
                      <button className={`tab-item${promptTab === 'preview' ? ' active' : ''}`} type="button" onClick={() => setPromptTab('preview')} disabled={loading}>
                        {t('workRules.contentPreviewTab')}
                      </button>
                    </div>
                    {promptTab === 'edit' ? (
                      <textarea className="input" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={16} />
                    ) : (
                      <div className="markdown-preview">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {prompt.trim() ? prompt : t('workRules.previewEmpty')}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" type="button" onClick={closeEdit} disabled={loading}>
                  {t('cancel')}
                </button>
                <button className="btn btn-primary" type="button" onClick={() => void onSubmitEdit()} disabled={loading}>
                  {t('workRules.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

