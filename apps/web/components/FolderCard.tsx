'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { coverageTab, type DeskFolder } from '@manage/shared';
import { faNum, toPersianDigits } from '@/lib/format';
import { Plate } from './Plate';

// A car as a case folder on the desk (spec §2.2, mockup ExpertDesk.dc.html):
// coverage tab, staple, big plate, «پرونده … · پذیرش …», short name, customer,
// stage/bay, days in the shop and one «قدم بعدی». Nothing else on the card.
export function FolderCard({ f, extra }: { f: DeskFolder; extra?: ReactNode }) {
  const tab = coverageTab(f.coverageType);
  return (
    <Link href={`/cases/${f.caseId}`} className={`folder${f.behind ? ' folder-behind' : ''}`} aria-label={`پروندهٔ ${f.vehicle}${f.plate ? ` با پلاک ${toPersianDigits(f.plate)}` : ''}`}>
      <span className={`folder-tab cov-${tab.key}`}>{tab.label}</span>
      <svg className="folder-staple" width="26" height="10" viewBox="0 0 26 10" aria-hidden="true"><path d="M2 8V3a1 1 0 0 1 1-1h20a1 1 0 0 1 1 1v5" fill="none" stroke="#9AA0A9" strokeWidth="2" strokeLinecap="round" /></svg>
      <div className="folder-head">
        <div>
          <strong className="folder-car">{f.vehicle}</strong>
          <span className="folder-cust">{f.customerName ?? 'مشتری ثبت نشده'}</span>
        </div>
        <span className="folder-days" title="روز در تعمیرگاه"><b>{faNum(f.daysInShop)}</b><small>روز</small></span>
      </div>
      <Plate value={f.plate} size="xl" />
      <span className="folder-ids">پرونده <bdi>{toPersianDigits(f.caseNumber)}</bdi>{f.admissionNo ? <> · پذیرش <bdi>{toPersianDigits(f.admissionNo)}</bdi></> : null}</span>
      <div className="folder-place"><span className="folder-dot" data-tone={f.behind ? 'stop' : 'ok'} aria-hidden="true" /><span className="lbl">اکنون</span> {f.place}</div>
      {extra}
      <p className={`folder-next tone-${f.next.tone}`}><span className="lbl">قدم بعدی</span>{f.next.text}</p>
    </Link>
  );
}
