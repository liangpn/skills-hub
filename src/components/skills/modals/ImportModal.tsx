import { memo } from 'react'
import { Download } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { OnboardingPlan } from '../types'

type ImportModalProps = {
  open: boolean
  loading: boolean
  plan: OnboardingPlan
  selected: Record<string, boolean>
  variantChoice: Record<string, string>
  onRequestClose: () => void
  onToggleAll: (checked: boolean) => void
  onToggleGroup: (groupName: string, checked: boolean) => void
  onSelectVariant: (groupName: string, path: string) => void
  onImport: () => void
  t: TFunction
}

const ImportModal = ({
  open,
  loading,
  plan,
  selected,
  variantChoice,
  onRequestClose,
  onToggleAll,
  onToggleGroup,
  onSelectVariant,
  onImport,
  t,
}: ImportModalProps) => {
  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onRequestClose}>
      <div
        className="modal modal-lg modal-discovered"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">{t('importTitle')}</div>
          <button
            className="modal-close"
            type="button"
            onClick={onRequestClose}
            aria-label={t('close')}
          >
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="import-summary">
            <div>{t('importSummary')}</div>
            <div className="import-metrics">
              <span>{t('toolsScanned', { count: plan.total_tools_scanned })}</span>
              <span>{t('skillsFound', { count: plan.total_skills_found })}</span>
            </div>
          </div>
          <div className="sync-row">
            <label className="inline-checkbox">
              <input
                type="checkbox"
                checked={
                  plan.groups.length > 0 &&
                  plan.groups.every((group) => selected[group.name])
                }
                onChange={(event) => onToggleAll(event.target.checked)}
              />
              {t('selectAll')}
            </label>
          </div>
          <div className="groups discovered-list">
            {plan.groups.map((group) => (
              <div className="group-card" key={group.name}>
                <div className="group-title">
                  <label className="group-select">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[group.name])}
                      onChange={(event) =>
                        onToggleGroup(group.name, event.target.checked)
                      }
                    />
                    <span>{group.name}</span>
                  </label>
                  {group.has_conflict ? (
                    <span className="badge danger">{t('conflict')}</span>
                  ) : (
                    <span className="badge">{t('consistent')}</span>
                  )}
                </div>
                <div className="group-variants">
                  {group.variants.map((variant) => (
                    <div
                      className="variant-row"
                      key={`${group.name}-${variant.tool}-${variant.path}`}
                    >
                      {group.has_conflict ? (
                        <input
                          type="radio"
                          name={`variant-${group.name}`}
                          checked={variantChoice[group.name] === variant.path}
                          onChange={() => onSelectVariant(group.name, variant.path)}
                        />
                      ) : (
                        <span className="variant-spacer" />
                      )}
                      <div className="variant-info">
                        <span className="path">{variant.path}</span>
                        <span className="found-pill">
                          {t('foundIn')} {variant.tool}
                        </span>
                      </div>
                      {variant.is_link ? (
                        <span className="meta">
                          {t('linkLabel', {
                            target: variant.link_target ?? t('unknown'),
                          })}
                        </span>
                      ) : (
                        <span className="meta">{t('directory')}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-primary"
            onClick={onImport}
            disabled={loading}
          >
            <Download size={14} />
            {t('importAndSync')}
          </button>
          <button
            className="btn btn-secondary"
            onClick={onRequestClose}
            disabled={loading}
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default memo(ImportModal)
