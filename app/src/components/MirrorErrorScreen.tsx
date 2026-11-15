import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from './AppButton';

interface Props {
  telegramUrl: string;
  onRetry: () => void;
}

export default function MirrorErrorScreen({ telegramUrl, onRetry }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}>
      <View style={styles.content}>
        <Text style={styles.title}>Movix injoignable</Text>
        <Text style={styles.body}>
          Tous les domaines Movix semblent bloqués ou hors ligne. Rejoins le
          canal Matrix pour récupérer le nouveau lien officiel.
        </Text>

        <AppButton
          title="Ouvrir Matrix"
          variant="primary"
          systemImage="bubble.left.and.bubble.right.fill"
          accessibilityRole="link"
          onPress={() => Linking.openURL(telegramUrl)}
          style={[styles.buttonLayout, { marginBottom: 12 }]}
          fallbackStyle={styles.primaryButton}
          fallbackTextStyle={styles.primaryText}
        />

        <AppButton
          title="Réessayer"
          systemImage="arrow.clockwise"
          onPress={onRetry}
          style={styles.buttonLayout}
          fallbackStyle={styles.secondaryButton}
          fallbackTextStyle={styles.secondaryText}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    color: '#a1a1aa',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
  },
  buttonLayout: {
    minWidth: 200,
  },
  primaryButton: {
    backgroundColor: '#8b5cf6',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  secondaryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '500',
  },
});
