import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import { RefreshCw, Trash2 } from 'lucide-react'
import type {
  ClearCodexAnalyticsResult,
  CodexAnalyticsConfig,
  CodexSessionDay,
  CodexScanStats,
  SkillUsageLeaderboardRow,
  SkillUsageProjectRow,
} from './types'

type CodexAnalyticsPanelProps = {
  invokeTauri: <T,>(command: string, args?: Record<string, unknown>) => Promise<T>
  t: TFunction
}

const MIN_INTERVAL_SECS = 300

const formatRelative = (t: TFunction, ms: number | null | undefined) => {
  if (!ms) return t('relative.empty')
  const diff = Date.now() - ms
  if (diff < 0) return t('relative.empty')
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('relative.justNow')
  if (minutes < 60) {
    return t('relative.minutesAgo', { minutes })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return t('relative.hoursAgo', { hours })
  }
  const days = Math.floor(hours / 24)
  return t('relative.daysAgo', { days })
}

const CodexAnalyticsPanel = ({ invokeTauri, t }: CodexAnalyticsPanelProps) => {
  const [config, setConfig] = useState<CodexAnalyticsConfig | null>(null)
  const [range, setRange] = useState<'24h' | '7d' | 'all'>('24h')
  const [leaderboard, setLeaderboard] = useState<SkillUsageLeaderboardRow[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [details, setDetails] = useState<SkillUsageProjectRow[]>([])
  const [scanStats, setScanStats] = useState<CodexScanStats | null>(null)
  const [clearResult, setClearResult] = useState<ClearCodexAnalyticsResult | null>(null)
  const [availableDays, setAvailableDays] = useState<CodexSessionDay[]>([])
  const [selectedDays, setSelectedDays] = useState<Record<string, boolean>>({})
  const [loadingDays, setLoadingDays] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [loadingScan, setLoadingScan] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sinceMs = useMemo(() => {
    const now = Date.now()
    if (range === '24h') return now - 24 * 60 * 60 * 1000
    if (range === '7d') return now - 7 * 24 * 60 * 60 * 1000
    return null
  }, [range])

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true)
    setError(null)
    try {
      const cfg = await invokeTauri<CodexAnalyticsConfig>('get_codex_analytics_config')
      setConfig(cfg)
      return cfg
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setConfig(null)
      return null
    } finally {
      setLoadingConfig(false)
    }
  }, [invokeTauri])

  const loadLeaderboard = useCallback(async () => {
    setError(null)
    try {
      const rows = await invokeTauri<SkillUsageLeaderboardRow[]>('get_codex_leaderboard', {
        sinceMs: sinceMs ?? undefined,
        limit: 200,
      })
      setLeaderboard(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLeaderboard([])
    }
  }, [invokeTauri, sinceMs])

  const loadDetails = useCallback(
    async (skillId: string) => {
      setError(null)
      try {
        const rows = await invokeTauri<SkillUsageProjectRow[]>(
          'get_codex_skill_usage_details',
          {
            skillId,
            sinceMs: sinceMs ?? undefined,
          },
        )
        setDetails(rows)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setDetails([])
      }
    },
    [invokeTauri, sinceMs],
  )

  const updateConfig = useCallback(
    async (patch: Partial<CodexAnalyticsConfig>) => {
      if (!config) return
      setError(null)
      const next: CodexAnalyticsConfig = { ...config, ...patch }
      try {
        const saved = await invokeTauri<CodexAnalyticsConfig>('set_codex_analytics_config', {
          config: next,
        })
        setConfig(saved)
        return saved
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return null
      }
    },
    [config, invokeTauri],
  )

  const scanNow = useCallback(async () => {
    setLoadingScan(true)
    setError(null)
    setClearResult(null)
    try {
      const stats = await invokeTauri<CodexScanStats>('scan_codex_analytics_now')
      setScanStats(stats)
      await loadConfig()
      await loadLeaderboard()
      if (selectedSkillId) {
        await loadDetails(selectedSkillId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingScan(false)
    }
  }, [invokeTauri, loadConfig, loadDetails, loadLeaderboard, selectedSkillId])

  const loadSessionDays = useCallback(async () => {
    setLoadingDays(true)
    setError(null)
    try {
      const days = await invokeTauri<CodexSessionDay[]>('list_codex_session_days')
      setAvailableDays(days)
      setSelectedDays((prev) => {
        const next: Record<string, boolean> = {}
        days.forEach((d) => {
          if (prev[d.day]) next[d.day] = true
        })
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setAvailableDays([])
    } finally {
      setLoadingDays(false)
    }
  }, [invokeTauri])

  const selectedDayRows = useMemo(
    () => availableDays.filter((d) => Boolean(selectedDays[d.day])),
    [availableDays, selectedDays],
  )
  const selectedDayCount = selectedDayRows.length
  const selectedFileCount = useMemo(
    () => selectedDayRows.reduce((sum, d) => sum + d.files, 0),
    [selectedDayRows],
  )

  const backfillSelectedDays = useCallback(async () => {
    if (!config?.enabled) return
    const days = selectedDayRows.map((d) => d.day)
    if (days.length === 0) {
      setError(t('analytics.backfillSelectHint'))
      return
    }
    setLoadingScan(true)
    setError(null)
    setClearResult(null)
    try {
      const stats = await invokeTauri<CodexScanStats>('backfill_codex_analytics', { days })
      setScanStats(stats)
      await loadConfig()
      await loadLeaderboard()
      if (selectedSkillId) {
        await loadDetails(selectedSkillId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingScan(false)
    }
  }, [
    config?.enabled,
    invokeTauri,
    loadConfig,
    loadDetails,
    loadLeaderboard,
    selectedDayRows,
    selectedSkillId,
    t,
  ])

  const clearData = useCallback(async () => {
    setLoadingScan(true)
    setError(null)
    setScanStats(null)
    try {
      const result =
        await invokeTauri<ClearCodexAnalyticsResult>('clear_codex_analytics')
      setClearResult(result)
      setSelectedSkillId(null)
      setDetails([])
      await loadConfig()
      await loadLeaderboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingScan(false)
    }
  }, [invokeTauri, loadConfig, loadLeaderboard])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  useEffect(() => {
    // Range change: reload leaderboard and details (if any).
    void loadLeaderboard()
    if (selectedSkillId) {
      void loadDetails(selectedSkillId)
    }
  }, [loadDetails, loadLeaderboard, selectedSkillId, sinceMs])

  useEffect(() => {
    if (!config?.enabled) return
    const intervalSecs = Math.max(MIN_INTERVAL_SECS, config.interval_secs)
    const handle = window.setInterval(() => {
      void scanNow()
    }, intervalSecs * 1000)
    return () => window.clearInterval(handle)
  }, [config?.enabled, config?.interval_secs, scanNow])

  const minutes = config ? Math.round(config.interval_secs / 60) : 5

  const statusText = useMemo(() => {
    if (loadingConfig) return t('analytics.loading')
    if (!config?.enabled) return t('analytics.disabledHint')
    if (scanStats) {
      return t('analytics.scanSummary', {
        files: scanStats.scanned_files,
        lines: scanStats.processed_lines,
        events: scanStats.new_events,
        errors: scanStats.parse_errors,
      })
    }
    if (clearResult) {
      return t('analytics.clearSummary', { count: clearResult.deleted_events })
    }
    const last = config?.last_scan_ms
    if (last) return t('analytics.lastScan', { when: formatRelative(t, last) })
    return t('analytics.lastScanNever')
  }, [clearResult, config, loadingConfig, scanStats, t])

  return (
    <div className="analytics-page">
      <div className="analytics-grid">
        <section className="analytics-card">
          <div className="analytics-card-title">{t('analytics.settingsTitle')}</div>
          <div className="settings-list analytics-settings-list">
            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-title">
                  {t('analytics.enableTitle')}
                </div>
                <div className="settings-item-desc">
                  {t('analytics.enableDesc')}
                </div>
              </div>
              <button
                type="button"
                className={`settings-toggle ${config?.enabled ? 'checked' : ''}`}
                aria-pressed={Boolean(config?.enabled)}
                onClick={() => void updateConfig({ enabled: !config?.enabled })}
                disabled={!config}
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-title">
                  {t('analytics.intervalTitle')}
                </div>
                <div className="settings-item-desc">
                  {t('analytics.intervalDesc')}
                </div>
              </div>
              <div className="analytics-inline-input">
                <input
                  className="settings-input"
                  type="number"
                  min={5}
                  max={1440}
                  step={1}
                  value={minutes}
                  onChange={(event) => {
                    const nextMinutes = Number(event.target.value)
                    if (Number.isNaN(nextMinutes)) return
                    const next = Math.max(5, nextMinutes) * 60
                    void updateConfig({ interval_secs: next })
                  }}
                  disabled={!config}
                />
                <span className="analytics-inline-suffix">{t('analytics.minutes')}</span>
              </div>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-title">
                  {t('analytics.projectModeTitle')}
                </div>
                <div className="settings-item-desc">
                  {t('analytics.projectModeDesc')}
                </div>
              </div>
              <div className="settings-select-wrap analytics-select-wrap">
                <select
                  className="settings-select"
                  value={config?.project_mode ?? 'git_root_or_workdir'}
                  onChange={(event) => {
                    const value = event.target.value as CodexAnalyticsConfig['project_mode']
                    void updateConfig({ project_mode: value })
                  }}
                  disabled={!config}
                >
                  <option value="git_root_or_workdir">
                    {t('analytics.projectModeGit')}
                  </option>
                  <option value="workdir">{t('analytics.projectModeWorkdir')}</option>
                </select>
                <svg
                  className="settings-select-caret"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-title">
                  {t('analytics.retentionTitle')}
                </div>
                <div className="settings-item-desc">
                  {t('analytics.retentionDesc')}
                </div>
              </div>
              <button
                type="button"
                className={`settings-toggle ${config?.retention_enabled ? 'checked' : ''}`}
                aria-pressed={Boolean(config?.retention_enabled)}
                onClick={() =>
                  void updateConfig({
                    retention_enabled: !config?.retention_enabled,
                  })
                }
                disabled={!config}
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <div className="settings-item-title">
                  {t('analytics.retentionDaysTitle')}
                </div>
                <div className="settings-item-desc">
                  {t('analytics.retentionDaysDesc')}
                </div>
              </div>
              <div className="analytics-inline-input">
                <input
                  className="settings-input"
                  type="number"
                  min={0}
                  max={3650}
                  step={1}
                  value={config?.retention_days ?? 30}
                  onChange={(event) => {
                    const nextDays = Number(event.target.value)
                    if (Number.isNaN(nextDays)) return
                    void updateConfig({ retention_days: Math.max(0, nextDays) })
                  }}
                  disabled={!config}
                />
                <span className="analytics-inline-suffix">{t('analytics.days')}</span>
              </div>
            </div>
          </div>

          <div className="analytics-actions">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => void scanNow()}
              disabled={loadingScan || !config?.enabled}
              title={!config?.enabled ? t('analytics.scanDisabled') : undefined}
            >
              <RefreshCw size={16} />
              {t('scanNow')}
            </button>
            <button
              className="btn btn-danger"
              type="button"
              onClick={() => void clearData()}
              disabled={loadingScan}
            >
              <Trash2 size={16} />
              {t('analytics.clearData')}
            </button>
          </div>

          <div className="analytics-status-row">
            <div className="settings-helper">{statusText}</div>
            {config?.last_scan_ms ? (
              <div className="settings-helper">
                {t('analytics.lastScanAt', {
                  when: new Date(config.last_scan_ms).toLocaleString(),
                })}
              </div>
            ) : null}
            {scanStats ? (
              <div className="settings-helper">
                {t('analytics.scanDebug', {
                  matched: scanStats.matched_use_skill,
                  skipped: scanStats.skipped_skill_not_found,
                  dups: scanStats.duplicate_events,
                })}
              </div>
            ) : null}
          </div>

          <div className="analytics-backfill">
            <div className="analytics-backfill-head">
              <div className="analytics-backfill-title">
                {t('analytics.backfillTitle')}
              </div>
              <div className="analytics-backfill-actions">
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => void loadSessionDays()}
                  disabled={loadingDays || loadingScan || !config?.enabled}
                  title={!config?.enabled ? t('analytics.backfillDisabled') : undefined}
                >
                  {t('analytics.backfillLoadDays')}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = {}
                    availableDays.forEach((d) => {
                      next[d.day] = true
                    })
                    setSelectedDays(next)
                  }}
                  disabled={availableDays.length === 0 || loadingScan}
                >
                  {t('analytics.backfillSelectAll')}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setSelectedDays({})}
                  disabled={selectedDayCount === 0 || loadingScan}
                >
                  {t('analytics.backfillClear')}
                </button>
              </div>
            </div>

            <div className="settings-helper">{t('analytics.backfillDesc')}</div>
            {availableDays.length === 0 ? (
              <div className="settings-helper">{t('analytics.backfillNoDays')}</div>
            ) : (
              <div className="analytics-backfill-days">
                {availableDays.map((d) => (
                  <label key={d.day} className="analytics-backfill-day">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedDays[d.day])}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setSelectedDays((prev) => ({ ...prev, [d.day]: checked }))
                      }}
                    />
                    <span className="analytics-backfill-day-label mono">{d.day}</span>
                    <span className="analytics-backfill-day-meta mono">
                      {d.files}
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="analytics-backfill-footer">
              <div className="settings-helper">
                {t('analytics.backfillSelectedSummary', {
                  days: selectedDayCount,
                  files: selectedFileCount,
                })}
              </div>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => void backfillSelectedDays()}
                disabled={
                  loadingScan ||
                  !config?.enabled ||
                  availableDays.length === 0 ||
                  selectedDayCount === 0
                }
                title={!config?.enabled ? t('analytics.backfillDisabled') : undefined}
              >
                {t('analytics.backfillRun')}
              </button>
            </div>
          </div>

          <div className="analytics-note">
            <div className="analytics-note-title">{t('analytics.howItWorksTitle')}</div>
            <ul className="analytics-note-list">
              <li>{t('analytics.howItWorks1')}</li>
              <li>{t('analytics.howItWorks2')}</li>
              <li>{t('analytics.howItWorks5')}</li>
              <li>{t('analytics.howItWorks3')}</li>
              <li>{t('analytics.howItWorks4')}</li>
            </ul>
          </div>
        </section>

        <section className="analytics-card">
          <div className="analytics-card-title">{t('analytics.leaderboardTitle')}</div>
          <div className="analytics-range-row">
            <div className="analytics-range-label">{t('analytics.rangeTitle')}</div>
            <div className="analytics-range-tabs" role="tablist">
              <button
                type="button"
                className={`analytics-range-tab ${
                  range === '24h' ? 'active' : ''
                }`}
                aria-selected={range === '24h'}
                onClick={() => setRange('24h')}
              >
                {t('analytics.range24h')}
              </button>
              <button
                type="button"
                className={`analytics-range-tab ${range === '7d' ? 'active' : ''}`}
                aria-selected={range === '7d'}
                onClick={() => setRange('7d')}
              >
                {t('analytics.range7d')}
              </button>
              <button
                type="button"
                className={`analytics-range-tab ${
                  range === 'all' ? 'active' : ''
                }`}
                aria-selected={range === 'all'}
                onClick={() => setRange('all')}
              >
                {t('analytics.rangeAll')}
              </button>
            </div>
          </div>

          <div className="analytics-table">
            <div className="analytics-row analytics-row-head">
              <div className="analytics-cell">{t('analytics.colSkill')}</div>
              <div className="analytics-cell">{t('analytics.colCalls')}</div>
              <div className="analytics-cell">{t('analytics.colProjects')}</div>
              <div className="analytics-cell">{t('analytics.colTools')}</div>
              <div className="analytics-cell">{t('analytics.colLastUsed')}</div>
            </div>
            {leaderboard.length === 0 ? (
              <div className="empty analytics-empty">{t('analytics.noData')}</div>
            ) : (
              leaderboard.map((row) => (
                <button
                  key={row.skill_id}
                  type="button"
                  className={`analytics-row analytics-row-body ${
                    selectedSkillId === row.skill_id ? 'selected' : ''
                  }`}
                  onClick={() => {
                    setSelectedSkillId(row.skill_id)
                    void loadDetails(row.skill_id)
                  }}
                >
                  <div className="analytics-cell analytics-skill-cell">
                    <div className="analytics-skill-name">
                      {row.skill_name}
                      {row.skill_id.startsWith('.system/') ? (
                        <span className="analytics-badge">
                          {t('analytics.badgeSystem')}
                        </span>
                      ) : null}
                    </div>
                    <div className="analytics-skill-id mono">{row.skill_id}</div>
                  </div>
                  <div className="analytics-cell mono">{row.calls}</div>
                  <div className="analytics-cell mono">{row.projects}</div>
                  <div className="analytics-cell mono">{row.tools}</div>
                  <div className="analytics-cell">{formatRelative(t, row.last_ts_ms)}</div>
                </button>
              ))
            )}
          </div>

          {selectedSkillId ? (
            <div className="analytics-details">
              <div className="analytics-details-title">
                {t('analytics.detailsTitle')}
              </div>
              {details.length === 0 ? (
                <div className="empty analytics-empty">{t('analytics.noDetails')}</div>
              ) : (
                <div className="analytics-details-table">
                  <div className="analytics-details-row analytics-details-head">
                    <div className="analytics-details-cell">
                      {t('analytics.colProject')}
                    </div>
                    <div className="analytics-details-cell">
                      {t('analytics.colCalls')}
                    </div>
                    <div className="analytics-details-cell">
                      {t('analytics.colLastUsed')}
                    </div>
                  </div>
                  {details.map((d) => (
                    <div
                      key={d.project_path}
                      className="analytics-details-row analytics-details-body"
                    >
                      <div className="analytics-details-cell mono">
                        {d.project_path}
                      </div>
                      <div className="analytics-details-cell mono">{d.calls}</div>
                      <div className="analytics-details-cell">
                        {formatRelative(t, d.last_ts_ms)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {error ? <div className="error analytics-error">{error}</div> : null}
        </section>
      </div>
    </div>
  )
}

export default memo(CodexAnalyticsPanel)
