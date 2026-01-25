import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Home, Settings, Box } from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

const NavItem = ({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  
  return (
    <Link
      to={to}
      className={clsx(
        "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
        isActive 
          ? "bg-blue-600 text-white" 
          : "text-gray-400 hover:bg-gray-800 hover:text-white"
      )}
    >
      <Icon size={20} />
      <span>{label}</span>
    </Link>
  );
};

export const Layout = () => {
  const { t } = useTranslation();

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      {/* Sidebar */}
      <aside className="w-64 border-r border-gray-800 flex flex-col p-4">
        <div className="flex items-center gap-2 mb-8 px-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Box className="text-white" size={20} />
          </div>
          <span className="font-bold text-xl">{t('appName')}</span>
        </div>
        
        <nav className="flex-1 space-y-1">
          <NavItem to="/" icon={Home} label={t('layout.navDashboard')} />
          <NavItem to="/skills" icon={Box} label={t('layout.navSkills')} />
          <NavItem to="/settings" icon={Settings} label={t('layout.navSettings')} />
        </nav>

        <div className="text-xs text-gray-600 px-2">
          {t('layout.versionLabel')}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-950 p-6">
        <Outlet />
      </main>
    </div>
  );
};
