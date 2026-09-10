'use client';

/* This controller intentionally coordinates route-scoped refs and timers outside render. */
/* eslint-disable react-hooks/purity, react-hooks/refs, react-hooks/set-state-in-effect */

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

import { useAuth } from '../components/use-auth';
import { trackEvent } from '../lib/analytics';

type PageReadyContextValue = { register: (id: string) => () => void; resolve: (id: string) => void };
type LoaderVariant = 'initial' | 'navigation';

const PageReadyContext = createContext<PageReadyContextValue | null>(null);
const MINIMUM_LOADER_MS = 380;
const MAXIMUM_LOADER_MS = 5000;

export function PageReadyProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoading: authLoading } = useAuth();
  const routeRef = useRef(pathname);
  const resourcesRef = useRef(new Map<string, boolean>());
  const startedAtRef = useRef(Date.now());
  const timeoutRef = useRef<number | null>(null);
  const authLoadingRef = useRef(authLoading);
  const isLandingRef = useRef(pathname === '/');
  const hasVisitedRouteRef = useRef(pathname === '/');
  const [isLoading, setIsLoading] = useState(pathname !== '/');
  const [loaderVariant, setLoaderVariant] = useState<LoaderVariant>(pathname === '/' ? 'navigation' : 'initial');
  const [revision, setRevision] = useState(0);
  const isLanding = pathname === '/';
  authLoadingRef.current = authLoading;
  isLandingRef.current = isLanding;

  if (routeRef.current !== pathname) {
    routeRef.current = pathname;
    resourcesRef.current.clear();
    startedAtRef.current = Date.now();
  }

  const evaluate = useCallback(() => {
    if (isLandingRef.current || authLoadingRef.current) return;
    const allResolved = [...resourcesRef.current.values()].every(Boolean);
    if (!allResolved) return;
    const remaining = Math.max(0, MINIMUM_LOADER_MS - (Date.now() - startedAtRef.current));
    window.setTimeout(() => setIsLoading(false), remaining);
  }, []);

  useEffect(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (isLanding) { hasVisitedRouteRef.current = true; setIsLoading(false); return; }
    setLoaderVariant(hasVisitedRouteRef.current ? 'navigation' : 'initial');
    hasVisitedRouteRef.current = true;
    startedAtRef.current = Date.now();
    setIsLoading(true);
    timeoutRef.current = window.setTimeout(() => setIsLoading(false), MAXIMUM_LOADER_MS);
    const task = window.setTimeout(evaluate, 0);
    return () => { window.clearTimeout(task); if (timeoutRef.current) window.clearTimeout(timeoutRef.current); };
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { evaluate(); }, [authLoading, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { trackEvent('app_opened', { dedupeKey: 'app-opened' }); }, []);
  useEffect(() => {
    function beginLinkedNavigation(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!target || target.target === '_blank' || target.hasAttribute('download')) return;
      const url = new URL(target.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === pathname) return;
      startedAtRef.current = Date.now();
      setLoaderVariant('navigation');
      setIsLoading(true);
    }
    document.addEventListener('click', beginLinkedNavigation, true);
    return () => document.removeEventListener('click', beginLinkedNavigation, true);
  }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = isLoading ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isLoading]);

  const value = useMemo<PageReadyContextValue>(() => ({
    register(id) {
      resourcesRef.current.set(id, false);
      setRevision((value) => value + 1);
      return () => { resourcesRef.current.delete(id); setRevision((value) => value + 1); };
    },
    resolve(id) {
      if (!resourcesRef.current.has(id)) return;
      resourcesRef.current.set(id, true);
      setRevision((value) => value + 1);
    },
  }), []);

  return <PageReadyContext.Provider value={value}><div className={`page-ready-content ${isLoading ? `is-pending is-${loaderVariant}` : 'is-ready'}`}>{children}</div>{!isLanding ? <PlayArenaPageLoader variant={loaderVariant} visible={isLoading} /> : null}</PageReadyContext.Provider>;
}

export function PageReadyGate({ resourceId, ready, enabled = true }: { resourceId: string; ready: boolean; enabled?: boolean }) {
  usePageReadyResource(resourceId, ready, enabled);
  return null;
}

export function usePageReadyResource(resourceId: string, ready: boolean, enabled = true) {
  const context = useContext(PageReadyContext);
  const id = useId();
  const key = `${resourceId}-${id}`;
  useEffect(() => enabled ? context?.register(key) : undefined, [context, enabled, key]);
  useEffect(() => { if (enabled && ready) context?.resolve(key); }, [context, enabled, key, ready]);
}

function PlayArenaPageLoader({ visible, variant }: { visible: boolean; variant: LoaderVariant }) {
  return <div aria-live="polite" aria-hidden={!visible} className={`playarena-page-loader is-${variant} ${visible ? 'is-visible' : ''}`} role="status"><span className="sr-only">Carregando</span><div className="playarena-loader-mark" aria-hidden="true"><strong>PLAY<span>ARENA</span></strong><i><b /></i></div></div>;
}
