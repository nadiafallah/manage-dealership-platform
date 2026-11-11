'use client';
import { ControlRoom } from '@/components/ControlRoom';
import { useAuth } from '@/lib/auth';

/** Control room (spec §10): service manager and owner; display and «تذکر» only. */
export default function ControlRoomPage() {
  const { can } = useAuth();
  if (!can('report.manager')) return <p className="callout">اتاق کنترل برای مدیر خدمات و مالک باز است.</p>;
  return <ControlRoom />;
}
