import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@playarena/config';

export function StatusBanner({ message, tone = 'error' }: { message: string; tone?: 'error' | 'info' }) {
  return (
    <View
      style={[
        styles.container,
        { borderColor: tone === 'error' ? 'rgba(255,75,75,0.35)' : 'rgba(143,255,60,0.35)' },
      ]}
    >
      <Text style={[styles.text, { color: tone === 'error' ? colors.error : colors.primary }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    padding: spacing.md,
  },
  text: {
    fontSize: typography.caption,
    lineHeight: 20,
  },
});
