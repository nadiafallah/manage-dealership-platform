import { expect, type Page } from '@playwright/test';
import { E2E_PASSWORD } from '../playwright.config';

export async function login(page: Page, username: string) {
  // Staff PIN is the default tab; the password form is the owner/system-admin tab.
  await page.goto('/login?mode=staff');
  await page.getByLabel('نام کاربری').fill(username);
  await page.getByLabel('رمز عبور').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page.getByRole('button', { name: 'خروج', includeHidden:true })).toBeAttached();
}

/** Tab of the case folder that holds each section (components/CaseFolderHeader.tsx). */
const SECTION_TAB: Record<string, string> = {
  tasks: 'کار امروز', blockers: 'کار امروز', quality: 'کار امروز',
  assessment: 'کارشناسی', parts: 'قطعات',
  info: 'مدارک', finance: 'مدارک', provenance: 'مدارک', history: 'تاریخچه',
};

export async function openCaseTab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

export async function openCaseSections(page: Page, ...ids: string[]) {
  await expect(page.locator('.case-hero')).toBeVisible();
  for (const id of ids) {
    if (SECTION_TAB[id]) await openCaseTab(page, SECTION_TAB[id]!);
    const section = page.locator(`#case-${id}`);
    if (await section.count() && await section.getAttribute('open') === null) await section.locator(':scope > summary').click();
  }
}
