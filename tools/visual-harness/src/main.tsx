// Visual harness: the real Manage pages and CSS, rendered in a browser with a
// synthetic in-page API. For screenshots and interaction checks only.
import { createRoot } from 'react-dom/client';
import { Component, type ReactNode } from 'react';
import { installBackend, type As } from './backend';
import { ParamsContext, useLocation } from './router';
import { ToastProvider } from '@/lib/toast';
import { InstallProvider } from '@/components/InstallApp';
import AppLayout from '@/app/(app)/layout';
import LoginPage from '@/app/login/page';
import Home from '@/app/(app)/page';
import ControlRoomPage from '@/app/(app)/control-room/page';
import Accidents from '@/app/(app)/accidents/[[...workspace]]/page';
import CasePage from '@/app/(app)/cases/[id]/page';
import CasesPage from '@/app/(app)/cases/page';
import PartsPage from '@/app/(app)/parts/page';
import SettingsPage from '@/app/(app)/settings/page';
import ReportsPage from '@/app/(app)/reports/page';
import UsersPage from '@/app/(app)/users/page';
import TechnicianPage from '@/app/(app)/workshop/technician/page';
import RemindersPage from '@/app/(app)/reminders/page';
import LaunchPage from '@/app/(app)/launch/page';

const KEY = 'harness-as';
const initial = new URLSearchParams(location.search).get('as');
if (initial) localStorage.setItem(KEY, initial);
if (initial === 'none') localStorage.removeItem(KEY);
installBackend(() => (localStorage.getItem(KEY) as As | null), (a) => (a ? localStorage.setItem(KEY, a) : localStorage.removeItem(KEY)));

type Route = { re: RegExp; page: () => ReactNode; app?: boolean; params?: (m: RegExpMatchArray) => Record<string, string | string[] | undefined> };
const routes: Route[] = [
  { re: /^\/login$/, page: () => <LoginPage /> },
  { re: /^\/$/, page: () => <Home />, app: true },
  { re: /^\/launch$/, page: () => <LaunchPage />, app: true },
  { re: /^\/control-room$/, page: () => <ControlRoomPage />, app: true },
  { re: /^\/accidents(?:\/(.+))?$/, page: () => <Accidents />, app: true, params: (m) => ({ workspace: m[1] ? m[1].split('/') : undefined }) },
  { re: /^\/cases$/, page: () => <CasesPage />, app: true },
  { re: /^\/cases\/([^/]+)$/, page: () => <CasePage />, app: true, params: (m) => ({ id: m[1] }) },
  { re: /^\/parts$/, page: () => <PartsPage />, app: true },
  { re: /^\/settings$/, page: () => <SettingsPage />, app: true },
  { re: /^\/reports$/, page: () => <ReportsPage />, app: true },
  { re: /^\/users$/, page: () => <UsersPage />, app: true },
  { re: /^\/reminders$/, page: () => <RemindersPage />, app: true },
  { re: /^\/workshop\/technician$/, page: () => <TechnicianPage />, app: true },
];

class Boundary extends Component<{ children: ReactNode; at: string }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidUpdate(prev: { at: string }) { if (prev.at !== this.props.at && this.state.err) this.setState({ err: null }); }
  render() { return this.state.err ? <pre data-harness-error style={{ padding: 20, color: '#b00', direction: 'ltr' }}>{String(this.state.err.stack ?? this.state.err)}</pre> : this.props.children; }
}

function App() {
  const loc = useLocation();
  const path = loc.split('?')[0]!;
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const page = <ParamsContext.Provider value={r.params?.(m) ?? {}}>{r.page()}</ParamsContext.Provider>;
    return <Boundary at={path}>{r.app ? <AppLayout>{page}</AppLayout> : page}</Boundary>;
  }
  return <p style={{ padding: 40 }}>harness: no route for {path}</p>;
}

createRoot(document.getElementById('root')!).render(
  <ToastProvider><InstallProvider><App /></InstallProvider></ToastProvider>,
);
