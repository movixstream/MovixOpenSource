import React from 'react';
import {
  Platform,
  requireNativeComponent,
  Text,
  TouchableOpacity,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

export type AppButtonVariant = 'primary' | 'secondary' | 'destructive';

type Props = {
  title: string;
  onPress: () => void;
  variant?: AppButtonVariant;
  disabled?: boolean;
  /** Bouton plus bas (44 pt au lieu de 50 pt) pour les listes et en-têtes. */
  compact?: boolean;
  /** Nom de symbole SF affiché devant le titre sur iOS. */
  systemImage?: string;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link';
  /** Mise en page commune aux deux plateformes (flex, marges, largeur). */
  style?: StyleProp<ViewStyle>;
  /** Apparence Android, qui garde ses boutons React Native. */
  fallbackStyle?: StyleProp<ViewStyle>;
  fallbackTextStyle?: StyleProp<TextStyle>;
};

type NativeProps = {
  title: string;
  systemImage?: string;
  variant: AppButtonVariant;
  enabled: boolean;
  compact: boolean;
  label?: string;
  onButtonPress: (event: NativeSyntheticEvent<Record<string, never>>) => void;
  style?: StyleProp<ViewStyle>;
};

const NativeGlassButton = Platform.OS === 'ios'
  ? requireNativeComponent<NativeProps>('MovixGlassButton')
  : null;

/**
 * Bouton natif : SwiftUI Liquid Glass sur iOS (styles bordés système avant
 * iOS 26), TouchableOpacity sur Android.
 */
export default function AppButton({
  title,
  onPress,
  variant = 'secondary',
  disabled = false,
  compact = false,
  systemImage,
  accessibilityLabel,
  accessibilityRole = 'button',
  style,
  fallbackStyle,
  fallbackTextStyle,
}: Props) {
  if (NativeGlassButton) {
    return (
      <NativeGlassButton
        title={title}
        systemImage={systemImage}
        variant={variant}
        enabled={!disabled}
        compact={compact}
        label={accessibilityLabel}
        onButtonPress={() => {
          if (!disabled) onPress();
        }}
        style={[{ height: compact ? 44 : 52 }, style]}
      />
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      activeOpacity={0.8}
      style={[fallbackStyle, style]}>
      <Text style={fallbackTextStyle}>{title}</Text>
    </TouchableOpacity>
  );
}
