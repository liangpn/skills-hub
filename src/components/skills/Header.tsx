import { memo } from 'react'
import { Plus, Settings } from 'lucide-react'
import type { TFunction } from 'i18next'

type HeaderProps = {
  language: string
  loading: boolean
  onToggleLanguage: () => void
  onOpenSettings: () => void
  onOpenAdd: () => void
  t: TFunction
}

const Header = ({
  language,
  loading,
  onToggleLanguage,
  onOpenSettings,
  onOpenAdd,
  t,
}: HeaderProps) => {
  return (
    <header className="skills-header">
      <div className="brand-area">
        <img className="logo-icon" src="/logo.png" alt="" />
        <div className="brand-text-wrap">
          <div className="brand-text">{t('appName')}</div>
          <div className="brand-subtitle">{t('subtitle')}</div>
        </div>
      </div>
      <div className="header-actions">
        <button className="lang-btn" type="button" onClick={onToggleLanguage}>
          {language === 'en' ? t('languageShort.en') : t('languageShort.zh')}
        </button>
        <button className="icon-btn" type="button" onClick={onOpenSettings}>
          <Settings size={18} />
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={onOpenAdd}
          disabled={loading}
        >
          <Plus size={16} />
          {t('newSkill')}
        </button>
      </div>
    </header>
  )
}

export default memo(Header)
