'use client';
import { Suspense } from 'react';
import { PartsDesk } from '@/components/PartsDesk';
import { useAuth } from '@/lib/auth';

/** Parts desk (spec §7): the parts clerk's workplace; the accident expert reads the same lists. */
export default function PartsPage() {
  const { can } = useAuth();
  if (!can('case.read')) return <p className="callout">میز قطعات برای نقش شما باز نیست.</p>;
  return <Suspense fallback={<p className="m-empty" role="status">در حال بارگذاری…</p>}><PartsDesk /></Suspense>;
}
