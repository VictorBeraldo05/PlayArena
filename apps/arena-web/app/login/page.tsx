import { AuthForm } from '../../components/auth-form';
import { Suspense } from 'react';

export default function LoginPage() {
  return <Suspense fallback={<main className="min-h-[100dvh] bg-[#080D14]" />}><AuthForm /></Suspense>;
}
