/**
 * buy-ticket.ts
 *
 * Step 2: รันสคริปต์นี้หลังจาก manual-login.ts บันทึก session แล้ว
 *   npx ts-node buy-ticket.ts
 *
 * สคริปต์จะ:
 *   1. โหลด session จาก auth-state.json (ไม่ต้อง login ใหม่)
 *   2. ไปที่ event URL ที่กำหนดใน EVENT_URL
 *   3. รอบัตรเปิดขาย แล้วกดซื้อ
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const STATE_FILE = path.resolve(__dirname, 'auth-state.json');

// ===== ตั้งค่า Event ที่ต้องการซื้อบัตร =====
const EVENT_URL = process.env.TTM_EVENT_URL || 'https://event.thaiticketmajor.com';
// ============================================

async function main() {
  if (!fs.existsSync(STATE_FILE)) {
    console.error('❌  ไม่พบ auth-state.json — กรุณารัน manual-login.ts ก่อน');
    process.exit(1);
  }

  console.log('\n🎫  TTM Buy Ticket\n');
  console.log(`   Event URL : ${EVENT_URL}`);
  console.log(`   Session   : ${STATE_FILE}\n`);

  const browser = await chromium.launch({
    headless: false, // เปิด headed เพื่อดูความคืบหน้า (เปลี่ยนเป็น true ถ้าต้องการ background)
    args: ['--start-maximized'],
  });

  // โหลด session ที่บันทึกไว้ — ข้าม login โดยสมบูรณ์
  const context = await browser.newContext({
    storageState: STATE_FILE,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: null,
  });

  const page = await context.newPage();

  console.log('🌐  กำลังไปที่ event page...');
  await page.goto(EVENT_URL, { waitUntil: 'domcontentloaded' });

  // ตรวจว่า session ยังใช้ได้ (ถ้า redirect กลับไปหน้า login แสดงว่าหมดอายุ)
  if (page.url().includes('signin')) {
    console.error('❌  Session หมดอายุ — กรุณารัน manual-login.ts ใหม่อีกครั้ง');
    await browser.close();
    process.exit(1);
  }

  console.log('✅  Session ยังใช้ได้ — เข้าสู่ event page สำเร็จ');
  console.log('🔍  กำลังหาปุ่มซื้อบัตร...\n');

  // รอและกดปุ่มซื้อบัตร
  const buySelectors = [
    'a:has-text("ซื้อบัตร")',
    'a:has-text("Buy")',
    'a:has-text("BUY")',
    'button:has-text("ซื้อบัตร")',
    'button:has-text("Buy")',
    'input[value="ซื้อบัตร"]',
    'input[value="Buy"]',
    '.btn-buy',
    '[class*="buy"]',
  ];

  let clicked = false;
  for (const selector of buySelectors) {
    try {
      const btn = page.locator(selector).first();
      await btn.waitFor({ state: 'visible', timeout: 3000 });
      await btn.click();
      console.log(`✅  กดปุ่มซื้อบัตรแล้ว (selector: ${selector})`);
      clicked = true;
      break;
    } catch {
      // ลอง selector ถัดไป
    }
  }

  if (!clicked) {
    console.log('⚠️  ไม่พบปุ่มซื้อบัตรอัตโนมัติ — browser ยังเปิดอยู่ กรุณากดเองได้เลย');
    console.log('   (กด Ctrl+C เพื่อปิดเมื่อเสร็จ)\n');
    // รอให้ผู้ใช้ทำเองใน browser ที่เปิดอยู่
    await page.waitForTimeout(300_000); // รอสูงสุด 5 นาที
  } else {
    console.log('\n🎉  ดำเนินการซื้อบัตรแล้ว — browser ยังเปิดอยู่ ดำเนินการต่อได้เลย');
    await page.waitForTimeout(300_000);
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
