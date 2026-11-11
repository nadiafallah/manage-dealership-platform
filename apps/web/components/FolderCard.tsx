'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { coverageTab, type DeskFolder } from '@manage/shared';
import { faNum, toPersianDigits } from '@/lib/format';
import { AppIcon, type IconName } from './AppIcon';
import { Plate } from './Plate';

// A car as a case folder on the desk (spec §2.2; owner reference «میز کار کارشناس»):
// coverage-coloured tab, binder clip, short name and customer, big plate, identifiers,
// current place and days in the shop, one «قدم بعدی», and «باز کردن پرونده».
const PLACE_ICON: Record<DeskFolder['journey'], IconName> = { reception: 'file', assessment: 'clipboard', parts: 'box', repair: 'wrench', delivery: 'check' };

export function FolderCard({ f, extra, mine }: { f: DeskFolder; extra?: ReactNode; mine?: boolean }) {
  const tab = coverageTab(f.coverageType);
  const waitingParts = f.journey === 'parts';
  return (
    <article className={`folder cov-${tab.key}${f.behind ? ' folder-behind' : ''}${mine ? ' folder-mine' : ''}`} aria-label={`پروندهٔ ${f.vehicle}${f.plate ? `، پلاک ${toPersianDigits(f.plate)}` : ''}`}>
      <span className="folder-tab" aria-hidden="true" />
      <svg className="folder-clip" width="64" height="22" viewBox="0 0 64 22" aria-hidden="true">
        <rect x="4" y="6" width="56" height="12" rx="3" fill="#C9C3B7" />
        <rect x="10" y="2" width="44" height="9" rx="4.5" fill="none" stroke="#8C8578" strokeWidth="2.2" />
        <rect x="4" y="12" width="56" height="6" rx="2" fill="#B5AE9F" />
      </svg>
      <div className="folder-top">
        <div className="folder-who">
          <strong className="folder-car">{f.vehicle}</strong>
          <span className="folder-cust">{f.customerName ?? 'مشتری ثبت نشده'}</span>
          {mine && <span className="folder-own">پروندهٔ من</span>}
        </div>
        <Plate value={f.plate} size="xl" />
      </div>
      <div className="folder-row">
        <span className={`m-tag cov-${tab.key}`}>{tab.label}</span>
        <span className="folder-id">پذیرش: <bdi>{f.admissionNo ? toPersianDigits(f.admissionNo) : '—'}</bdi></span>
        <span className="folder-id">پرونده: <bdi>{toPersianDigits(f.caseNumber)}</bdi></span>
      </div>
      <div className="folder-row">
        <span className={`folder-place${waitingParts ? ' wait' : ''}${f.next.tone === 'stop' ? ' stop' : ''}`}><AppIcon name={PLACE_ICON[f.journey]} />{f.place}</span>
        <span className="folder-days"><AppIcon name="calendar" />{faNum(f.daysInShop)} روز در تعمیرگاه</span>
      </div>
      {extra}
      <p className={`folder-next tone-${f.next.tone}`}><span>قدم بعدی:</span> {f.next.text}</p>
      <Link href={`/cases/${f.caseId}`} className="folder-open" aria-label={`باز کردن پروندهٔ ${f.vehicle}${f.plate ? ` با پلاک ${toPersianDigits(f.plate)}` : ""}`}><AppIcon name="login" />باز کردن پرونده</Link>
    </article>
  );
}
