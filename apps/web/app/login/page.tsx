'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { api, ApiError, errorMessage } from '@/lib/api';
import { toLatinDigits, toPersianDigits, type Me } from '@manage/shared';
import {InstallButton} from '@/components/InstallApp';
import { AppIcon } from '@/components/AppIcon';
import { WorkshopBackdrop } from '@/components/WorkshopScene';
import { Dialog } from '@/components/Dialog';

type LoginSubmission = { busy: boolean; setBusy: (busy: boolean) => void };

function StaffLoginForm({ active, busy, setBusy }: LoginSubmission & { active: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword,setShowPassword]=useState(false);
  const [tenantCode, setTenantCode] = useState('');
  const [needTenant, setNeedTenant] = useState(false);
  const [error, setError] = useState('');
  const [emailEnabled,setEmailEnabled] = useState(false);
  const [challenge,setChallenge] = useState<{challengeId:string;proof:string}|null>(null);
  const [code,setCode] = useState('');
  useEffect(()=>{api<{totpEnabled:boolean}>('/auth/options').then(x=>setEmailEnabled(x.totpEnabled)).catch(()=>{});},[]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (emailEnabled && !challenge) {
        const step=await api<{challengeId:string;proof:string}>('/auth/email/login',{body:{email:username.trim().toLowerCase(),password}});
        setChallenge(step);setPassword('');setBusy(false);return;
      }
      if (challenge) {
        await api<Me>('/auth/email/verify',{body:{...challenge,code}});
      } else {
      await api<Me>('/auth/login', {
        body: { username: username.trim(), password, tenantCode: tenantCode.trim() || undefined },
      });
      }
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') && !/[\\\r\n]/.test(next) ? next : '/launch');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TENANT_REQUIRED') setNeedTenant(true);
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="form" method="post" onSubmit={submit}>
      {challenge && (
        <div>
          <h2>تأیید ورود</h2>
          <p className="muted small">کد شش‌رقمی حساب منیج را از برنامهٔ Google Authenticator وارد کنید.</p>
        </div>
      )}
      {!emailEnabled && needTenant && (
        <label className="field">
          <span>کد نمایندگی</span>
          <input
            className="input ltr-input"
            value={tenantCode}
            onChange={(e) => setTenantCode(e.target.value)}
            autoComplete="organization"
          />
        </label>
      )}
      {!challenge && <><label className="field">
        <span>{emailEnabled?'ایمیل کاری':'نام کاربری'}</span>
        <input
          className="input ltr-input"
          name="username"
          type={emailEnabled?'email':'text'}
          placeholder={emailEnabled ? 'name@dealer.ir' : undefined}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={active}
          required
        />
      </label>
      <div className="field">
        <label htmlFor="login-password">رمز عبور</label>
        <div className="password-field">
          <input
            id="login-password"
            className="input ltr-input"
            name="password"
            type={showPassword?'text':'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <button type="button" className="password-toggle" aria-label={showPassword?'پنهان کردن رمز':'نمایش رمز'} aria-pressed={showPassword} onClick={()=>setShowPassword(!showPassword)}>
            {showPassword
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>}
          </button>
        </div>
        {emailEnabled && <Link className="small forgot-link" href="/reset-password">رمز را فراموش کرده‌اید؟</Link>}
      </div></>}
      {challenge && <label className="field"><span>کد تأیید</span><input className="input ltr-input" name="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(toLatinDigits(e.target.value).replace(/\D/g,''))} maxLength={6} pattern="[0-9]{6}" required autoFocus={active} /></label>}
      {error && (
        <div className="callout callout-red" role="alert">
          {error}
        </div>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'در حال ورود…' : challenge ? 'تأیید کد و ورود' : 'ورود'}
      </button>
      {emailEnabled && !challenge && <p className="login-2fa"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>در مرحلهٔ بعد، کد Google Authenticator خواسته می‌شود.</p>}
      {challenge && <><p className="small muted">کد در برنامه هر ۳۰ ثانیه عوض می‌شود. اگر کد قبلی را استفاده کرده‌اید، منتظر کد تازه بمانید.</p><button className="btn" type="button" onClick={()=>{setChallenge(null);setCode('');setError('');}}>بازگشت به ایمیل و رمز</button></>}
    </form>
  );
}

const technicianUnavailable = 'ورود چهاررقمی در دسترس نیست؛ با مدیر سیستم تماس بگیرید.';
const technicianErrors: Partial<Record<number, string>> = {
  401: 'نام کاربری یا رمز اشتباه است.',
  423: 'چند بار اشتباه وارد شد؛ ۱۵ دقیقه دیگر دوباره امتحان کنید.',
  404: technicianUnavailable,
  405: technicianUnavailable,
};

function TechnicianLoginForm({ busy, setBusy }: LoginSubmission) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [digits, setDigits] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [devicePassword, setDevicePassword] = useState(''), [needsDevice, setNeedsDevice] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const pin = digits.join('');

  function updateDigit(index: number, digit: string) {
    setDigits(previous => previous.map((value, position) => position === index ? digit : value));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !username.trim() || pin.length !== 4) return;
    setBusy(true);
    setError('');
    try {
      const me = await api<{ roles: string[] }>('/auth/technician-login', { body: { username: username.trim(), pin, ...(needsDevice && devicePassword ? { devicePassword } : {}) } });
      router.replace(me.roles.every(r => r === 'technician') ? '/workshop/technician' : '/launch');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DEVICE_NOT_REGISTERED') {
        setNeedsDevice(true);
        setError('این دستگاه هنوز ثبت نشده است؛ رمز ثبت دستگاه را از مسئول بگیرید و وارد کنید.');
        setBusy(false);
        return;
      }
      setError((err instanceof ApiError && technicianErrors[err.status]) || errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="form" method="post" onSubmit={submit}>
      <label className="field lg-field">
        <span>نام کاربری</span>
        <span className="lg-input-wrap"><AppIcon name="idcard" /><input
          className="input ltr-input"
          name="username"
          value={username}
          placeholder="a.rezaei"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          onChange={event => setUsername(event.target.value)}
          required
        /></span>
      </label>
      <fieldset className="login-pin">
        <legend>پین چهاررقمی</legend>
        <div className="login-pin-row"><span className="lg-lock" aria-hidden="true"><AppIcon name="lock" /></span>
        <div className="login-pin-grid" dir="ltr">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={input => { inputs.current[index] = input; }}
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={1}
              aria-label={`رقم ${toPersianDigits(index + 1)} رمز`}
              value={toPersianDigits(digit)}
              onFocus={event => event.currentTarget.select()}
              onChange={event => {
                const next = toLatinDigits(event.target.value);
                if (!/^[0-9]?$/.test(next)) return;
                updateDigit(index, next);
                if (next) inputs.current[index + 1]?.focus();
              }}
              onKeyDown={event => {
                if (event.key === 'Backspace' && !digit && index > 0) {
                  event.preventDefault();
                  updateDigit(index - 1, '');
                  inputs.current[index - 1]?.focus();
                }
              }}
              onPaste={event => {
                event.preventDefault();
                const pasted = toLatinDigits(event.clipboardData.getData('text').trim());
                if (/^[0-9]{4}$/.test(pasted)) {
                  setDigits(pasted.split(''));
                  inputs.current[3]?.focus();
                }
              }}
              required
            />
          ))}
        </div></div>
      </fieldset>
      {needsDevice && (
        <label className="field">
          <span>رمز ثبت دستگاه (فقط بار اول روی این دستگاه)</span>
          <input className="input ltr-input" type="password" name="devicePassword" autoComplete="current-password" value={devicePassword} onChange={event => setDevicePassword(event.target.value)} required />
        </label>
      )}
      {error && <div className="callout callout-red" role="alert">{error}</div>}
      <button className="btn btn-primary lg-cta" type="submit" disabled={busy}>
        <AppIcon name="login" />{busy ? 'در حال ورود…' : 'ورود به میز کار'}
      </button>
    </form>
  );
}

const loginModes = [
  { id: 'technician', label: 'ورود کارکنان' },
  { id: 'staff', label: 'ورود مدیر سیستم' },
] as const;

function LoginPanels() {
  const params = useSearchParams();
  const [mode, setMode] = useState(params.get('mode') === 'staff' || params.get('mode') === 'management' ? 'staff' : 'technician');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<'guide' | 'trouble' | null>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (busy) return;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight': next = 1 - index; break;
      case 'Home': next = 0; break;
      case 'End': next = loginModes.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setMode(loginModes[next]!.id);
    tabs.current[next]?.focus();
  }

  const door = mode === 'technician'
    ? { title: 'ورود کارکنان', sub: 'برای ادامه، نام کاربری و پین چهاررقمی خود را وارد کنید.', icon: 'user' as const }
    : { title: 'ورود مدیر سیستم', sub: 'ایمیل، رمز و کد شش‌رقمی Google Authenticator.', icon: 'gear' as const };
  return (
    <div className="entry-login-body lg-card">
      <header className="lg-head">
        <span className="lg-ico" aria-hidden="true"><AppIcon name={door.icon} /></span>
        <div><h1>{door.title}</h1><p>{door.sub}</p></div>
      </header>
      <div id="login-panel-staff" role="tabpanel" aria-labelledby="login-tab-staff" hidden={mode !== 'staff'}>
        <StaffLoginForm active={mode === 'staff'} busy={busy} setBusy={setBusy} />
      </div>
      <div id="login-panel-technician" role="tabpanel" aria-labelledby="login-tab-technician" hidden={mode !== 'technician'}>
        {mode === 'technician' && <TechnicianLoginForm busy={busy} setBusy={setBusy} />}
      </div>
      <div className="door-list">
        <div className="login-tabs" role="tablist" aria-label="نوع ورود">
          {loginModes.map(({ id, label }, index) => (
            <button
              key={id}
              ref={tab => { tabs.current[index] = tab; }}
              id={`login-tab-${id}`}
              type="button"
              role="tab"
              tabIndex={mode === id ? 0 : -1}
              aria-selected={mode === id}
              aria-controls={`login-panel-${id}`}
              aria-disabled={busy && mode !== id}
              onClick={() => { if (!busy) setMode(id); }}
              onKeyDown={event => handleTabKey(event, index)}
            >
              <AppIcon name={id === 'technician' ? 'user' : 'gear'} /><span>{label}</span>{mode === id ? <AppIcon name="check" className="door-on" /> : <AppIcon name="chevron-left" className="door-go" />}
            </button>
          ))}
        </div>
        <button type="button" className="door-row" onClick={() => setInfo('guide')}><AppIcon name="book" /><span>راهنمای ورود</span><AppIcon name="chevron-left" className="door-go" /></button>
        <button type="button" className="door-row" onClick={() => setInfo('trouble')}><AppIcon name="help" /><span>مشکل در ورود؟</span><AppIcon name="chevron-left" className="door-go" /></button>
      </div>
      {/* Installing the app is the same for every sign-in path. */}
      <div className="install-login"><InstallButton/></div>
      <Dialog open={info === 'guide'} title="راهنمای ورود" onClose={() => setInfo(null)} footer={<button type="button" className="btn btn-primary" onClick={() => setInfo(null)}>متوجه شدم</button>}>
        <ol className="lg-guide">
          <li><b>کارکنان</b> (کارشناس تصادفات، مسئول قطعات، تکنسین، مدیر خدمات): نام کاربری و پین چهاررقمی که مدیر سیستم به شما داده است.</li>
          <li>بار اول روی هر دستگاه، رمز ثبت دستگاه را هم از مدیر سیستم بگیرید؛ دفعه‌های بعد لازم نیست.</li>
          <li><b>مدیر سیستم</b> از در «ورود مدیر سیستم» با ایمیل، رمز و کد Google Authenticator وارد می‌شود.</li>
          <li>بعد از ورود، هر نفر مستقیم به میز کار خودش می‌رود.</li>
        </ol>
      </Dialog>
      <Dialog open={info === 'trouble'} title="مشکل در ورود؟" onClose={() => setInfo(null)} footer={<button type="button" className="btn btn-primary" onClick={() => setInfo(null)}>بستن</button>}>
        <ul className="lg-guide">
          <li>پین را فراموش کرده‌اید: مدیر سیستم از بخش «کارکنان» آن را تازه می‌کند.</li>
          <li>پنج بار اشتباه: حساب ۱۵ دقیقه قفل می‌شود؛ بعد دوباره امتحان کنید.</li>
          <li>«این دستگاه هنوز ثبت نشده است»: رمز ثبت دستگاه را از مدیر سیستم بگیرید.</li>
          <li>مدیر سیستمی که به Google Authenticator دسترسی ندارد: مالک می‌تواند لینک بازیابی بسازد.</li>
        </ul>
      </Dialog>
    </div>
  );
}

/**
 * Sign-in (spec §3, §12; owner reference «manage-cinematic»): a dark, cinematic workshop
 * with the case folder on the bench on the left, and a warm ivory form on the right.
 * The artwork is CSS/SVG with real text, so nothing is baked into an image.
 */
export default function LoginPage() {
  return (
    <main className="login entry-login lg-root">
      <Suspense>
        <LoginPanels />
      </Suspense>
      <div className="side lg-art" aria-label="Manage by HEDAX">
        <div className="lg-scene" aria-hidden="true">
          <WorkshopBackdrop className="lg-backdrop" />
          <span className="lg-glow" />
          <span className="lg-bench" />
          <div className="lg-folder">
            <span className="lg-papers"><i /><i /><i /></span>
            <span className="lg-clip" />
            <div className="lg-cover">
              <svg viewBox="0 0 120 40" className="lg-car-line"><path d="M6 30c8-1 12-6 18-10 10-7 22-12 38-12 16 0 26 6 34 12l12 4c4 1 6 4 6 7" fill="none" stroke="#C9A85A" strokeWidth="2.2" strokeLinecap="round" /><path d="M30 31h60" stroke="#C9A85A" strokeWidth="2" strokeLinecap="round" /></svg>
              <span className="lg-cover-title">پرونده خودرو</span>
              <span className="lg-cover-rule" />
              <span className="lg-badge">HEDAX</span>
            </div>
          </div>
        </div>
        <div className="lg-brand">
          <span className="lg-logo"><span className="brand-slashes"><i /><i /></span><span className="lg-word">Manage</span></span>
          <span className="lg-by">by <b>HEDAX</b></span>
          <p className="lg-claim">هر خودرو، یک مسیر روشن.</p>
          <p className="lg-sub">منیج پیگیری می‌کند، شما تصمیم می‌گیرید.</p>
          <span className="lg-rule" />
        </div>
        <p className="entry-signature"><span>نمایندگی ۱۳۰۷ ایران‌خودرو · قم</span><span>یک محصول هداکس</span></p>
      </div>
    </main>
  );
}
