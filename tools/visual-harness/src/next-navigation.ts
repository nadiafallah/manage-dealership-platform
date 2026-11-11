import { useMemo } from 'react';
import { navigate, useLocation, useRouteParams } from './router';

export function usePathname() { return useLocation().split('?')[0]!; }
export function useSearchParams() {
  const loc = useLocation();
  return useMemo(() => new URLSearchParams(loc.includes('?') ? loc.slice(loc.indexOf('?')) : ''), [loc]);
}
export function useParams() { return useRouteParams(); }
export function useRouter() {
  return { push: (h: string) => navigate(h), replace: (h: string) => navigate(h, true), back: () => history.back(), refresh: () => {}, prefetch: () => {} };
}
export function redirect(h: string): never { navigate(h, true); throw new Error('redirect'); }
export function notFound(): never { throw new Error('not found'); }
