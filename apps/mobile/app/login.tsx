import { Href, Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, touchTargets, typography } from '@playarena/config';

import { AuthScreen } from '../components/auth-screen';
import { FormField } from '../components/form-field';
import { StatusBanner } from '../components/status-banner';
import { useAuth } from '../hooks/use-auth';

export default function LoginScreen() {
  const router = useRouter();
  const { session, isLoading, signIn, errorMessage, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!isLoading && session) {
      router.replace('/home');
    }
  }, [isLoading, router, session]);

  async function handleSignIn() {
    const success = await signIn(email.trim(), password);
    if (success) {
      router.replace('/home');
    }
  }

  return (
    <AuthScreen
      eyebrow="Acesso"
      title="Entre para acompanhar reservas e disponibilidade."
      subtitle="Seu login e a sessao sao compartilhados com o painel da arena."
      footer={
        <Text style={styles.footerText}>
          Ainda nao tem conta?{' '}
          <Link href={'/signup' as Href} style={styles.link} onPress={clearError}>
            Criar cadastro
          </Link>
        </Text>
      }
    >
      <View style={styles.form}>
        {errorMessage ? <StatusBanner message={errorMessage} /> : null}
        <FormField
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          label="E-mail"
          onChangeText={setEmail}
          placeholder="voce@exemplo.com"
          value={email}
        />
        <FormField
          autoCapitalize="none"
          autoComplete="password"
          label="Senha"
          onChangeText={setPassword}
          placeholder="Sua senha"
          secureTextEntry
          value={password}
        />
        <Pressable onPress={handleSignIn} style={styles.button}>
          <Text style={styles.buttonText}>Entrar</Text>
        </Pressable>
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>MVP mobile first com sessao persistente e profile no Supabase.</Text>
        </View>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
  },
  button: {
    minHeight: touchTargets.primaryButton,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  buttonText: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
  },
  noteBox: {
    borderRadius: radii.md,
    backgroundColor: colors.card,
    padding: spacing.md,
  },
  noteText: {
    color: colors.secondaryText,
    fontSize: typography.caption,
    lineHeight: 20,
  },
  footerText: {
    color: colors.text,
    fontSize: typography.caption,
    lineHeight: 20,
  },
  link: {
    color: colors.primary,
    fontWeight: '700',
  },
});
