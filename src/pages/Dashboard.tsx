import { useTranslation } from 'react-i18next';

export const Dashboard = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
          <h3 className="text-gray-400 text-sm font-medium">
            {t('dashboard.totalSkills')}
          </h3>
          <p className="text-3xl font-bold mt-2">0</p>
        </div>
        <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
          <h3 className="text-gray-400 text-sm font-medium">
            {t('dashboard.toolsConnected')}
          </h3>
          <p className="text-3xl font-bold mt-2">0</p>
        </div>
        <div className="bg-gray-900 p-6 rounded-lg border border-gray-800">
          <h3 className="text-gray-400 text-sm font-medium">
            {t('dashboard.pendingUpdates')}
          </h3>
          <p className="text-3xl font-bold mt-2 text-green-500">
            {t('dashboard.allGood')}
          </p>
        </div>
      </div>
    </div>
  );
};
