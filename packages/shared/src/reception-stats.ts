import { toLatinDigits } from './text';

// Daily reception statistics of «پذیرش تا ترخیص» (reconstruction scenario, owner 2026-11-25).
// A reception whose labour lines are all periodic-service/oil codes counts as «سرویس»; any other
// labour code makes it «تعمیراتی». A reception without labour lines yet is «بدون اجرت» — it is
// never guessed. The service codes are a list the owner or system administrator edits.

export const RECEPTION_KINDS = ['repair', 'service', 'unclassified'] as const;
export type ReceptionKind = (typeof RECEPTION_KINDS)[number];
export const RECEPTION_KIND_LABELS: Record<ReceptionKind, string> = {
  repair: 'تعمیراتی',
  service: 'سرویس ادواری و روغن',
  unclassified: 'بدون اجرت',
};

/** Canonical labour code: ASCII digits, no spaces, upper case (codes are compared as text; leading zeros stay). */
export function normalizeLaborCode(code: string): string {
  return toLatinDigits(code).replace(/\s+/g, '').toUpperCase();
}

/** Codes typed or pasted by a person: comma, Persian comma, semicolon, space or new line separated; duplicates dropped. */
export function parseLaborCodes(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,،;؛]+/)) {
    const code = normalizeLaborCode(part);
    if (code) seen.add(code);
  }
  return [...seen];
}

/** Kind of one reception from the codes of its current (not removed) labour lines. */
export function receptionKind(codes: readonly (string | null | undefined)[], serviceCodes: Iterable<string>): ReceptionKind {
  const service = new Set([...serviceCodes].map(normalizeLaborCode));
  const present = codes.map((c) => (c == null ? '' : normalizeLaborCode(c))).filter(Boolean);
  if (!present.length) return 'unclassified';
  return present.every((c) => service.has(c)) ? 'service' : 'repair';
}

export interface ReceptionStatsRow {
  receptionist: string | null;
  /** Codes of the reception's current labour lines. */
  codes: readonly (string | null | undefined)[];
}
export interface ReceptionCounts {
  total: number;
  repair: number;
  service: number;
  unclassified: number;
}
export interface ReceptionPersonStats extends ReceptionCounts {
  /** As written in کسب‌وکار; «ثبت نشده» when the card has no receptionist. */
  name: string;
}
export interface ReceptionDayStats extends ReceptionCounts {
  /** Tehran calendar day, YYYY-MM-DD. */
  date: string;
  byReceptionist: ReceptionPersonStats[];
  /** False while no service code is set: then every reception with labour counts as «تعمیراتی». */
  serviceCodesConfigured: boolean;
}

export const UNKNOWN_RECEPTIONIST = 'ثبت نشده';

const empty = (): ReceptionCounts => ({ total: 0, repair: 0, service: 0, unclassified: 0 });

export function receptionDayStats(date: string, rows: readonly ReceptionStatsRow[], serviceCodes: readonly string[]): ReceptionDayStats {
  const service = new Set(serviceCodes.map(normalizeLaborCode).filter(Boolean));
  const all = empty();
  const people = new Map<string, ReceptionCounts>();
  for (const row of rows) {
    const kind = receptionKind(row.codes, service);
    const name = row.receptionist?.replace(/\s+/g, ' ').trim() || UNKNOWN_RECEPTIONIST;
    const person = people.get(name) ?? empty();
    for (const c of [all, person]) {
      c.total += 1;
      c[kind] += 1;
    }
    people.set(name, person);
  }
  const byReceptionist = [...people.entries()]
    .map(([name, c]) => ({ name, ...c }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'fa'));
  return { date, ...all, byReceptionist, serviceCodesConfigured: service.size > 0 };
}
