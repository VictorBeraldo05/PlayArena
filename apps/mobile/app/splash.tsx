import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { colors, spacing, typography } from '@playarena/config';

import { useAuth } from '../hooks/use-auth';

export default function SplashScreen() {
  const router = useRouter();
  const { isLoading, session } = useAuth();

  useEffect(() => {
    if (isLoading) {
      return;
    }

    router.replace(session ? '/home' : '/login');
  }, [isLoading, router, session]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>PLAYARENA</Text>
        <Text style={styles.title}>Preparando sua proxima partida.</Text>
        <Text style={styles.subtitle}>Verificando sessao e sincronizando seu acesso.</Text>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  content: {
    gap: spacing.lg,
    alignItems: 'flex-start',
  },
  eyebrow: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
    lineHeight: 36,
  },
  subtitle: {
    color: colors.secondaryText,
    fontSize: typography.body,
    lineHeight: 24,
  },
});
