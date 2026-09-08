import { Href, Link, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, touchTargets, typography } from '@playarena/config';

import { AuthScreen } from '../components/auth-screen';
import { FormField } from '../components/form-field';
import { StatusBanner } from '../components/status-banner';
import { useAuth } from '../hooks/use-auth';

export default function SignUpScreen() {
  const router = useRouter();
  const { session, isLoading, signUp, errorMessage, clearError } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionLock = useRef(false);

  useEffect(() => {
    if (!isLoading && session) {
      router.replace('/home');
    }
  }, [isLoading, router, session]);

  async function handleSignUp() {
    if (isSubmitting || submissionLock.current) {
      return;
    }

    clearError();
    setInfoMessage(null);

    if (password !== confirmPassword) {
      setInfoMessage('As senhas precisam ser iguais para continuar.');
      return;
    }

    submissionLock.current = true;
    setIsSubmitting(true);
    let success = false;

    try {
      success = await signUp({
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        password,
      });

      if (success) {
        setInfoMessage('Conta criada. Se o projeto exigir confirmacao por e-mail, valide sua caixa de entrada.');
      }
    } finally {
      if (!success) {
        submissionLock.current = false;
        setIsSubmitting(false);
      }
    }
  }

  return (
    <AuthScreen
      eyebrow="Cadastro"
      title="Crie sua conta para reservar arenas pelo app."
      subtitle="O profile e criado de forma segura no banco logo apos o signup."
      footer={
        <Text style={styles.footerText}>
          Ja tem conta?{' '}
          <Link href={'/login' as Href} style={styles.link} onPress={clearError}>
            Fazer login
          </Link>
        </Text>
      }
    >
      <View style={styles.form}>
        {errorMessage ? <StatusBanner message={errorMessage} /> : null}
        {infoMessage ? <StatusBanner message={infoMessage} tone="info" /> : null}
        <FormField label="Nome completo" onChangeText={setFullName} placeholder="Seu nome" value={fullName} />
        <FormField
          keyboardType="phone-pad"
          label="Telefone"
          onChangeText={setPhone}
          placeholder="(19) 99999-9999"
          value={phone}
        />
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
          placeholder="Crie uma senha"
          secureTextEntry
          value={password}
        />
        <FormField
          autoCapitalize="none"
          label="Confirmar senha"
          onChangeText={setConfirmPassword}
          placeholder="Repita a senha"
          secureTextEntry
          value={confirmPassword}
        />
        <Pressable
          accessibilityState={{ disabled: isSubmitting }}
          disabled={isSubmitting}
          onPress={handleSignUp}
          style={[styles.button, isSubmitting && styles.buttonDisabled]}
        >
          {isSubmitting ? <ActivityIndicator color={colors.background} /> : null}
          <Text style={styles.buttonText}>{isSubmitting ? 'Criando conta...' : 'Criar conta'}</Text>
        </Pressable>
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
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
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
