import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WrappedThemeId } from '@/types/wrapped';
import { WRAPPED_THEME_IDS, WRAPPED_THEMES } from '@/utils/wrappedTheme';

/**
 * Pastilles d'ambiance du film et des images. Celle qui vient du profil est marquée
 * « Auto » ; les autres restent au choix, sans toucher aux données affichées.
 */
export default function WrappedThemePicker({ value, auto, onChange }: { value: WrappedThemeId; auto: WrappedThemeId; onChange: (id: WrappedThemeId) => void }) {
    const { t } = useTranslation();
    const name = (id: WrappedThemeId) => t(`wrappedTheme.names.${id}`);
    return <div className="space-y-2" data-wrapped-interactive>
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-semibold">
            <span>{t('wrappedTheme.title')}</span>
            <span className="text-xs font-normal text-white/65">{name(value)}{value === auto ? ` · ${t('wrappedTheme.autoHint')}` : ''}</span>
        </p>
        <div role="group" aria-label={t('wrappedTheme.title')} className="flex flex-wrap gap-2">
            {WRAPPED_THEME_IDS.map(id => {
                const palette = WRAPPED_THEMES[id];
                const label = id === auto ? `${name(id)} (${t('wrappedTheme.auto')})` : name(id);
                return <button key={id} type="button" aria-pressed={value === id} aria-label={label} title={label} onClick={() => onChange(id)}
                    className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-pressed:ring-2 aria-pressed:ring-white aria-pressed:ring-offset-2 aria-pressed:ring-offset-[#101318]"
                    style={{ background: `linear-gradient(135deg, ${palette.primary} 0 52%, ${palette.light} 52% 100%)` }}>
                    {value === id && <Check className="h-4 w-4 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" aria-hidden="true" />}
                    {id === auto && <span className="absolute -bottom-1 -right-1 rounded-full bg-white px-1 text-[9px] font-bold leading-4 text-[#101318]" aria-hidden="true">{t('wrappedTheme.auto')}</span>}
                </button>;
            })}
        </div>
    </div>;
}
