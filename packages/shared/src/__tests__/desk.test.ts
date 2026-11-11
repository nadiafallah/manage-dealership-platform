import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysInShop, deskFilterMatch, folderBehind, folderNextStep, folderPlace, greeting, journeyStep, type DeskFolder, type FolderFacts } from '../index';

const NOW = Date.parse('2026-11-10T08:00:00Z'); // 11:30 Tehran
const base: FolderFacts = { stage: 'in_repair', tasks: [], parts: { total: 0, undecided: 0, inProgress: 0, ready: 0, emdadLate: 0 }, openBlockers: 0 };
const tomorrow = '2026-11-11T10:00:00Z';
const yesterday = '2026-11-09T10:00:00Z';

test('five-step journey bar', () => {
  assert.equal(journeyStep('reception'), 'reception');
  assert.equal(journeyStep('awaiting_approval'), 'assessment');
  assert.equal(journeyStep('awaiting_parts'), 'parts');
  assert.equal(journeyStep('in_repair'), 'repair');
  assert.equal(journeyStep('ready_for_delivery'), 'delivery');
});

test('a finished step waits for the expert: approve and refer to the next bay', () => {
  const f: FolderFacts = { ...base, tasks: [
    { department: 'صافکاری', station: '1', status: 'done', plannedEndAt: tomorrow },
    { department: 'نقاشی', station: '2', status: 'pending', plannedEndAt: null },
  ] };
  assert.deepEqual(folderNextStep(f, NOW), { text: 'صافکاری تمام شد — تأیید و ارجاع به نقاشی', actor: 'accident_expert', tone: 'warn' });
});

test('an unanswered «قطعه ندارم» comes before parts and schedule', () => {
  const f: FolderFacts = { ...base, parts: { ...base.parts, total: 2, undecided: 1 }, problems: [{ label: 'قطعه ندارم', hours: 26.2 }] };
  assert.equal(folderNextStep(f, NOW).text, 'تکنسین: «قطعه ندارم» — ۲۶ ساعت بی‌پاسخ');
});

test('parts: late Emdad first, then undecided, then ready for the bay', () => {
  const p = (x: Partial<FolderFacts['parts']>): FolderFacts => ({ ...base, stage: 'awaiting_parts', parts: { ...base.parts, total: 3, ...x } });
  assert.equal(folderNextStep(p({ emdadLate: 1, undecided: 2 }), NOW).actor, 'parts_clerk');
  assert.match(folderNextStep(p({ emdadLate: 1, undecided: 2 }), NOW).text, /امداد ویژه/);
  assert.equal(folderNextStep(p({ undecided: 2 }), NOW).text, '۲ قطعه تعیین تکلیف نشده');
  assert.equal(folderNextStep(p({ ready: 1 }), NOW).text, '۱ قطعه آماده — تحویل به جایگاه');
});

test('running step: on plan or behind, with the bay as place', () => {
  const on: FolderFacts = { ...base, tasks: [{ department: 'صافکاری', station: '1', status: 'in_progress', plannedEndAt: tomorrow }] };
  assert.equal(folderNextStep(on, NOW).text, 'طبق برنامه — پایان صافکاری فردا');
  assert.equal(folderPlace(on, 'در حال تعمیر'), 'صافکاری · جایگاه ۱');
  assert.equal(folderBehind(on, NOW), false);
  const late: FolderFacts = { ...base, tasks: [{ department: 'صافکاری', station: '1', status: 'in_progress', plannedEndAt: yesterday }] };
  assert.equal(folderNextStep(late, NOW).tone, 'stop');
  assert.equal(folderBehind(late, NOW), true);
});

test('reception asks for the assessment; delivery asks to call the customer', () => {
  assert.equal(folderNextStep({ ...base, stage: 'reception' }, NOW).text, 'برآورد کارشناسی را وارد کنید');
  assert.equal(folderNextStep({ ...base, stage: 'ready_for_delivery' }, NOW).text, 'آمادهٔ تحویل — هماهنگی با مشتری');
  assert.equal(folderNextStep({ ...base, stage: 'assessment', parts: { ...base.parts, total: 3 } }, NOW).text, 'مسیر تعمیر را بسازید');
});

test('desk filters, days in shop and greeting', () => {
  const f = { journey: 'parts', behind: false, next: { actor: 'parts_clerk' }, parts: { undecided: 1, inProgress: 0 } } as unknown as DeskFolder;
  assert.equal(deskFilterMatch(f, 'mine', ['parts_clerk']), true);
  assert.equal(deskFilterMatch(f, 'mine', ['accident_expert']), false);
  assert.equal(deskFilterMatch(f, 'parts', []), true);
  assert.equal(deskFilterMatch(f, 'behind', []), false);
  const owned = { ...f, responsibleUserId: 'u1' } as DeskFolder;
  assert.equal(deskFilterMatch(owned, 'own', [], 'u1'), true);
  assert.equal(deskFilterMatch(owned, 'own', [], 'u2'), false);
  assert.equal(daysInShop('2026-11-05T06:00:00Z', NOW), 6);
  assert.equal(greeting('مهدی رضایی', NOW), 'صبح بخیر، مهدی');
});
