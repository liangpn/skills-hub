import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'

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

type ProvidersPanelProps = {
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

export default function ProvidersPanel({ isTauri, invokeTauri, t }: ProvidersPanelProps) {
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [loading, setLoading] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [providerType, setProviderType] = useState<'openai' | 'anthropic' | 'gemini'>('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [apiKeyEnv, setApiKeyEnv] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const loadProviders = useCallback(async () => {
    if (!isTauri) return
    setLoading(true)
    try {
      const list = await invokeTauri<LlmProvider[]>('list_llm_providers')
      setProviders(list)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [invokeTauri, isTauri])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  const openCreate = useCallback(() => {
    setName('')
    setProviderType('openai')
    setBaseUrl('')
    setApiKey('')
    setClearApiKey(false)
    setApiKeyEnv('')
    setDefaultModel('')
    setApiKeyConfigured(false)
    setShowAdvanced(false)
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
        const p = await invokeTauri<LlmProvider>('get_llm_provider', { id })
        setEditId(p.id)
        setName(p.name)
        setProviderType((p.provider_type as 'openai' | 'anthropic' | 'gemini') ?? 'openai')
        setBaseUrl(p.base_url ?? '')
        setApiKey('')
        setClearApiKey(false)
        setApiKeyEnv(p.api_key_env ?? '')
        setDefaultModel(p.default_model ?? '')
        setApiKeyConfigured(Boolean(p.api_key_configured))
        setShowAdvanced(false)
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
      toast.error(t('agents.providerNameRequired'))
      return
    }
    setLoading(true)
    try {
      await invokeTauri<LlmProvider>('create_llm_provider', {
        name: name.trim(),
        providerType,
        baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
        apiKey: apiKey.trim() ? apiKey.trim() : null,
        apiKeyEnv: apiKeyEnv.trim() ? apiKeyEnv.trim() : null,
        defaultModel: defaultModel.trim() ? defaultModel.trim() : null,
      })
      toast.success(t('agents.providerCreated'))
      setShowCreate(false)
      await loadProviders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [
    apiKey,
    apiKeyEnv,
    baseUrl,
    defaultModel,
    invokeTauri,
    isTauri,
    loadProviders,
    name,
    providerType,
    t,
  ])

  const onSubmitEdit = useCallback(async () => {
    if (!isTauri) {
      toast.error(t('errors.notTauri'))
      return
    }
    if (!editId) return
    if (!name.trim()) {
      toast.error(t('agents.providerNameRequired'))
      return
    }
    setLoading(true)
    try {
      await invokeTauri('update_llm_provider', {
        id: editId,
        name: name.trim(),
        providerType,
        baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
        apiKey: clearApiKey ? '' : apiKey.trim() ? apiKey.trim() : null,
        apiKeyEnv: apiKeyEnv.trim() ? apiKeyEnv.trim() : null,
        defaultModel: defaultModel.trim() ? defaultModel.trim() : null,
      })
      toast.success(t('agents.providerSaved'))
      setShowEdit(false)
      setEditId(null)
      await loadProviders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [
    apiKey,
    apiKeyEnv,
    baseUrl,
    clearApiKey,
    defaultModel,
    editId,
    invokeTauri,
    isTauri,
    loadProviders,
    name,
    providerType,
    t,
  ])

  const deleteProvider = useCallback(
    async (id: string) => {
      if (!isTauri) {
        toast.error(t('errors.notTauri'))
        return
      }
      if (!confirm(t('agents.confirmDeleteProvider'))) return
      setLoading(true)
      try {
        await invokeTauri('delete_llm_provider', { id })
        toast.success(t('agents.providerDeleted'))
        await loadProviders()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [invokeTauri, isTauri, loadProviders, t],
  )

  const providersBody = useMemo(() => {
    if (providers.length === 0) {
      return <div className="analytics-empty">{t('agents.providersEmpty')}</div>
    }
    return (
      <div className="analytics-table" role="table">
        <div className="analytics-row analytics-row-head agents-table-row" role="row">
          <div className="analytics-cell" role="columnheader">
            {t('agents.providerName')}
          </div>
          <div className="analytics-cell" role="columnheader" style={{ textAlign: 'right' }}>
            {t('workRules.colActions')}
          </div>
        </div>
        {providers.map((p) => (
          <div
            key={p.id}
            className="analytics-row analytics-row-body agents-table-row"
            role="row"
            onDoubleClick={() => void openEdit(p.id)}
            style={{ cursor: 'pointer' }}
          >
            <div className="analytics-cell analytics-skill-cell" role="cell">
              <div className="analytics-skill-name">{p.name}</div>
	              <div className="analytics-skill-id">
	                {providerTypeLabel(t, p.provider_type)}
	                {p.base_url ? ` · ${p.base_url}` : ''}
	                {p.default_model ? ` · ${p.default_model}` : ''}
	                {p.api_key_configured ? ` · ${t('agents.providerKeyConfigured')}` : ''}
	              </div>
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
                  void deleteProvider(p.id)
                }}
                title={t('remove')}
                aria-label={t('remove')}
                disabled={loading}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
    )
  }, [deleteProvider, loading, openEdit, providers, t])

  if (!isTauri) {
    return (
      <div className="analytics-page">
        <div className="analytics-card">
          <div className="analytics-card-title">{t('agents.providersTitle')}</div>
          <div className="analytics-error">{t('errors.notTauri')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="analytics-page">
      <div className="analytics-card">
        <div className="refinery-card-header">
          <div className="analytics-card-title">{t('agents.providersTitle')}</div>
          <div className="refinery-card-actions">
            <button className="btn btn-primary" type="button" onClick={openCreate} disabled={loading}>
              <Plus size={16} aria-hidden="true" />
              {t('agents.newProvider')}
            </button>
          </div>
        </div>
        {providersBody}
      </div>

      {showCreate ? (
        <div className="modal-backdrop" onClick={() => (loading ? null : closeCreate())}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{t('agents.newProvider')}</div>
              <button className="modal-close" type="button" onClick={closeCreate} aria-label={t('close')} disabled={loading}>
                ✕
              </button>
            </div>
	            <div className="modal-body">
              <div className="form-group">
                <label className="label">{t('agents.providerName')}</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-provider" />
              </div>
              <div className="form-group">
                <label className="label">{t('agents.providerType')}</label>
                <select className="input" value={providerType} onChange={(e) => setProviderType(e.target.value as typeof providerType)}>
                  <option value="openai">{t('agents.providerTypeOpenAI')}</option>
                  <option value="anthropic">{t('agents.providerTypeAnthropic')}</option>
                  <option value="gemini">{t('agents.providerTypeGemini')}</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">{t('agents.providerBaseUrl')}</label>
                <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
              </div>
	              <div className="form-group">
	                <label className="label">{t('agents.providerApiKey')}</label>
	                <input
	                  className="input"
	                  type="password"
	                  value={apiKey}
	                  onChange={(e) => setApiKey(e.target.value)}
	                  placeholder="sk-..."
	                />
	                <div className="helper-text">{t('agents.providerApiKeyHint')}</div>
	              </div>
	              <button
	                className="btn btn-secondary"
	                type="button"
	                onClick={() => setShowAdvanced((v) => !v)}
	                style={{ marginBottom: 12 }}
	              >
	                {showAdvanced ? t('agents.hideAdvanced') : t('agents.showAdvanced')}
	              </button>
	              {showAdvanced ? (
	                <div className="form-group">
	                <label className="label">{t('agents.providerApiKeyEnv')}</label>
	                <input className="input" value={apiKeyEnv} onChange={(e) => setApiKeyEnv(e.target.value)} placeholder="OPENAI_API_KEY" />
	                <div className="helper-text">{t('agents.envHint')}</div>
	              </div>
	              ) : null}
	              <div className="form-group">
	                <label className="label">{t('agents.providerDefaultModel')}</label>
	                <input className="input" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder="gpt-4o-mini" />
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
      ) : null}

      {showEdit ? (
        <div className="modal-backdrop" onClick={() => (loading ? null : closeEdit())}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{t('agents.editProvider')}</div>
              <button className="modal-close" type="button" onClick={closeEdit} aria-label={t('close')} disabled={loading}>
                ✕
              </button>
            </div>
	            <div className="modal-body">
              <div className="form-group">
                <label className="label">{t('agents.providerName')}</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">{t('agents.providerType')}</label>
                <select className="input" value={providerType} onChange={(e) => setProviderType(e.target.value as typeof providerType)}>
                  <option value="openai">{t('agents.providerTypeOpenAI')}</option>
                  <option value="anthropic">{t('agents.providerTypeAnthropic')}</option>
                  <option value="gemini">{t('agents.providerTypeGemini')}</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">{t('agents.providerBaseUrl')}</label>
                <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </div>
	              <div className="form-group">
	                <label className="label">{t('agents.providerApiKey')}</label>
	                <input
	                  className="input"
	                  type="password"
	                  value={apiKey}
	                  onChange={(e) => {
	                    setApiKey(e.target.value)
	                    setClearApiKey(false)
	                  }}
	                  placeholder={apiKeyConfigured ? '••••••••' : 'sk-...'}
	                />
	                <div className="helper-text">
	                  {apiKeyConfigured ? t('agents.providerApiKeyHintConfigured') : t('agents.providerApiKeyHint')}
	                </div>
	                {apiKeyConfigured ? (
	                  <label className="inline-checkbox" style={{ marginTop: 8 }}>
	                    <input
	                      type="checkbox"
	                      checked={clearApiKey}
	                      onChange={(e) => {
	                        setClearApiKey(e.target.checked)
	                        if (e.target.checked) setApiKey('')
	                      }}
	                    />
	                    {t('agents.providerApiKeyClear')}
	                  </label>
	                ) : null}
	              </div>
	              <button
	                className="btn btn-secondary"
	                type="button"
	                onClick={() => setShowAdvanced((v) => !v)}
	                style={{ marginBottom: 12 }}
	              >
	                {showAdvanced ? t('agents.hideAdvanced') : t('agents.showAdvanced')}
	              </button>
	              {showAdvanced ? (
	                <div className="form-group">
	                  <label className="label">{t('agents.providerApiKeyEnv')}</label>
	                  <input className="input" value={apiKeyEnv} onChange={(e) => setApiKeyEnv(e.target.value)} />
	                  <div className="helper-text">{t('agents.envHint')}</div>
	                </div>
	              ) : null}
	              <div className="form-group">
	                <label className="label">{t('agents.providerDefaultModel')}</label>
	                <input className="input" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} />
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
      ) : null}
    </div>
  )
}
