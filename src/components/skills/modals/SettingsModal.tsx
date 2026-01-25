import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'

type SettingsModalProps = {
  open: boolean
  isTauri: boolean
  language: string
  storagePath: string
  gitCacheCleanupDays: number
  gitCacheTtlSecs: number
  themePreference: 'system' | 'light' | 'dark'
  onPickStoragePath: () => void
  onToggleLanguage: () => void
  onThemeChange: (nextTheme: 'system' | 'light' | 'dark') => void
  onGitCacheCleanupDaysChange: (nextDays: number) => void
  onGitCacheTtlSecsChange: (nextSecs: number) => void
  onClearGitCacheNow: () => void
  onRequestClose: () => void
  t: TFunction
}

const SettingsModal = ({
  open,
  isTauri,
  language,
  storagePath,
  gitCacheCleanupDays,
  gitCacheTtlSecs,
  themePreference,
  onPickStoragePath,
  onToggleLanguage,
  onThemeChange,
  onGitCacheCleanupDaysChange,
  onGitCacheTtlSecsChange,
  onClearGitCacheNow,
  onRequestClose,
  t,
}: SettingsModalProps) => {
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const versionText = useMemo(() => {
    if (!isTauri) return t('notAvailable')
    if (!appVersion) return t('unknown')
    return `v${appVersion}`
  }, [appVersion, isTauri, t])

  const loadAppVersion = useCallback(async () => {
    if (!isTauri) {
      setAppVersion(null)
      return
    }
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      const v = await getVersion()
      setAppVersion(v)
    } catch {
      setAppVersion(null)
    }
  }, [isTauri])

  useEffect(() => {
    if (!open) {
      setAppVersion(null)
      return
    }
    void loadAppVersion()
  }, [loadAppVersion, open])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onRequestClose}>
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id="settings-title">
            {t('settings')}
          </div>
          <button
            className="modal-close"
            type="button"
            onClick={onRequestClose}
            aria-label={t('close')}
          >
            ✕
          </button>
        </div>
        <div className="modal-body settings-body">
          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-language">
              {t('interfaceLanguage')}
            </label>
            <div className="settings-select-wrap">
              <select
                id="settings-language"
                className="settings-select"
                value={language}
                onChange={(event) => {
                  if (event.target.value !== language) {
                    onToggleLanguage()
                  }
                }}
              >
                <option value="en">{t('languageOptions.en')}</option>
                <option value="zh">{t('languageOptions.zh')}</option>
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

          <div className="settings-field">
            <label className="settings-label" id="settings-theme-label">
              {t('themeMode')}
            </label>
            <div className="settings-theme-options" role="group" aria-labelledby="settings-theme-label">
              <button
                type="button"
                className={`settings-theme-btn ${
                  themePreference === 'system' ? 'active' : ''
                }`}
                aria-pressed={themePreference === 'system'}
                onClick={() => onThemeChange('system')}
              >
                {t('themeOptions.system')}
              </button>
              <button
                type="button"
                className={`settings-theme-btn ${
                  themePreference === 'light' ? 'active' : ''
                }`}
                aria-pressed={themePreference === 'light'}
                onClick={() => onThemeChange('light')}
              >
                {t('themeOptions.light')}
              </button>
              <button
                type="button"
                className={`settings-theme-btn ${
                  themePreference === 'dark' ? 'active' : ''
                }`}
                aria-pressed={themePreference === 'dark'}
                onClick={() => onThemeChange('dark')}
              >
                {t('themeOptions.dark')}
              </button>
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-storage">
              {t('skillsStoragePath')}
            </label>
            <div className="settings-input-row">
              <input
                id="settings-storage"
                className="settings-input mono"
                value={storagePath}
                readOnly
              />
              <button
                className="btn btn-secondary settings-browse"
                type="button"
                onClick={onPickStoragePath}
              >
                {t('browse')}
              </button>
            </div>
            <div className="settings-helper">{t('skillsStorageHint')}</div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-git-cache-days">
              {t('gitCacheCleanupDays')}
            </label>
            <div className="settings-input-row">
              <input
                id="settings-git-cache-days"
                className="settings-input"
                type="number"
                min={0}
                max={3650}
                step={1}
                value={gitCacheCleanupDays}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (!Number.isNaN(next)) {
                    onGitCacheCleanupDaysChange(next)
                  }
                }}
              />
              <button
                className="btn btn-secondary settings-browse"
                type="button"
                onClick={onClearGitCacheNow}
              >
                {t('cleanNow')}
              </button>
            </div>
            <div className="settings-helper">{t('gitCacheCleanupHint')}</div>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-git-cache-ttl">
              {t('gitCacheTtlSecs')}
            </label>
            <div className="settings-input-row">
              <input
                id="settings-git-cache-ttl"
                className="settings-input"
                type="number"
                min={0}
                max={3600}
                step={1}
                value={gitCacheTtlSecs}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (!Number.isNaN(next)) {
                    onGitCacheTtlSecsChange(next)
                  }
                }}
              />
            </div>
            <div className="settings-helper">{t('gitCacheTtlHint')}</div>
          </div>

          <div className="settings-version">
            {t('appName')} {versionText}
          </div>

        </div>
        <div className="modal-footer">
          <button className="btn btn-primary btn-full" onClick={onRequestClose}>
            {t('done')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default memo(SettingsModal)
