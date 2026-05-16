import { Page, Locator, expect } from '@playwright/test';

export class EventPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(eventUrl: string) {
    await this.page.goto(eventUrl);
  }

  async waitForEventPage() {
    await this.page.waitForLoadState('networkidle');
  }

  async selectTicket() {
    // คลิกปุ่ม "Buy" / "ซื้อบัตร" — ปรับ selector ตามหน้าจริง
    const buyButton = this.page.locator(
      'a:has-text("ซื้อบัตร"), a:has-text("Buy"), button:has-text("ซื้อบัตร"), button:has-text("Buy")'
    ).first();
    await expect(buyButton).toBeVisible({ timeout: 10000 });
    await buyButton.click();
  }

  async assertTicketPage() {
    // ตรวจว่าเข้าสู่หน้าเลือกบัตรแล้ว
    await expect(this.page).toHaveURL(/ticket|seat|order/, { timeout: 10000 });
  }
}
