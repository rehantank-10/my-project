import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../../store/LanguageContext';
import { Hospital, Globe, UserPlus, Search, HelpCircle } from 'lucide-react';

/**
 * Patient kiosk welcome screen — calm, accessible, touch-friendly.
 */
export function WelcomePage() {
  const navigate = useNavigate();
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      {/* Logo */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-600 rounded-2xl mb-4 shadow-lg shadow-blue-600/20">
          <Hospital className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-4xl font-bold text-slate-800 tracking-tight">{t('welcomeTitle')}</h1>
        <p className="text-lg text-slate-500 mt-2">{t('welcomeSubtitle')}</p>
      </div>

      {/* Action Cards */}
      <div className="w-full max-w-lg space-y-4">
        <button
          onClick={() => navigate('/kiosk/language')}
          className="w-full flex items-center gap-4 p-6 bg-white rounded-2xl shadow-sm border border-slate-200
            hover:shadow-md hover:border-blue-300 transition-all touch-target-lg group"
        >
          <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center
            group-hover:bg-blue-100 transition-colors">
            <UserPlus className="w-7 h-7 text-blue-600" />
          </div>
          <div className="text-left">
            <h2 className="text-lg font-semibold text-slate-800">{t('startNewVisit')}</h2>
            <p className="text-sm text-slate-500">{t('startNewVisitDesc')}</p>
          </div>
        </button>

        <button
          onClick={() => navigate('/kiosk/identify')}
          className="w-full flex items-center gap-4 p-6 bg-white rounded-2xl shadow-sm border border-slate-200
            hover:shadow-md hover:border-blue-300 transition-all touch-target-lg group"
        >
          <div className="w-14 h-14 bg-green-50 rounded-xl flex items-center justify-center
            group-hover:bg-green-100 transition-colors">
            <Search className="w-7 h-7 text-green-600" />
          </div>
          <div className="text-left">
            <h2 className="text-lg font-semibold text-slate-800">{t('existingPatient')}</h2>
            <p className="text-sm text-slate-500">{t('existingPatientDesc')}</p>
          </div>
        </button>

        <button
          onClick={() => alert(t('needAssistanceDesc'))}
          className="w-full flex items-center gap-4 p-6 bg-white rounded-2xl shadow-sm border border-slate-200
            hover:shadow-md hover:border-amber-300 transition-all touch-target-lg group"
        >
          <div className="w-14 h-14 bg-amber-50 rounded-xl flex items-center justify-center
            group-hover:bg-amber-100 transition-colors">
            <HelpCircle className="w-7 h-7 text-amber-600" />
          </div>
          <div className="text-left">
            <h2 className="text-lg font-semibold text-slate-800">{t('needAssistance')}</h2>
            <p className="text-sm text-slate-500">{t('needAssistanceDesc')}</p>
          </div>
        </button>
      </div>

      {/* Language Selector */}
      <div className="mt-10 flex items-center gap-4">
        <Globe className="w-5 h-5 text-slate-400" />
        <div className="flex gap-2">
          {[
            { code: 'en' as const, label: 'English' },
            { code: 'hi' as const, label: 'हिन्दी' },
            { code: 'gu' as const, label: 'ગુજરાતી' },
          ].map((lang) => (
            <button
              key={lang.code}
              onClick={() => setLanguage(lang.code)}
              className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors touch-target ${
                language === lang.code
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-blue-50 hover:border-blue-300'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
