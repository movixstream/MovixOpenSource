import React, { useState, useEffect, useCallback } from 'react';
import {
  AppState,
  View,
  Text,
  Switch,
  StyleSheet,
  ScrollView,
  Alert,
  NativeModules,
  Platform,
  Linking,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppButton from '../components/AppButton';
import { CONFIG } from '../config';
import { useBrowserUIPrefs } from '../hooks/useBrowserUIPrefs';
import { useAddress } from '../context/AddressContext';
import { getLocalVersionName } from '../services/apkInstaller';
import { copyDiagnostics, shareDiagnostics } from '../services/diagnostics';
import {
  clearNetworkJournal,
  getNetworkJournal,
  loadNetworkJournalPreference,
  setNetworkJournalEnabled,
} from '../services/networkJournal';

const { DnsModule } = NativeModules;

// Sur iOS, l'interrupteur reste un UISwitch natif (Liquid Glass sur iOS 26) :
// seule la couleur active est fixée, sans forcer le pouce ni le rail éteint.
function switchColors(value: boolean) {
  if (Platform.OS === 'ios') {
    return { trackColor: { false: undefined, true: '#8b5cf6' } };
  }
  return {
    trackColor: { false: '#333333', true: '#8b5cf6' },
    thumbColor: value ? '#ffffff' : '#888888',
  };
}

// Doit rester aligné sur `M3U8_EXTRACTOR_KEYS` (src/utils/extractionPrefs.ts) :
// les préférences sont partagées avec le site via le pont d'injection.
const M3U8_KEYS = ['voe','fsvid','vidzy','vidmoly','sibnet','uqload','doodstream','seekstreaming','lulustream','veev','vidara'] as const;
const LIVETV_KEYS = ['northlive','vavoo','matches'] as const;

type ExtractionPrefs = {
  version: 1;
  m3u8: Record<typeof M3U8_KEYS[number], boolean>;
  livetv: Record<typeof LIVETV_KEYS[number], boolean>;
};

const buildDefaultExtractionPrefs = (): ExtractionPrefs => ({
  version: 1,
  m3u8: M3U8_KEYS.reduce((acc, k) => ({ ...acc, [k]: true }), {} as ExtractionPrefs['m3u8']),
  livetv: LIVETV_KEYS.reduce((acc, k) => ({ ...acc, [k]: true }), {} as ExtractionPrefs['livetv']),
});

export default function SettingsScreen() {
  const { config } = useAddress();
  const primaryUrl = config?.primaryUrl ?? CONFIG.SITE_URL;
  const [dnsEnabled, setDnsEnabled] = useState(false);
  const [dnsStatus, setDnsStatus] = useState<'off' | 'connecting' | 'active' | 'error'>('off');
  const [appVersion, setAppVersion] = useState<string>('—');
  const [extractionPrefs, setExtractionPrefs] = useState<ExtractionPrefs>(buildDefaultExtractionPrefs);
  const { prefs: uiPrefs, setShowUrlBar, setShowNavBar } = useBrowserUIPrefs();
  const [journalEnabled, setJournalEnabled] = useState(false);
  const [journalEntries, setJournalEntries] = useState<string[]>([]);
  const [journalVisible, setJournalVisible] = useState(false);
  const [exportingJournal, setExportingJournal] = useState(false);

  useEffect(() => {
    loadNetworkJournalPreference()
      .then(setJournalEnabled)
      .catch(() => setJournalEnabled(false));
  }, []);

  const toggleJournal = useCallback(async (value: boolean) => {
    setJournalEnabled(value);
    await setNetworkJournalEnabled(value);
    if (!value) setJournalEntries([]);
  }, []);

  const openJournal = useCallback(async () => {
    const entries = await getNetworkJournal();
    setJournalEntries(entries);
    setJournalVisible(true);
  }, []);

  const shareJournal = useCallback(async () => {
    if (exportingJournal) return;
    setExportingJournal(true);
    try {
      await shareDiagnostics();
    } catch {
      Alert.alert('Journal réseau', 'Impossible de partager le fichier. Tu peux utiliser « Copier les logs ».');
    } finally {
      setExportingJournal(false);
    }
  }, [exportingJournal]);

  const copyJournal = useCallback(async (includeNetwork = true) => {
    try {
      await copyDiagnostics(includeNetwork);
      Alert.alert('Diagnostic Movix', 'Les logs sont copiés dans le presse-papiers.');
    } catch {
      Alert.alert('Diagnostic Movix', 'Copie impossible. Essaie de partager le fichier .txt.');
    }
  }, []);

  useEffect(() => {
    getLocalVersionName()
      .then(setAppVersion)
      .catch(err => {
        console.warn('[SettingsScreen] getLocalVersionName failed', err);
      });
  }, []);

  const refreshDnsState = useCallback(async () => {
    let active = false;
    if (DnsModule) {
      try {
        active = await DnsModule.isEnabled();
      } catch {}
    }
    if (active) {
      setDnsEnabled(true);
      setDnsStatus('active');
      await AsyncStorage.setItem('dns_enabled', 'true');
      return;
    }
    const val = await AsyncStorage.getItem('dns_enabled');
    if (Platform.OS === 'android' && val === 'true') {
        setDnsEnabled(true);
        setDnsStatus('active');
        return;
    }
    if (val === 'true') {
      await AsyncStorage.setItem('dns_enabled', 'false');
    }
    setDnsEnabled(false);
    setDnsStatus('off');
  }, []);

  useEffect(() => {
    void refreshDnsState();
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        void refreshDnsState();
      }
    });
    return () => subscription.remove();
  }, [refreshDnsState]);

  useEffect(() => {
    AsyncStorage.getItem('movix_extraction_prefs').then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && parsed.m3u8 && parsed.livetv) {
          const defaults = buildDefaultExtractionPrefs();
          setExtractionPrefs({
            version: 1,
            m3u8: { ...defaults.m3u8, ...parsed.m3u8 },
            livetv: { ...defaults.livetv, ...parsed.livetv },
          });
        }
      } catch {
        // corrupted — keep defaults
      }
    });
  }, []);

  const updateExtractionPrefs = useCallback((next: ExtractionPrefs) => {
    setExtractionPrefs(next);
    AsyncStorage.setItem('movix_extraction_prefs', JSON.stringify(next));
  }, []);

  const toggleDns = useCallback(async (value: boolean) => {
    if (!DnsModule) {
      Alert.alert(
        'Module DNS indisponible',
        'Le module natif DNS n\'est pas disponible sur cette plateforme.',
      );
      return;
    }

    setDnsEnabled(value);

    if (value) {
      setDnsStatus('connecting');
      try {
        const dnsActivated = await DnsModule.enable(CONFIG.DNS_PRIMARY, CONFIG.DNS_SECONDARY);
        if (Platform.OS === 'ios' && !dnsActivated) {
          setDnsStatus('off');
          setDnsEnabled(false);
          await AsyncStorage.setItem('dns_enabled', 'false');
          Alert.alert(
            'Activation DNS requise',
            'La configuration est installée. Active-la manuellement dans Réglages > Général > VPN et gestion de l’appareil > DNS.',
            [{ text: 'Compris' }],
          );
          return;
        }
        setDnsStatus('active');
        await AsyncStorage.setItem('dns_enabled', 'true');
      } catch (err: any) {
        setDnsStatus('error');
        setDnsEnabled(false);
        Alert.alert('Erreur DNS', err?.message || 'Impossible d\'activer le DNS');
      }
    } else {
      try {
        await DnsModule.disable();
        setDnsStatus('off');
        await AsyncStorage.setItem('dns_enabled', 'false');
      } catch (err: any) {
        Alert.alert('Erreur DNS', err?.message || 'Impossible de désactiver le DNS');
      }
    }
  }, []);

  const statusColor = {
    off: '#666666',
    connecting: '#f59e0b',
    active: '#22c55e',
    error: '#ef4444',
  }[dnsStatus];

  const statusLabel = {
    off: 'Désactivé',
    connecting: 'Connexion...',
    active: 'Actif — 1.1.1.1',
    error: 'Erreur',
  }[dnsStatus];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* DNS Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DNS Cloudflare</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowTitle}>DNS 1.1.1.1</Text>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {statusLabel}
                </Text>
              </View>
            </View>
            <Switch
              value={dnsEnabled}
              onValueChange={toggleDns}
              {...switchColors(dnsEnabled)}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>DNS Primaire</Text>
            <Text style={styles.infoValue}>{CONFIG.DNS_PRIMARY}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>DNS Secondaire</Text>
            <Text style={styles.infoValue}>{CONFIG.DNS_SECONDARY}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Méthode</Text>
            <Text style={styles.infoValue}>
              {Platform.OS === 'android' ? 'VPN local (pas de données envoyées)' : 'Configuration DNS système'}
            </Text>
          </View>
        </View>

        <Text style={styles.hint}>
          {Platform.OS === 'android'
            ? 'Un VPN local est créé pour rediriger les requêtes DNS vers Cloudflare 1.1.1.1. Aucune donnée ne transite par un serveur tiers.'
            : 'Le DNS système est configuré pour utiliser Cloudflare 1.1.1.1 via DNS-over-HTTPS.'}
        </Text>
      </View>

      {/* Extension Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Extension Movix</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowTitle}>Proxy intégré</Text>
              <Text style={styles.rowSubtitle}>
                Bypass CORS, injection headers, extraction sources
              </Text>
            </View>
            <View style={[styles.badge, styles.badgeActive]}>
              <Text style={styles.badgeText}>Actif</Text>
            </View>
          </View>
        </View>

        <Text style={styles.hint}>
          L'extension Movix est intégrée directement dans l'application. Elle remplace
          le userscript Tampermonkey et l'extension Chrome/Firefox.
        </Text>
      </View>

      {/* Affichage Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Affichage</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowTitle}>Barre d'adresse</Text>
              <Text style={styles.rowSubtitle}>Cadenas + domaine en haut du toolbar</Text>
            </View>
            <Switch
              value={uiPrefs.showUrlBar}
              onValueChange={setShowUrlBar}
              {...switchColors(uiPrefs.showUrlBar)}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowTitle}>Contrôles de navigation</Text>
              <Text style={styles.rowSubtitle}>
                Boutons back / forward / home / cast / réglages
              </Text>
            </View>
            <Switch
              value={uiPrefs.showNavBar}
              onValueChange={setShowNavBar}
              {...switchColors(uiPrefs.showNavBar)}
            />
          </View>
        </View>

        <Text style={styles.hint}>
          Quand les deux sont désactivés, un petit indicateur en bas permet de
          rouvrir les réglages.
        </Text>
      </View>

      {/* Extractions Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Extractions</Text>

        <View style={styles.card}>
          <Text style={[styles.rowTitle, { marginBottom: 8 }]}>Extracteurs m3u8</Text>
          {M3U8_KEYS.map((key) => (
            <View key={key} style={styles.row}>
              <Text style={styles.rowSubtitle}>{key}</Text>
              <Switch
                value={extractionPrefs.m3u8[key]}
                onValueChange={(v) => updateExtractionPrefs({ ...extractionPrefs, m3u8: { ...extractionPrefs.m3u8, [key]: v } })}
                {...switchColors(extractionPrefs.m3u8[key])}
              />
            </View>
          ))}
        </View>

        <View style={[styles.card, { marginTop: 12 }]}>
          <Text style={[styles.rowTitle, { marginBottom: 8 }]}>Sources Live TV</Text>
          {LIVETV_KEYS.map((key) => (
            <View key={key} style={styles.row}>
              <Text style={styles.rowSubtitle}>{key}</Text>
              <Switch
                value={extractionPrefs.livetv[key]}
                onValueChange={(v) => updateExtractionPrefs({ ...extractionPrefs, livetv: { ...extractionPrefs.livetv, [key]: v } })}
                {...switchColors(extractionPrefs.livetv[key])}
              />
            </View>
          ))}
        </View>

        <Text style={styles.hint}>
          Ces réglages s'appliquent à l'extraction native de l'app. Pour régler l'extension ou le userscript, va sur {primaryUrl.replace(/^https?:\/\//, '')}/settings#extractions.
        </Text>
      </View>

      {/* Débogage Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Débogage</Text>

        <View style={styles.card}>
          <Text style={styles.rowTitle}>Diagnostic Cast</Text>
          <Text style={styles.rowSubtitle}>
            Les dernières étapes et erreurs de diffusion sont conservées pendant cette session, sur Android et iOS.
          </Text>
          <AppButton
            title="Copier les logs Cast"
            systemImage="doc.on.doc"
            compact
            onPress={() => copyJournal(false)}
            style={{ marginTop: 12 }}
            fallbackStyle={styles.linkButton}
            fallbackTextStyle={styles.linkText}
          />
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowTitle}>Journal réseau</Text>
              <Text style={styles.rowSubtitle}>
                Enregistre chaque requête média : en-têtes réellement émis, code
                de réponse, en-têtes reçus.
              </Text>
            </View>
            <Switch
              value={journalEnabled}
              onValueChange={toggleJournal}
              {...switchColors(journalEnabled)}
            />
          </View>

          {journalEnabled && (
            <View style={{ marginTop: 12 }}>
              <AppButton
                title="Voir le journal"
                systemImage="list.bullet.rectangle"
                compact
                onPress={openJournal}
                style={{ marginTop: 12 }}
                fallbackStyle={styles.linkButton}
                fallbackTextStyle={styles.linkText}
              />
              <AppButton
                title={exportingJournal ? 'Préparation du partage…' : 'Partager le fichier .txt'}
                systemImage="square.and.arrow.up"
                compact
                onPress={shareJournal}
                disabled={exportingJournal}
                style={{ marginTop: 8 }}
                fallbackStyle={styles.linkButton}
                fallbackTextStyle={styles.linkText}
              />
              <AppButton
                title="Copier les logs"
                systemImage="doc.on.doc"
                compact
                onPress={() => copyJournal()}
                style={{ marginTop: 8 }}
                fallbackStyle={styles.linkButton}
                fallbackTextStyle={styles.linkText}
              />
              <AppButton
                title="Vider le journal"
                systemImage="trash"
                variant="destructive"
                compact
                onPress={async () => {
                  await clearNetworkJournal();
                  setJournalEntries([]);
                }}
                style={{ marginTop: 8 }}
                fallbackStyle={styles.linkButton}
                fallbackTextStyle={styles.linkText}
              />
            </View>
          )}
        </View>

        <Text style={styles.hint}>
          Active le journal, recharge la page et reproduis le problème. La capture
          réseau est effacée en coupant l'interrupteur ou en fermant l'app.
          L'export crée un fichier temporaire .txt ; la copie garde les dernières
          lignes si le journal est volumineux. Les données sensibles reconnues
          sont masquées dans les exports. Rien n'est envoyé automatiquement.
        </Text>
      </View>

      <Modal
        visible={journalVisible}
        animationType="slide"
        onRequestClose={() => setJournalVisible(false)}>
        <View style={styles.container}>
          <View style={styles.journalHeader}>
            <Text style={styles.sectionTitle}>
              Journal réseau ({journalEntries.length})
            </Text>
            <AppButton
              title="Fermer"
              compact
              onPress={() => setJournalVisible(false)}
              style={Platform.OS === 'ios' ? { width: 100 } : undefined}
              fallbackTextStyle={styles.linkText}
            />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 }}>
            <AppButton
              title="Copier les logs"
              systemImage="doc.on.doc"
              compact
              onPress={() => copyJournal()}
              style={[{ marginTop: 12 }, Platform.OS === 'ios' && { flex: 1 }]}
              fallbackStyle={styles.linkButton}
              fallbackTextStyle={styles.linkText}
            />
            <AppButton
              title={exportingJournal ? 'Préparation…' : 'Partager le fichier .txt'}
              systemImage="square.and.arrow.up"
              compact
              onPress={shareJournal}
              disabled={exportingJournal}
              style={[{ marginTop: 12 }, Platform.OS === 'ios' && { flex: 1 }]}
              fallbackStyle={styles.linkButton}
              fallbackTextStyle={styles.linkText}
            />
          </View>
          <ScrollView contentContainerStyle={styles.content} horizontal={false}>
            {journalEntries.length === 0 ? (
              <Text style={styles.hint}>
                Aucune requête enregistrée. Lance une lecture, puis rouvre cet
                écran.
              </Text>
            ) : (
              journalEntries.map((entry, index) => (
                <Text key={index} selectable style={styles.journalEntry}>
                  {entry}
                </Text>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>À propos</Text>

        <View style={styles.card}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Version</Text>
            <Text style={styles.infoValue}>{appVersion}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Plateforme</Text>
            <Text style={styles.infoValue}>
              {Platform.OS === 'android' ? 'Android' : 'iOS'} ({Platform.Version})
            </Text>
          </View>
        </View>

        <AppButton
          title={`Visiter ${primaryUrl.replace(/^https?:\/\//, '')}`}
          systemImage="safari"
          variant="primary"
          compact
          accessibilityRole="link"
          onPress={() => Linking.openURL(primaryUrl)}
          style={{ marginTop: 12 }}
          fallbackStyle={styles.linkButton}
          fallbackTextStyle={styles.linkText}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    color: '#8b5cf6',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#151515',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLeft: {
    flex: 1,
    marginRight: 12,
  },
  rowTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  rowSubtitle: {
    color: '#888888',
    fontSize: 13,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: '#1f1f1f',
    marginVertical: 12,
  },
  infoBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  infoLabel: {
    color: '#888888',
    fontSize: 14,
  },
  infoValue: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  hint: {
    color: '#666666',
    fontSize: 12,
    marginTop: 8,
    marginLeft: 4,
    lineHeight: 18,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeActive: {
    backgroundColor: '#22c55e20',
  },
  badgeText: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '600',
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  linkText: {
    color: '#8b5cf6',
    fontSize: 14,
    fontWeight: '500',
  },
  journalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  journalEntry: {
    color: '#d4d4d4',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 12,
  },
});
