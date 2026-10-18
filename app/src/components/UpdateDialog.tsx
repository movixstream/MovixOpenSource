import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AppButton from './AppButton';
import type { Manifest } from '../services/versionCheck';

type Props = {
  manifest: Manifest;
  locale: 'fr' | 'en';
  onLater: () => void;
  onUpdate: () => void;
};

export default function UpdateDialog({
  manifest,
  locale,
  onLater,
  onUpdate,
}: Props) {
  const notes =
    manifest.releaseNotes[locale] || manifest.releaseNotes.fr || '';
  const sizeMb = (manifest.apkSizeBytes / (1024 * 1024)).toFixed(1);

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      // If mandatory, swallow back button: no-op
      onRequestClose={manifest.mandatory ? () => {} : onLater}
      statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
          <Text style={styles.title}>
            Nouvelle version {manifest.version} disponible
          </Text>
          <Text style={styles.subtitle}>Taille : {sizeMb} MB</Text>

          {!!notes && (
            <ScrollView style={styles.notesBox} nestedScrollEnabled>
              <Text style={styles.notes}>{notes}</Text>
            </ScrollView>
          )}

          <View style={styles.actions}>
            {!manifest.mandatory && (
              <AppButton
                title="Plus tard"
                onPress={onLater}
                style={styles.buttonLayout}
                fallbackStyle={[styles.button, styles.buttonSecondary]}
                fallbackTextStyle={styles.buttonTextSecondary}
              />
            )}
            <AppButton
              title="Mettre à jour"
              variant="primary"
              onPress={onUpdate}
              style={styles.buttonLayout}
              fallbackStyle={[styles.button, styles.buttonPrimary]}
              fallbackTextStyle={styles.buttonTextPrimary}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#151515',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  subtitle: {
    color: '#8a8a8a',
    fontSize: 13,
    marginBottom: 14,
  },
  notesBox: {
    maxHeight: 160,
    marginBottom: 18,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#0c0c0c',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  notes: {
    color: '#d0d0d0',
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  buttonLayout: {
    flex: 1,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#8b5cf6',
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#333333',
  },
  buttonTextPrimary: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonTextSecondary: {
    color: '#c4c4c4',
    fontSize: 15,
    fontWeight: '500',
  },
});
