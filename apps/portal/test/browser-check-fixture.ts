import type {Page} from 'playwright';
import {browserCheckWorker} from '../../../packages/remote-access/src/browser-check.ts';

export async function mockEmailBrowserCheck(page: Page) {
  await page.route('**/api/account/browser-check', route => route.fulfill({json: {challenge: 'synthetic', difficulty: 8}}));
  await page.route('**/api/account/browser-check.js', route => route.fulfill({contentType: 'text/javascript', body: browserCheckWorker}));
}
