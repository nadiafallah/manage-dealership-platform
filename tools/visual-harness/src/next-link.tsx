import type { MouseEvent, ReactNode } from 'react';
import { navigate } from './router';

type Href = string | { pathname?: string; query?: Record<string, string> };
const toHref = (h: Href) => (typeof h === 'string' ? h : `${h.pathname ?? ''}${h.query ? `?${new URLSearchParams(h.query)}` : ''}`);

export default function Link({ href, children, prefetch: _p, replace, scroll: _s, shallow: _sh, onClick, ...rest }: { href: Href; children?: ReactNode; prefetch?: unknown; replace?: boolean; scroll?: boolean; shallow?: boolean; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void; [k: string]: unknown }) {
  const url = toHref(href);
  return (
    <a
      href={url}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === '_blank') return;
        e.preventDefault();
        navigate(url, !!replace);
      }}
    >
      {children}
    </a>
  );
}
