import React, { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import AppButton from './AppButton';

export type DialogButtonStyle = 'default' | 'cancel' | 'destructive';

export interface DialogAction {
  text: string;
  style?: DialogButtonStyle;
  onPress?: () => void;
}

export interface DialogOptions {
  title: string;
  body?: string;
  actions?: DialogAction[];
}

type Setter = (opts: DialogOptions | null) => void;
let currentSetter: Setter | null = null;

export function showDialog(
  title: string,
  body?: string,
  actions?: DialogAction[],
): void {
  const opts: DialogOptions = {
    title,
    body,
    actions: actions && actions.length > 0 ? actions : [{ text: 'OK' }],
  };
  if (currentSetter) {
    currentSetter(opts);
  } else {
    console.warn('[Dialog] showDialog called before DialogProvider mounted');
  }
}

export function hideDialog(): void {
  currentSetter?.(null);
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<DialogOptions | null>(null);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    currentSetter = setOptions;
    return () => {
      if (currentSetter === setOptions) currentSetter = null;
    };
  }, []);

  // Les animations natives (useNativeDriver) s'enchaînent en parallèle : le
  // backdrop fait un fade simple, le card combine fade + scale avec un
  // léger overshoot pour un effet "pop" discret.
  useEffect(() => {
    if (options) {
      overlayOpacity.setValue(0);
      cardOpacity.setValue(0);
      cardScale.setValue(0.92);
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(cardScale, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [options, overlayOpacity, cardOpacity, cardScale]);

  const runAction = (action: DialogAction | undefined) => {
    // Fade out rapide avant de démonter le Modal, puis on déclenche l'action.
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 140,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 140,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        toValue: 0.96,
        duration: 140,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setOptions(null);
      action?.onPress?.();
    });
  };

  const onRequestClose = () => {
    const actions = options?.actions ?? [];
    const cancel = actions.find(a => a.style === 'cancel');
    runAction(cancel ?? actions[0]);
  };

  const actions = options?.actions ?? [];
  const horizontal = actions.length <= 2;

  return (
    <>
      {children}
      <Modal
        transparent
        visible={!!options}
        animationType="none"
        onRequestClose={onRequestClose}
        statusBarTranslucent
      >
        <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
          <Animated.View
            style={[
              styles.card,
              { opacity: cardOpacity, transform: [{ scale: cardScale }] },
            ]}
            accessibilityViewIsModal
            accessibilityRole="alert">
            {options && (
              <>
                <Text style={styles.title}>{options.title}</Text>
                {!!options.body && (
                  <Text style={styles.body}>{options.body}</Text>
                )}
                <View
                  style={[
                    styles.actions,
                    horizontal ? styles.actionsRow : styles.actionsColumn,
                  ]}>
                  {actions.map((action, i) => {
                    const style = action.style ?? 'default';
                    return (
                      <AppButton
                        key={`${action.text}-${i}`}
                        title={action.text}
                        onPress={() => runAction(action)}
                        variant={
                          style === 'cancel'
                            ? 'secondary'
                            : style === 'destructive'
                              ? 'destructive'
                              : 'primary'
                        }
                        style={horizontal && styles.buttonHorizontal}
                        fallbackStyle={[
                          styles.button,
                          style === 'cancel' && styles.buttonCancel,
                          style === 'destructive' && styles.buttonDestructive,
                          style === 'default' && styles.buttonDefault,
                        ]}
                        fallbackTextStyle={[
                          styles.buttonText,
                          style === 'cancel' && styles.buttonTextCancel,
                        ]}
                      />
                    );
                  })}
                </View>
              </>
            )}
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
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
    marginBottom: 10,
  },
  body: {
    color: '#c4c4c4',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  actions: {
    marginTop: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionsColumn: {
    flexDirection: 'column',
    gap: 8,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonHorizontal: {
    flex: 1,
  },
  buttonDefault: {
    backgroundColor: '#8b5cf6',
  },
  buttonCancel: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#333333',
  },
  buttonDestructive: {
    backgroundColor: '#ef4444',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonTextCancel: {
    color: '#c4c4c4',
    fontWeight: '500',
  },
});
