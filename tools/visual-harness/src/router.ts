// Tiny client router standing in for the Next app router inside the harness.
import { createContext, useContext, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') window.addEventListener('popstate', emit);

export function navigate(href: string, replace = false) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) { location.href = href; return; }
  const same = url.pathname === location.pathname && url.search === location.search;
  history[replace ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search + url.hash);
  emit();
  if (!same && !url.hash) window.scrollTo(0, 0);
  if (url.hash) document.getElementById(url.hash.slice(1))?.scrollIntoView();
}
const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };
export function useLocation() {
  return useSyncExternalStore(subscribe, () => location.pathname + location.search);
}
export const ParamsContext = createContext<Record<string, string | string[] | undefined>>({});
export const useRouteParams = () => useContext(ParamsContext);
