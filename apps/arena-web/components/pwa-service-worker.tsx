'use client';

import { useEffect } from 'react';

export function PwaServiceWorker() {
  useEffect(() => {
    const canRegister = 'serviceWorker' in navigator
      && (window.isSecureContext || window.location.hostname === 'localhost');

    if (!canRegister) return;

    const registration = window.setTimeout(() => {
      void navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      }).catch(() => undefined);
    }, 0);

    return () => window.clearTimeout(registration);
  }, []);

  return null;
}
