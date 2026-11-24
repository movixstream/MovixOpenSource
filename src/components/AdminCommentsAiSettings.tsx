import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  getCommentsAiSettings,
  testCommentsAi,
  updateCommentsAiSettings,
  type CommentsAiOptions,
  type CommentsAiProvider,
  type CommentsAiProviderSettings,
  type CommentsAiSettings,
  type CommentsAiSettingsInput,
  type CommentsAiTestProvider,
  type CommentsAiTestResult
} from '@/services/commentsAiAdminService';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';

// Onglet « IA » de la modération des commentaires : fournisseur, détection
// des spoilers, modèle, effort et clé de chaque fournisseur, puis un essai sur
// un texte avec les réglages enregistrés.

type ProviderKey = CommentsAiTestProvider;

interface ProviderDraft {
  model: string;
  effort: string;
  newKey: string;
  clearKey: boolean;
}

interface Draft {
  provider: CommentsAiProvider;
  spoilerDetection: boolean;
  fallbackToOpenRouter: boolean;
  claude: ProviderDraft;
  openrouter: ProviderDraft;
}

const PROVIDERS: CommentsAiProvider[] = ['claude', 'openrouter', 'off'];
const PROVIDER_NAMES: Record<ProviderKey, string> = { claude: 'Claude Platform', openrouter: 'OpenRouter' };
// Mêmes règles que API/Mainapi/utils/commentsAiSettings.js.
const API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,300}$/;
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._:/-]{1,99}$/i;
const TEST_MAX_LENGTH = 500;

function toProviderDraft(settings: CommentsAiProviderSettings): ProviderDraft {
  return { model: settings.model, effort: settings.effort, newKey: '', clearKey: false };
}

function toDraft(settings: CommentsAiSettings): Draft {
  return {
    provider: settings.provider,
    spoilerDetection: settings.spoilerDetection,
    fallbackToOpenRouter: settings.fallbackToOpenRouter,
    claude: toProviderDraft(settings.claude),
    openrouter: toProviderDraft(settings.openrouter)
  };
}

function providerChanged(draft: ProviderDraft, saved: CommentsAiProviderSettings): boolean {
  return draft.model !== saved.model || draft.effort !== saved.effort || draft.newKey.trim() !== '' || draft.clearKey;
}

function isDirty(draft: Draft, saved: CommentsAiSettings): boolean {
  return draft.provider !== saved.provider
    || draft.spoilerDetection !== saved.spoilerDetection
    || draft.fallbackToOpenRouter !== saved.fallbackToOpenRouter
    || providerChanged(draft.claude, saved.claude)
    || providerChanged(draft.openrouter, saved.openrouter);
}

function toProviderInput(draft: ProviderDraft) {
  const key = draft.newKey.trim();
  return {
    model: draft.model.trim(),
    effort: draft.effort,
    ...(key ? { apiKey: key } : draft.clearKey ? { clearApiKey: true } : {})
  };
}

function toInput(draft: Draft): CommentsAiSettingsInput {
  return {
    provider: draft.provider,
    spoilerDetection: draft.spoilerDetection,
    fallbackToOpenRouter: draft.fallbackToOpenRouter,
    claude: toProviderInput(draft.claude),
    openrouter: toProviderInput(draft.openrouter)
  };
}

function providerInvalid(draft: ProviderDraft): boolean {
  const key = draft.newKey.trim();
  return !MODEL_PATTERN.test(draft.model.trim()) || (key !== '' && !API_KEY_PATTERN.test(key));
}

/** Une clé sera disponible après l'enregistrement (saisie, panneau ou .env). */
function hasUsableKey(draft: ProviderDraft, saved: CommentsAiProviderSettings): boolean {
  if (draft.newKey.trim()) return true;
  if (!saved.key.set) return false;
  // Retirer la clé du panneau laisse celle du .env, qu'on ne voit pas d'ici.
  return !(draft.clearKey && saved.key.source === 'admin');
}

const AdminCommentsAiSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [saved, setSaved] = useState<CommentsAiSettings | null>(null);
  const [options, setOptions] = useState<CommentsAiOptions | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [testContent, setTestContent] = useState('');
  const [testMediaType, setTestMediaType] = useState<'none' | 'movie' | 'tv'>('none');
  const [testMediaId, setTestMediaId] = useState('');
  const [testing, setTesting] = useState<ProviderKey | null>(null);
  const [testResult, setTestResult] = useState<CommentsAiTestResult | null>(null);

  const apply = useCallback((payload: Awaited<ReturnType<typeof getCommentsAiSettings>>) => {
    setSaved(payload.settings);
    setOptions(payload.options);
    setUpdatedAt(payload.updatedAt);
    setDraft(toDraft(payload.settings));
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      apply(await getCommentsAiSettings());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [apply]);

  useEffect(() => { void load(); }, [load]);

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-6 py-10 text-center">
        <AlertTriangle className="h-8 w-8 text-red-300" aria-hidden="true" />
        <div>
          <p className="font-semibold text-white">{t('comments.aiAdmin.loadError')}</p>
          <p className="mt-1 text-sm text-white/55">{loadError}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('comments.aiAdmin.retry')}
        </Button>
      </div>
    );
  }

  if (!draft || !saved || !options) {
    return <p className="py-10 text-center text-sm text-white/50" role="status">{t('comments.aiAdmin.loading')}</p>;
  }

  const dirty = isDirty(draft, saved);
  const invalid = providerInvalid(draft.claude) || providerInvalid(draft.openrouter);
  const canSave = dirty && !invalid && !saving;

  const money = (value: number | null) => (value === null
    ? '—'
    : new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 }).format(value));

  const setProvider = (key: ProviderKey, patch: Partial<ProviderDraft>) => {
    setDraft({ ...draft, [key]: { ...draft[key], ...patch } });
  };

  const save = async () => {
    setSaving(true);
    try {
      apply(await updateCommentsAiSettings(toInput(draft)));
      toast.success(t('comments.aiAdmin.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('comments.aiAdmin.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (provider: ProviderKey) => {
    setTesting(provider);
    setTestResult(null);
    try {
      const mediaId = testMediaId.trim();
      setTestResult(await testCommentsAi({
        content: testContent.trim(),
        provider,
        ...(testMediaType !== 'none' && /^\d{1,10}$/.test(mediaId) ? { mediaType: testMediaType, mediaId } : {})
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('comments.aiAdmin.testError'));
    } finally {
      setTesting(null);
    }
  };

  const activeKey: ProviderKey | null = draft.provider === 'off' ? null : draft.provider;
  const missingKey = activeKey && !hasUsableKey(draft[activeKey], saved[activeKey]);
  const claudeChoice = options.claudeModels.find((model) => model.id === draft.claude.model) || null;
  const claudeModels = claudeChoice
    ? options.claudeModels
    : [...options.claudeModels, { id: draft.claude.model, label: draft.claude.model, perComment: null, firstOfHour: null }];
  const testText = testContent.trim();

  const renderKeyField = (key: ProviderKey) => {
    const status = saved[key].key;
    const value = draft[key].newKey.trim();
    const keyInvalid = value !== '' && !API_KEY_PATTERN.test(value);
    const statusLabel = !status.set
      ? t('comments.aiAdmin.keyNone')
      : status.source === 'admin'
        ? t('comments.aiAdmin.keyFromAdmin', { hint: status.hint })
        : t('comments.aiAdmin.keyFromEnv', { hint: status.hint });
    return (
      <div className="sm:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`comments-ai-${key}-key`} className="block text-sm font-medium text-white/80">
            {t('comments.aiAdmin.key')}
          </label>
          <span className={cn('text-xs', status.set ? 'text-emerald-300' : 'text-amber-300')}>{statusLabel}</span>
        </div>
        <Input
          id={`comments-ai-${key}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft[key].newKey}
          placeholder={t('comments.aiAdmin.keyPlaceholder')}
          onChange={(event) => setProvider(key, { newKey: event.target.value, clearKey: false })}
          aria-invalid={keyInvalid || undefined}
          className={cn('mt-1.5 bg-black/30 font-mono', keyInvalid && 'border-red-400/60')}
        />
        <p className={cn('mt-1 text-xs', keyInvalid ? 'text-red-300' : 'text-white/40')}>
          {keyInvalid ? t('comments.aiAdmin.keyInvalid') : t('comments.aiAdmin.keyHint')}
        </p>
        {status.unreadable && (
          <p className="mt-1 text-xs text-red-300">{t('comments.aiAdmin.keyUnreadable')}</p>
        )}
        {status.source === 'admin' && !value && (
          draft[key].clearKey ? (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-200">
              {t('comments.aiAdmin.keyWillBeRemoved')}
              <button type="button" className="underline underline-offset-2 hover:text-white" onClick={() => setProvider(key, { clearKey: false })}>
                {t('comments.aiAdmin.undoRemove')}
              </button>
            </p>
          ) : (
            <Button type="button" size="sm" variant="ghost" className="mt-1 h-8 px-2 text-red-300 hover:text-red-200" onClick={() => setProvider(key, { clearKey: true })}>
              {t('comments.aiAdmin.removeKey')}
            </Button>
          )
        )}
      </div>
    );
  };

  const renderEffortField = (key: ProviderKey, efforts: string[]) => (
    <div>
      <label htmlFor={`comments-ai-${key}-effort`} className="block text-sm font-medium text-white/80">
        {t('comments.aiAdmin.effort')}
      </label>
      <Select value={draft[key].effort} onValueChange={(effort) => setProvider(key, { effort })}>
        <SelectTrigger id={`comments-ai-${key}-effort`} className="mt-1.5 bg-black/30">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {efforts.map((effort) => (
            <SelectItem key={effort} value={effort}>{t(`comments.aiAdmin.efforts.${effort}`, effort)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1 text-xs text-white/40">{t('comments.aiAdmin.effortHint')}</p>
    </div>
  );

  const decision = testResult?.decision;

  return (
    <div className="space-y-6">
      <section aria-labelledby="comments-ai-provider-title" className="rounded-xl border border-white/10 bg-black/20 p-4 sm:p-5">
        <h3 id="comments-ai-provider-title" className="text-base font-semibold text-white">{t('comments.aiAdmin.providerTitle')}</h3>
        <p className="mt-1 text-sm text-white/55">{t('comments.aiAdmin.providerHint')}</p>
        <div role="radiogroup" aria-labelledby="comments-ai-provider-title" className="mt-4 grid gap-3 sm:grid-cols-3">
          {PROVIDERS.map((provider) => {
            const checked = draft.provider === provider;
            return (
              <button
                key={provider}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setDraft({ ...draft, provider })}
                className={cn(
                  'rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                  checked ? 'border-white/70 bg-white/[0.08]' : 'border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.05]'
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-white">
                  <span
                    aria-hidden="true"
                    className={cn('size-3.5 flex-none rounded-full border-2', checked ? 'border-white bg-white shadow-[inset_0_0_0_2px_#000]' : 'border-white/40')}
                  />
                  {t(`comments.aiAdmin.providers.${provider}.name`)}
                </span>
                <span className="mt-1.5 block text-xs leading-5 text-white/55">{t(`comments.aiAdmin.providers.${provider}.hint`)}</span>
              </button>
            );
          })}
        </div>
        {missingKey && activeKey && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-300" aria-hidden="true" />
            {t('comments.aiAdmin.noKeyWarning', { provider: PROVIDER_NAMES[activeKey] })}
          </p>
        )}
        {draft.provider === 'claude' && !options.claudeSdkInstalled && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-300" aria-hidden="true" />
            {t('comments.aiAdmin.sdkMissing')}
          </p>
        )}

        <div className="mt-4 divide-y divide-white/[0.06] rounded-xl border border-white/10">
          {([
            ['spoilerDetection', draft.provider === 'off'],
            ['fallbackToOpenRouter', draft.provider !== 'claude']
          ] as const).map(([field, disabled]) => (
            <div key={field} className={cn('flex items-center justify-between gap-4 px-4 py-3', disabled && 'opacity-50')}>
              <div className="min-w-0">
                <label htmlFor={`comments-ai-${field}`} className="cursor-pointer text-sm font-medium text-white">
                  {t(`comments.aiAdmin.${field}`)}
                </label>
                <p className="mt-0.5 text-xs leading-5 text-white/50">{t(`comments.aiAdmin.${field}Hint`)}</p>
              </div>
              <Switch
                id={`comments-ai-${field}`}
                checked={draft[field]}
                disabled={disabled || saving}
                onCheckedChange={(checked) => setDraft({ ...draft, [field]: checked })}
              />
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="comments-ai-claude-title" className="rounded-xl border border-white/10 bg-black/20 p-4 sm:p-5">
        <h3 id="comments-ai-claude-title" className="text-base font-semibold text-white">Claude Platform</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="comments-ai-claude-model" className="block text-sm font-medium text-white/80">
              {t('comments.aiAdmin.model')}
            </label>
            <Select value={draft.claude.model} onValueChange={(model) => setProvider('claude', { model })}>
              <SelectTrigger id="comments-ai-claude-model" className="mt-1.5 bg-black/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {claudeModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-white/40">
              {claudeChoice && claudeChoice.perComment !== null
                ? t('comments.aiAdmin.cost', { perComment: money(claudeChoice.perComment), firstOfHour: money(claudeChoice.firstOfHour) })
                : t('comments.aiAdmin.costUnknown')}
            </p>
          </div>
          {renderEffortField('claude', options.claudeEfforts)}
          {renderKeyField('claude')}
        </div>
      </section>

      <section aria-labelledby="comments-ai-openrouter-title" className="rounded-xl border border-white/10 bg-black/20 p-4 sm:p-5">
        <h3 id="comments-ai-openrouter-title" className="text-base font-semibold text-white">OpenRouter</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="comments-ai-openrouter-model" className="block text-sm font-medium text-white/80">
              {t('comments.aiAdmin.model')}
            </label>
            <Input
              id="comments-ai-openrouter-model"
              value={draft.openrouter.model}
              spellCheck={false}
              onChange={(event) => setProvider('openrouter', { model: event.target.value })}
              aria-invalid={!MODEL_PATTERN.test(draft.openrouter.model.trim()) || undefined}
              className={cn('mt-1.5 bg-black/30 font-mono', !MODEL_PATTERN.test(draft.openrouter.model.trim()) && 'border-red-400/60')}
            />
            <p className="mt-1 text-xs text-white/40">{t('comments.aiAdmin.modelHintOpenRouter')}</p>
          </div>
          {renderEffortField('openrouter', options.openrouterEfforts)}
          {renderKeyField('openrouter')}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!canSave} onClick={() => void save()}>
          {saving ? t('comments.aiAdmin.saving') : t('comments.aiAdmin.save')}
        </Button>
        {dirty && (
          <Button type="button" variant="ghost" disabled={saving} onClick={() => setDraft(toDraft(saved))}>
            {t('comments.aiAdmin.discard')}
          </Button>
        )}
        {updatedAt && (
          <span className="text-xs text-white/40">
            {t('comments.aiAdmin.updatedAt', {
              date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(updatedAt))
            })}
          </span>
        )}
      </div>

      <section aria-labelledby="comments-ai-test-title" className="rounded-xl border border-white/10 bg-black/20 p-4 sm:p-5">
        <h3 id="comments-ai-test-title" className="text-base font-semibold text-white">{t('comments.aiAdmin.testTitle')}</h3>
        <p className="mt-1 text-sm text-white/55">{t('comments.aiAdmin.testHint')}</p>
        <Textarea
          value={testContent}
          maxLength={TEST_MAX_LENGTH}
          rows={3}
          placeholder={t('comments.aiAdmin.testPlaceholder')}
          aria-label={t('comments.aiAdmin.testTitle')}
          onChange={(event) => setTestContent(event.target.value)}
          className="mt-4 bg-black/30"
        />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="comments-ai-test-type" className="block text-xs text-white/60">{t('comments.aiAdmin.testWork')}</label>
            <Select value={testMediaType} onValueChange={(value) => setTestMediaType(value as 'none' | 'movie' | 'tv')}>
              <SelectTrigger id="comments-ai-test-type" className="mt-1 w-[140px] bg-black/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('comments.aiAdmin.testWorkNone')}</SelectItem>
                <SelectItem value="movie">{t('comments.aiAdmin.movie')}</SelectItem>
                <SelectItem value="tv">{t('comments.aiAdmin.tv')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {testMediaType !== 'none' && (
            <div>
              <label htmlFor="comments-ai-test-id" className="block text-xs text-white/60">{t('comments.aiAdmin.testTmdbId')}</label>
              <Input
                id="comments-ai-test-id"
                inputMode="numeric"
                value={testMediaId}
                onChange={(event) => setTestMediaId(event.target.value.replace(/\D/g, '').slice(0, 10))}
                className="mt-1 w-[140px] bg-black/30 tabular-nums"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {(['claude', 'openrouter'] as const).map((provider) => (
              <Button
                key={provider}
                type="button"
                variant="outline"
                disabled={!testText || dirty || testing !== null}
                onClick={() => void runTest(provider)}
              >
                {testing === provider && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {testing === provider ? t('comments.aiAdmin.testRunning') : t('comments.aiAdmin.testWith', { provider: PROVIDER_NAMES[provider] })}
              </Button>
            ))}
          </div>
        </div>
        {dirty && <p className="mt-2 text-xs text-amber-200">{t('comments.aiAdmin.testSaveFirst')}</p>}

        {testResult && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4" role="status">
            {decision ? (
              <div className="flex flex-wrap gap-2">
                <span className={cn(
                  'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium',
                  decision.flagged ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                )}
                >
                  {decision.flagged
                    ? t('comments.aiAdmin.result.removed', { reason: t(`comments.aiAdmin.reasons.${decision.reason}`, decision.reason || '') })
                    : t('comments.aiAdmin.result.kept')}
                </span>
                <span className={cn(
                  'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium',
                  decision.spoiler ? 'border-amber-400/30 bg-amber-500/10 text-amber-200' : 'border-white/10 bg-white/5 text-white/60'
                )}
                >
                  {decision.spoiler ? t('comments.aiAdmin.result.spoiler') : t('comments.aiAdmin.result.noSpoiler')}
                </span>
              </div>
            ) : (
              <p className="text-sm font-medium text-red-200">{t('comments.aiAdmin.result.noDecision')}</p>
            )}
            {decision?.details && <p className="mt-2 text-sm text-white/75">{decision.details}</p>}
            {testResult.error && <p className="mt-2 break-words text-sm text-red-300">{testResult.error}</p>}
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums text-white/50">
              {testResult.model && <span className="font-mono">{testResult.model}</span>}
              {testResult.usage && <span>{t('comments.aiAdmin.result.tokens', testResult.usage)}</span>}
              {testResult.costUsd !== null && <span>{t('comments.aiAdmin.result.cost', { cost: money(testResult.costUsd) })}</span>}
              {testResult.durationMs !== null && (
                <span>{t('comments.aiAdmin.result.duration', { seconds: (testResult.durationMs / 1000).toFixed(1) })}</span>
              )}
              {testResult.stopReason && testResult.stopReason !== 'end_turn' && testResult.stopReason !== 'stop' && (
                <span>{t('comments.aiAdmin.result.stopReason', { reason: testResult.stopReason })}</span>
              )}
            </p>
          </div>
        )}
      </section>
    </div>
  );
};

export default AdminCommentsAiSettings;
