import { memo } from 'react'
import type { TFunction } from 'i18next'
import type { LocalSkillCandidate } from '../types'

type LocalPickModalProps = {
  open: boolean
  loading: boolean
  localCandidates: LocalSkillCandidate[]
  localCandidateSelected: Record<string, boolean>
  onRequestClose: () => void
  onCancel: () => void
  onToggleAll: (checked: boolean) => void
  onToggleCandidate: (subpath: string, checked: boolean) => void
  onInstall: () => void
  t: TFunction
}

const LocalPickModal = ({
  open,
  loading,
  localCandidates,
  localCandidateSelected,
  onRequestClose,
  onCancel,
  onToggleAll,
  onToggleCandidate,
  onInstall,
  t,
}: LocalPickModalProps) => {
  if (!open) return null

  const selectedCount = localCandidates.filter(
    (c) => localCandidateSelected[c.subpath],
  ).length
  const selectableCount = localCandidates.filter((c) => c.valid).length

  const mapReason = (code?: string | null) => {
    if (!code) return t('localSkillInvalid.unknown')
    if (code === 'missing_skill_md') return t('localSkillInvalid.missingSkillMd')
    if (code === 'invalid_frontmatter') return t('localSkillInvalid.invalidFrontmatter')
    if (code === 'missing_name') return t('localSkillInvalid.missingName')
    if (code === 'read_failed') return t('localSkillInvalid.readFailed')
    return t('localSkillInvalid.unknown')
  }

  return (
    <div className="modal-backdrop" onClick={onRequestClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{t('localPickTitle')}</div>
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
          <p className="label">{t('localPickBody')}</p>
          <div className="pick-toolbar">
            <label className="inline-checkbox">
              <input
                type="checkbox"
                checked={
                  selectableCount > 0 &&
                  localCandidates
                    .filter((c) => c.valid)
                    .every((c) => localCandidateSelected[c.subpath])
                }
                onChange={(e) => onToggleAll(e.target.checked)}
              />
              {t('selectAll')}
            </label>
            <span className="pick-toolbar-count">
              {t('selectedCount', {
                selected: selectedCount,
                total: selectableCount,
              })}
            </span>
          </div>
          <div className="pick-list">
            {localCandidates.map((c) => (
              <div
                className={`pick-item${c.valid ? '' : ' disabled'}`}
                key={c.subpath}
              >
                <label className="pick-item-checkbox">
                  <input
                    type="checkbox"
                    checked={Boolean(localCandidateSelected[c.subpath])}
                    onChange={(e) => onToggleCandidate(c.subpath, e.target.checked)}
                    disabled={!c.valid}
                  />
                </label>
                <div className="pick-item-main">
                  <div className="pick-item-title">{c.name}</div>
                  {c.description ? (
                    <div className="pick-item-desc">{c.description}</div>
                  ) : null}
                  <div className="pick-item-path">{c.subpath}</div>
                  {!c.valid ? (
                    <div className="pick-item-reason">
                      {t('localPickInvalidReason', { reason: mapReason(c.reason) })}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            {t('cancel')}
          </button>
          <button className="btn btn-primary" onClick={onInstall} disabled={loading}>
            {t('installSelected')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default memo(LocalPickModal)
