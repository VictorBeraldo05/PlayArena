import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@playarena/config';

import { AuthProvider } from '../providers/auth-provider';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'fade',
        }}
      />
    </AuthProvider>
  );
}
