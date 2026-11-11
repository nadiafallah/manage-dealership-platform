'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { AppIcon, type IconName } from '@/components/AppIcon';
import { InstallButton } from '@/components/InstallApp';

interface Item { href: string; title: string; detail: string; icon: IconName; show: boolean }

/** Settings hub: every settings area the account may open, in one place (no dead links). */
export default function SettingsPage() {
  const { me, can } = useAuth();
  const items: Item[] = [
    { href: '/users', title: 'کارکنان و دعوت', detail: 'ساخت حساب، پین، غیرفعال‌سازی و بایگانی کارکنان', icon: 'team', show: can('user.manage') || !!me.isOwner },
    { href: '/users#access-control', title: 'دسترسی‌ها', detail: 'مجوز پایهٔ هر نقش و استثنای هر نفر', icon: 'shield', show: !!me.isOwner },
    { href: '/users#owner-admin', title: 'اجازه‌های مدیر سیستم', detail: 'دادن یا گرفتن اجازهٔ دعوت و گزارش کارهای پشتیبانی', icon: 'lock', show: !!me.isOwner },
    { href: '/workshop/settings', title: 'تقویم، جایگاه‌ها و سقف هشدارها', detail: 'ساعت کاری، کد جایگاه‌ها، سقف هزینه، قطعهٔ گران و روزهای امداد دیرشده', icon: 'calendar', show: can('workshop.read') || can('calendar.manage') || can('settings.manage') },
    { href: '/daily-reports', title: 'گزارش‌های روزانه', detail: 'بارگذاری موجودی کسب‌وکار و امداد ویژه، ساعت یادآوری', icon: 'upload', show: can('daily_reports.upload') || can('daily_reports.apply') || can('daily_reports.settings') },
    { href: '/reference-data', title: 'اطلاعات پایه', detail: 'کاتالوگ قطعات و سوابق پذیرش', icon: 'database', show: can('reference.parts.read') || can('reference.customers.read') },
  ];
  const visible = items.filter((i) => i.show);
  return (
    <section className="settings-hub" aria-labelledby="settings-title">
      <header className="page-title">
        <span className="page-title-ico" aria-hidden="true"><AppIcon name="gear" /></span>
        <div><h1 id="settings-title">تنظیمات</h1><p>{me.tenant.name}</p></div>
      </header>
      {!visible.length && <p className="m-empty">تنظیمی برای نقش شما نیست.</p>}
      <div className="settings-grid">
        {visible.map((i) => (
          <Link key={i.href} href={i.href} className="settings-card">
            <span className="settings-ico" aria-hidden="true"><AppIcon name={i.icon} /></span>
            <strong>{i.title}</strong>
            <span>{i.detail}</span>
          </Link>
        ))}
      </div>
      <div className="settings-install"><InstallButton /></div>
    </section>
  );
}
