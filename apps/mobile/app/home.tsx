import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { colors, radii, spacing, typography } from '@playarena/config';

import { useAuth } from '../hooks/use-auth';

const quickActions = ['Buscar', 'Reservas', 'Favoritos', 'Perfil'];

export default function HomeScreen() {
  const router = useRouter();
  const { session, profile, signOut, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !session) {
      router.replace('/login');
    }
  }, [isLoading, router, session]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Bem-vindo, {profile?.full_name ?? 'jogador'}.</Text>
          <Text style={styles.subtitle}>
            Sessao ativa com Supabase Auth e profile recuperado ao abrir o app.
          </Text>
        </View>
        <Pressable
          onPress={() => {
            void signOut();
            router.replace('/login');
          }}
          style={styles.logoutButton}
        >
          <Text style={styles.logoutText}>Sair</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {quickActions.map((item) => (
          <View key={item} style={styles.tile}>
            <Text style={styles.tileText}>{item}</Text>
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing['2xl'],
    gap: spacing.xl,
  },
  header: {
    gap: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.secondaryText,
    fontSize: typography.body,
    lineHeight: 24,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tile: {
    width: '47%',
    minHeight: 124,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    padding: spacing.lg,
    justifyContent: 'flex-end',
  },
  tileText: {
    color: colors.text,
    fontSize: typography.subtitle,
    fontWeight: '600',
  },
  logoutButton: {
    alignSelf: 'flex-start',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  logoutText: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: '600',
  },
});
