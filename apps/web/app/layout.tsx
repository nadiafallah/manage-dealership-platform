import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
// Self-hosted Vazirmatn: no request to Google Fonts (unreliable from Iran, and
// the app must work on the dealership LAN without internet).
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/800.css';
import './globals.css';
// New design language (spec section 12); components are prefixed m-.
import './manage-ui.css';
import { ToastProvider } from '@/lib/toast';
import {InstallProvider} from '@/components/InstallApp';
import {NetworkStatus} from '@/components/NetworkStatus';

// One visual language (docs/PRODUCT_SPEC_FA.md §12): paper desks and a dark login/control room.
// The former «signature» and «?ui=classic» skins were removed in package 6.

export const metadata: Metadata = {
  title: 'Manage by HEDAX',
  description: 'سامانه مدیریت عملیات نمایندگی خودرو',
  robots: { index: false, follow: false },
  applicationName:'Manage',
  appleWebApp:{capable:true,title:'Manage',statusBarStyle:'default'},
  icons:{apple:[{url:'/brand/apple-touch-icon.png',sizes:'180x180',type:'image/png'}]},
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f3f1ec',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" data-ui="paper" suppressHydrationWarning>
      <body>
        <ToastProvider><InstallProvider><NetworkStatus/>{children}</InstallProvider></ToastProvider>
      </body>
    </html>
  );
}
