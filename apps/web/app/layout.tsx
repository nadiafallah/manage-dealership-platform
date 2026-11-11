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
// HEDAX Signature visual layer; every rule is scoped to html[data-ui="signature"].
import './signature.css';
// New design language (spec section 12); components are prefixed m-.
import './manage-ui.css';
import { ToastProvider } from '@/lib/toast';
import {InstallProvider} from '@/components/InstallApp';
import {NetworkStatus} from '@/components/NetworkStatus';
import {SpatialLight} from '@/components/SpatialLight';

// Visual theme: "signature" (default) or "classic". The build default comes from
// NEXT_PUBLIC_UI_THEME; ?ui=classic|signature overrides it in one browser (stored locally),
// so both interfaces can be compared without a redeploy. Data and behaviour are identical.
const DEFAULT_UI = process.env.NEXT_PUBLIC_UI_THEME === 'classic' ? 'classic' : 'signature';
const UI_BOOT = `try{var d=document.documentElement,q=new URLSearchParams(location.search).get('ui');if(q==='classic'||q==='signature')localStorage.setItem('manage-ui',q);var v=localStorage.getItem('manage-ui');if(v==='classic'||v==='signature')d.dataset.ui=v;var m=document.querySelector('meta[name=theme-color]');if(m)m.content=d.dataset.ui==='signature'?'#07090c':'#1a202c'}catch(e){}`;

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
  themeColor: DEFAULT_UI === 'signature' ? '#07090c' : '#1a202c',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" data-ui={DEFAULT_UI} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: UI_BOOT }} />
      </head>
      <body>
        <ToastProvider><InstallProvider><NetworkStatus/><SpatialLight/>{children}</InstallProvider></ToastProvider>
      </body>
    </html>
  );
}
