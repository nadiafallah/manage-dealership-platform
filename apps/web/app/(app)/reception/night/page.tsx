'use client';
import { Suspense } from 'react';
import { NightList } from '@/components/NightList';

/** «لیست شب» of the reception module (reconstruction scenario, owner 2026-11-25). */
export default function ReceptionNightPage() {
  return <Suspense fallback={<p className="m-empty" role="status">در حال بارگذاری…</p>}><NightList /></Suspense>;
}
