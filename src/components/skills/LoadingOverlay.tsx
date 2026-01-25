import { memo } from 'react'
import type { TFunction } from 'i18next'

type LoadingOverlayProps = {
  loading: boolean
  actionMessage: string | null
  loadingStartAt: number | null
  t: TFunction
}

const LoadingOverlay = ({
  loading,
  actionMessage,
  loadingStartAt,
  t,
}: LoadingOverlayProps) => {
  if (!loading) return null

  return (
    <div className="modal-backdrop loading-backdrop">
      <div className="modal loading-modal" role="dialog" aria-modal="true">
        <div className="loading-content">
          <div className="loader-spinner" />
          <div className="loading-text">{t('processingTitle')}</div>
          <div className="loading-stage">
            {actionMessage ?? t('processingTipShort')}
          </div>
          {loadingStartAt ? (
            <div className="loading-subtext loading-subtext-delayed">
              {t('processingTipLong')}
            </div>
          ) : null}
          <div className="progress-bar">
            <div className="progress-fill" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(LoadingOverlay)
