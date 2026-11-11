// Minimal SWR 2 stand-in: shared cache, revalidation, mutate, keepPreviousData.
import { useEffect, useReducer, useRef } from 'react';

type Fetcher = (...a: any[]) => Promise<any>;
const cache = new Map<string, any>();
const errors = new Map<string, any>();
const inflight = new Map<string, Promise<any>>();
const subs = new Map<string, Set<() => void>>();
const fetchers = new Map<string, { fetcher: Fetcher; args: any[] }>();
const ser = (k: unknown) => (k == null || k === false ? null : typeof k === 'string' ? k : JSON.stringify(k));
const notify = (k: string) => subs.get(k)?.forEach((f) => f());

async function revalidate(k: string) {
  const f = fetchers.get(k);
  if (!f) return cache.get(k);
  if (inflight.has(k)) return inflight.get(k);
  const p = f.fetcher(...f.args).then(
    (d) => { if (d !== null) { cache.set(k, d); errors.delete(k); } return d; },
    (e) => { errors.set(k, e); },
  ).finally(() => { inflight.delete(k); notify(k); });
  inflight.set(k, p);
  return p;
}

export async function mutate(key: unknown, data?: unknown, _opts?: unknown) {
  const keys = typeof key === 'function' ? [...fetchers.keys()].filter((k) => { try { return (key as (k: string) => boolean)(k); } catch { return false; } }) : [ser(key)].filter(Boolean) as string[];
  for (const k of keys) {
    if (data !== undefined && typeof data !== 'function') { cache.set(k, await data); notify(k); }
    else await revalidate(k);
  }
}
export function useSWRConfig() { return { mutate, cache }; }
export const SWRConfig = ({ children }: { children: any }) => children;

export default function useSWR(key: unknown, fetcher?: Fetcher | null, config?: { keepPreviousData?: boolean; fallbackData?: unknown }) {
  const resolved = typeof key === 'function' ? (() => { try { return (key as () => unknown)(); } catch { return null; } })() : key;
  const k = ser(resolved);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const prev = useRef<unknown>(undefined);
  if (k && fetcher) fetchers.set(k, { fetcher, args: Array.isArray(resolved) ? resolved : [resolved] });
  useEffect(() => {
    if (!k) return;
    let set = subs.get(k);
    if (!set) subs.set(k, (set = new Set()));
    set.add(force);
    if (!cache.has(k)) void revalidate(k);
    return () => { set!.delete(force); };
  }, [k]);
  let data = k ? cache.get(k) : undefined;
  if (data === undefined && config?.keepPreviousData) data = prev.current;
  if (data === undefined && config?.fallbackData !== undefined) data = config.fallbackData;
  if (k && cache.has(k)) prev.current = cache.get(k);
  return {
    data,
    error: k ? errors.get(k) : undefined,
    isLoading: !!k && !cache.has(k) && !errors.has(k),
    isValidating: !!k && inflight.has(k),
    mutate: (d?: unknown) => (k ? mutate(k, d) : Promise.resolve(undefined)),
  };
}
