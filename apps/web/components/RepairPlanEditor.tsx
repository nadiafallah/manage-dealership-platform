'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { repairDurationDays, toLatinDigits, type CaseDetail, type Department, type WorkshopStation } from '@manage/shared';
import { api, errorMessage, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { faNum, parseAmount, rial } from '@/lib/format';
import { useToast } from '@/lib/toast';

// Repair path (spec §8): free, ordered steps — bay, person, working days, wage.
// A bay may appear twice; a step can run together with the previous one.
interface Row {
  key: number;
  departmentId: string;
  stationId: string;
  assignedUserId: string;
  days: string;
  wage: string;
  title: string;
  concurrentWithPrevious: boolean;
}

let seq = 0;
const blank = (): Row => ({ key: ++seq, departmentId: '', stationId: '', assignedUserId: '', days: '1', wage: '', title: '', concurrentWithPrevious: false });
const days = (v: string) => Number(toLatinDigits(v).replace(/[^\d.]/g, ''));

export function RepairPlanEditor({ kase, onDone }: { kase: CaseDetail; onDone: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const wages = can('wage.manage');
  const { data: departments } = useSWR<Department[]>('/departments', fetcher);
  const { data: stations } = useSWR<WorkshopStation[]>('/workshop/stations', fetcher);
  const { data: staff } = useSWR<{ id: string; displayName: string }[]>('/workshop/staff', fetcher);
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [busy, setBusy] = useState(false);

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, by: -1 | 1) =>
    setRows((rs) => {
      const j = i + by;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const parsed = rows.map((r) => ({ ...r, daysN: days(r.days), wageN: r.wage.trim() ? parseAmount(r.wage) : undefined }));
  const valid = parsed.every((r) => r.departmentId && r.daysN >= 0.25 && r.daysN <= 180 && (r.wageN === undefined || r.assignedUserId));
  const total = valid ? repairDurationDays(parsed.map((r) => ({ days: r.daysN, concurrentWithPrevious: r.concurrentWithPrevious }))) : null;

  async function save() {
    setBusy(true);
    try {
      await api(`/cases/${kase.id}/repair-plan/steps`, {
        body: {
          steps: parsed.map((r) => ({
            departmentId: r.departmentId,
            stationId: r.stationId || null,
            assignedUserId: r.assignedUserId || null,
            days: Math.round(r.daysN * 4) / 4,
            wageRial: wages ? r.wageN : undefined,
            title: r.title || undefined,
            concurrentWithPrevious: r.concurrentWithPrevious,
          })),
        },
      });
      toast('مسیر تعمیر ثبت شد');
      onDone();
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
    }
  }

  return (
    <div className="panel-body stack repair-plan-editor" role="region" aria-label="ساخت مسیر تعمیر">
      <p className="small muted">
        قدم‌ها را به ترتیب بنویسید. هر قدم پس از قدم قبلی شروع می‌شود، مگر «هم‌زمان با قبلی» را بزنید. یک جایگاه می‌تواند دو بار بیاید.
        {kase.tasks.some((t) => t.status !== 'approved') ? ' قدم اول پس از کارهای باز فعلی این خودرو شروع می‌شود.' : ''}
      </p>
      <ol className="plan-steps">
        {rows.map((r, i) => {
          const bays = (stations ?? []).filter((s) => s.isActive && (!r.departmentId || s.departmentId === r.departmentId));
          const p = parsed[i]!;
          return (
            <li key={r.key} className="plan-step">
              <span className="plan-step-no" aria-hidden>{faNum(i + 1)}</span>
              <label className="field">
                <span>واحد *</span>
                <select className="input" value={r.departmentId} onChange={(e) => set(r.key, { departmentId: e.target.value, stationId: '' })}>
                  <option value="">انتخاب</option>
                  {departments?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>جایگاه</span>
                <select className="input" value={r.stationId} onChange={(e) => {
                  const st = stations?.find((s) => s.id === e.target.value);
                  set(r.key, { stationId: e.target.value, ...(st ? { departmentId: st.departmentId, assignedUserId: r.assignedUserId || st.responsibleUserId || '' } : {}) });
                }}>
                  <option value="">هر جایگاه آزاد</option>
                  {bays.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>نفر</span>
                <select className="input" value={r.assignedUserId} onChange={(e) => set(r.key, { assignedUserId: e.target.value })}>
                  <option value="">بعداً</option>
                  {staff?.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
                </select>
              </label>
              <label className="field">
                <span>روز کاری *</span>
                <input className="input ltr-input" inputMode="decimal" value={r.days} onChange={(e) => set(r.key, { days: e.target.value })} aria-invalid={!(p.daysN >= 0.25)} />
              </label>
              {wages && (
                <label className="field">
                  <span>اجرت (ریال)</span>
                  <input className="input ltr-input" inputMode="numeric" value={r.wage} onChange={(e) => set(r.key, { wage: e.target.value })} aria-invalid={p.wageN !== undefined && !r.assignedUserId} />
                  {p.wageN !== undefined && !r.assignedUserId && <small className="field-error">اول نفر را انتخاب کنید</small>}
                  {p.wageN !== undefined && r.assignedUserId && <small className="muted">{rial(p.wageN)}</small>}
                </label>
              )}
              <label className="field">
                <span>شرح</span>
                <input className="input" value={r.title} onChange={(e) => set(r.key, { title: e.target.value })} />
              </label>
              <div className="row plan-step-tools">
                {i > 0 && (
                  <label className="check">
                    <input type="checkbox" checked={r.concurrentWithPrevious} onChange={(e) => set(r.key, { concurrentWithPrevious: e.target.checked })} /> هم‌زمان با قبلی
                  </label>
                )}
                <button type="button" className="btn btn-sm btn-ghost" aria-label="بالا" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn btn-sm btn-ghost" aria-label="پایین" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="btn btn-sm btn-ghost" aria-label="حذف قدم" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>×</button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm" onClick={() => setRows((rs) => [...rs, blank()])} disabled={rows.length >= 20}>+ قدم بعدی</button>
        <strong>{total === null ? 'قدم‌ها را کامل کنید' : `مدت کل: ${faNum(total)} روز کاری`}</strong>
        <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={save}>{busy ? 'در حال ثبت…' : 'ثبت مسیر'}</button>
      </div>
    </div>
  );
}
