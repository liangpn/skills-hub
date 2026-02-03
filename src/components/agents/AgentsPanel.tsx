import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type LlmProvider = {
  id: string
  name: string
  provider_type: string
  base_url: string | null
  api_key_env: string | null
  api_key_configured: boolean
  default_model: string | null
  created_at_ms: number
  updated_at_ms: number
}

type LlmAgent = {
  id: string
  name: string
  provider_id: string
  model: string | null
  prompt_md: string
  prompt_id: string | null
  created_at_ms: number
  updated_at_ms: number
}

type LlmPrompt = {
  id: string
  name: string
  prompt_md: string
  created_at_ms: number
  updated_at_ms: number
}

type AgentsPanelProps = {
  isTauri: boolean
  invokeTauri: <T,>(command: string, args?: Record<string, unknown>) => Promise<T>
  t: TFunction
}

const providerTypeLabel = (t: TFunction, type: string) => {
  switch (type) {
    case 'openai':
      return t('agents.providerTypeOpenAI')
    case 'anthropic':
      return t('agents.providerTypeAnthropic')
    case 'gemini':
      return t('agents.providerTypeGemini')
    default:
      return type
  }
}

export default function AgentsPanel({ isTauri, invokeTauri, t }: AgentsPanelProps) {
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [prompts, setPrompts] = useState<LlmPrompt[]>([])
  const [agents, setAgents] = useState<LlmAgent[]>([])
  const [loading, setLoading] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [promptId, setPromptId] = useState('')

  const loadAll = useCallback(async () => {
    if (!isTauri) return
    setLoading(true)
    try {
      const [p, pr, a] = await Promise.all([
        invokeTauri<LlmProvider[]>('list_llm_providers'),
        invokeTauri<LlmPrompt[]>('list_llm_prompts'),
        invokeTauri<LlmAgent[]>('list_llm_agents'),
      ])
      setProviders(p)
      setPrompts(pr)
      setAgents(a)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [invokeTauri, isTauri])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const providerById = useMemo(() => {
    const map = new Map<string, LlmProvider>()
    for (const p of providers) map.set(p.id, p)
    return map
  }, [providers])

  const promptById = useMemo(() => {
    const map = new Map<string, LlmPrompt>()
    for (const p of prompts) map.set(p.id, p)
    return map
  }, [prompts])

  const openCreate = useCallback(() => {
    if (providers.length === 0) {
      toast.error(t('agents.noProviders'))
      return
    }
    if (prompts.length === 0) {
      toast.error(t('agents.noPrompts'))
      return
    }
    setName('')
    setProviderId(providers[0]?.id ?? '')
    setModel('')
    setPromptId(prompts[0]?.id ?? '')
    setShowCreate(true)
  }, [providers, prompts, t])

  const closeCreate = useCallback(() => setShowCreate(false), [])

  const openEdit = useCallback(
    async (id: string) => {
      if (!isTauri) {
        toast.error(t('errors.notTauri'))
        return
      }
      setLoading(true)
      try {
        const a = await invokeTauri<LlmAgent>('get_llm_agent', { id })
        setEditId(a.id)
        setName(a.name)
        setProviderId(a.provider_id)
        setModel(a.model ?? '')
        setPromptId(a.prompt_id ?? prompts[0]?.id ?? '')
        setShowEdit(true)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [invokeTauri, isTauri, prompts, t],
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
      toast.error(t('agents.agentNameRequired'))
      return
    }
    if (!providerId) {
      toast.error(t('agents.agentProviderRequired'))
      return
    }
    if (!promptId) {
      toast.error(t('agents.agentPromptRequired'))
      return
    }
    setLoading(true)
    try {
      await invokeTauri<LlmAgent>('create_llm_agent', {
        name: name.trim(),
        providerId,
        model: model.trim() ? model.trim() : null,
        promptId,
      })
      toast.success(t('agents.agentCreated'))
      setShowCreate(false)
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [invokeTauri, isTauri, loadAll, model, name, promptId, providerId, t])

  const onSubmitEdit = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!editId) return
    if (!name.trim()) {
      toast.error(t('agents.agentNameRequired'))
      return
    }
    if (!providerId) {
      toast.error(t('agents.agentProviderRequired'))
      return
    }
    if (!promptId) {
      toast.error(t('agents.agentPromptRequired'))
      return
    }
    setLoading(true)
    try {
      await invokeTauri('update_llm_agent', {
        id: editId,
        name: name.trim(),
        providerId,
        model: model.trim() ? model.trim() : null,
        promptId,
      })
      toast.success(t('agents.agentSaved'))
      setShowEdit(false)
      setEditId(null)
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [editId, invokeTauri, isTauri, loadAll, model, name, promptId, providerId, t])

  const deleteAgent = useCallback(
    async (id: string) => {
      if (!isTauri) {
        toast.error(t('errors.notTauri'))
        return
      }
      if (!confirm(t('agents.confirmDeleteAgent'))) return
      setLoading(true)
      try {
        await invokeTauri('delete_llm_agent', { id })
        toast.success(t('agents.agentDeleted'))
        await loadAll()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [invokeTauri, isTauri, loadAll, t],
  )

  if (!isTauri) {
    return (
      <div className="analytics-page">
        <div className="analytics-card">
          <div className="analytics-card-title">{t('agents.title')}</div>
          <div className="analytics-error">{t('errors.notTauri')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="analytics-page">
      <div className="analytics-card">
          <div className="refinery-card-header">
            <div className="analytics-card-title">{t('agents.agentsTitle')}</div>
            <div className="refinery-card-actions">
            <button className="btn btn-primary" type="button" onClick={openCreate} disabled={loading}>
              <Plus size={16} aria-hidden="true" />
              {t('agents.newAgent')}
            </button>
          </div>
        </div>

        {agents.length === 0 ? (
          <div className="analytics-empty">
            {t('agents.agentsEmpty')}
            {providers.length === 0 ? (
              <div className="analytics-skill-id">{t('agents.noProviders')}</div>
            ) : null}
          </div>
        ) : (
          <div className="analytics-table" role="table">
            <div className="analytics-row analytics-row-head agents-table-row" role="row">
              <div className="analytics-cell" role="columnheader">
                {t('agents.agentName')}
              </div>
              <div className="analytics-cell" role="columnheader" style={{ textAlign: 'right' }}>
                {t('workRules.colActions')}
              </div>
            </div>
            {agents.map((a) => {
              const p = providerById.get(a.provider_id)
              const pLabel = p ? `${p.name} (${providerTypeLabel(t, p.provider_type)})` : a.provider_id
              const m = a.model ?? p?.default_model ?? ''
              const pr = a.prompt_id ? promptById.get(a.prompt_id) : null
              const prLabel = pr ? pr.name : a.prompt_id ?? ''
              return (
                <div
                  key={a.id}
                  className="analytics-row analytics-row-body agents-table-row"
                  role="row"
                  onDoubleClick={() => void openEdit(a.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="analytics-cell analytics-skill-cell" role="cell">
                    <div className="analytics-skill-name">{a.name}</div>
                    <div className="analytics-skill-id">
                      {pLabel}
                      {m ? ` · ${m}` : ''}
                      {prLabel ? ` · ${prLabel}` : ''}
                    </div>
                  </div>
                  <div className="analytics-cell agents-row-actions" role="cell">
                    <button
                      className="icon-btn"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void openEdit(a.id)
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
                        void deleteAgent(a.id)
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
              <div className="modal-title">{t('agents.newAgent')}</div>
              <button className="modal-close" type="button" onClick={closeCreate} aria-label={t('close')} disabled={loading}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="work-rules-editor-grid">
                <div className="work-rules-editor-left">
                  <div className="form-group">
                    <label className="label">{t('agents.agentName')}</label>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-agent" />
                  </div>
                  <div className="form-group">
                    <label className="label">{t('agents.agentProvider')}</label>
                    <select className="input" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                      {providers.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name} ({providerTypeLabel(t, p.provider_type)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">{t('agents.agentModel')}</label>
                    <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('agents.agentModelPlaceholder')} />
                  </div>
                  <div className="form-group">
                    <label className="label">{t('agents.agentPrompt')}</label>
                    <select className="input" value={promptId} onChange={(e) => setPromptId(e.target.value)}>
                      {prompts.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="work-rules-editor-right">
                  <div className="form-group">
                    <label className="label">{t('workRules.contentPreviewTab')}</label>
                    <div className="markdown-preview">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {promptId && promptById.get(promptId)?.prompt_md
                          ? promptById.get(promptId)?.prompt_md
                          : t('workRules.previewEmpty')}
                      </ReactMarkdown>
                    </div>
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
              <div className="modal-title">{t('agents.editAgent')}</div>
              <button className="modal-close" type="button" onClick={closeEdit} aria-label={t('close')} disabled={loading}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="work-rules-editor-grid">
                <div className="work-rules-editor-left">
                  <div className="form-group">
                    <label className="label">{t('agents.agentName')}</label>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="label">{t('agents.agentProvider')}</label>
                    <select className="input" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                      {providers.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name} ({providerTypeLabel(t, p.provider_type)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">{t('agents.agentModel')}</label>
                    <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('agents.agentModelPlaceholder')} />
                  </div>
                  <div className="form-group">
                    <label className="label">{t('agents.agentPrompt')}</label>
                    <select className="input" value={promptId} onChange={(e) => setPromptId(e.target.value)}>
                      {prompts.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="work-rules-editor-right">
                  <div className="form-group">
                    <label className="label">{t('workRules.contentPreviewTab')}</label>
                    <div className="markdown-preview">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {promptId && promptById.get(promptId)?.prompt_md
                          ? promptById.get(promptId)?.prompt_md
                          : t('workRules.previewEmpty')}
                      </ReactMarkdown>
                    </div>
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
