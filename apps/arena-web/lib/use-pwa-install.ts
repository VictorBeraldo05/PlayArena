'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

type InstallChoice = 'accepted' | 'dismissed';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: InstallChoice }>;
};

function isStandaloneMode() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}

function isIOSDevice() {
  const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const iPadDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return appleMobile || iPadDesktopMode;
}

function subscribeToStandalone(onChange: () => void) {
  const displayMode = window.matchMedia('(display-mode: standalone)');
  displayMode.addEventListener('change', onChange);
  window.addEventListener('appinstalled', onChange);

  return () => {
    displayMode.removeEventListener('change', onChange);
    window.removeEventListener('appinstalled', onChange);
  };
}

function subscribeToEnvironment() {
  return () => undefined;
}

function getServerEnvironment() {
  return false;
}

export function usePwaInstall() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [hasAcceptedInstall, setHasAcceptedInstall] = useState(false);
  const isStandalone = useSyncExternalStore(subscribeToStandalone, isStandaloneMode, getServerEnvironment);
  const isIOS = useSyncExternalStore(subscribeToEnvironment, isIOSDevice, getServerEnvironment);

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      deferredPrompt.current = event as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const markInstalled = () => {
      deferredPrompt.current = null;
      setCanInstall(false);
      setHasAcceptedInstall(true);
    };

    window.addEventListener('beforeinstallprompt', capturePrompt);
    window.addEventListener('appinstalled', markInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt);
      window.removeEventListener('appinstalled', markInstalled);
    };
  }, []);

  async function install() {
    const prompt = deferredPrompt.current;
    if (!prompt) return 'unavailable' as const;

    await prompt.prompt();
    const choice = await prompt.userChoice;
    deferredPrompt.current = null;
    setCanInstall(false);

    if (choice.outcome === 'accepted') setHasAcceptedInstall(true);
    return choice.outcome;
  }

  return {
    canInstall,
    isIOS,
    isInstalled: isStandalone || hasAcceptedInstall,
    isStandalone,
    install,
  };
}
