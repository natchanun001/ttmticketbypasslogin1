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
import { SeatPage } from './pages/SeatPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { selectZone, selectSeats } from './pages/SeatHelper';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const STATE_FILE = path.resolve(__dirname, 'auth-state.json');

// ===== ตั้งค่า Event และ การซื้อบัตร =====
const EVENT_URL = process.env.TTM_EVENT_URL || 'https://event.thaiticketmajor.com';
const QUANTITY = parseInt(process.env.TTM_QUANTITY || '1', 10);
const ZONE_PRIORITY = (process.env.TTM_ZONE_PRIORITY || '').split(',').map(z => z.trim()).filter(z => z);
const DELIVERY_METHOD = (process.env.TTM_DELIVERY_METHOD || 'pickup') as 'pickup' | 'postal';
const PAYMENT_METHOD = (process.env.TTM_PAYMENT_METHOD || 'qr') as 'qr' | 'credit';
// ============================================

async function main() {
  if (!fs.existsSync(STATE_FILE)) {
    console.error('❌  ไม่พบ auth-state.json — กรุณารัน manual-login.ts ก่อน');
    process.exit(1);
  }

  console.log('\n🎫  TTM Buy Ticket (Automated Flow)\n');
  console.log(`   Event URL : ${EVENT_URL}`);
  console.log(`   Quantity  : ${QUANTITY}`);
  console.log(`   Zones     : ${ZONE_PRIORITY.join(', ') || 'First Available'}`);
  console.log(`   Session   : ${STATE_FILE}\n`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

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

  if (page.url().includes('signin')) {
    console.error('❌  Session หมดอายุ — กรุณารัน manual-login.ts ใหม่อีกครั้ง');
    await browser.close();
    process.exit(1);
  }

  console.log('✅  Session ยังใช้ได้');

  // --- Step 1: Click Buy Now ---
  console.log('🔍  กำลังหาปุ่มซื้อบัตร...');
  const buySelectors = [
    'a:has-text("ซื้อบัตร")', 'a:has-text("Buy")', 'a:has-text("BUY")',
    'button:has-text("ซื้อบัตร")', 'button:has-text("Buy")',
    '.btn-buy', '[class*="buy"]'
  ];

  let clicked = false;
  for (const selector of buySelectors) {
    try {
      const btn = page.locator(selector).first();
      await btn.waitFor({ state: 'visible', timeout: 5000 });
      await btn.click();
      console.log(`✅  กดปุ่มซื้อบัตรแล้ว`);
      clicked = true;
      break;
    } catch {}
  }

  if (!clicked) {
    console.log('⚠️  ไม่พบปุ่มซื้อบัตรอัตโนมัติ — กรุณาดำเนินการต่อเองใน browser');
  } else {
    try {
      // --- Step 2: Select Zone ---
      const seatPage = new SeatPage(page);
      console.log('⏳  กำลังโหลดหน้าเลือกโซน...');
      await seatPage.waitForSeatMap();
      
      const selectedZone = await selectZone(seatPage, ZONE_PRIORITY);
      if (selectedZone) {
        console.log(`✅  เลือกโซน: ${selectedZone}`);
      } else {
        console.log('⚠️  ไม่สามารถเลือกโซนได้ (อาจจะเต็มหมดแล้ว)');
      }

      // --- Step 3: Select Seats ---
      console.log(`⏳  กำลังหาที่นั่ง (${QUANTITY} ที่)...`);
      await seatPage.setQuantity(QUANTITY);
      
      const seatsByRow = await seatPage.getAllSeatsByRow();
      const result = selectSeats({ seatsByRow, quantity: QUANTITY });

      if (result.success) {
        for (const seat of result.selected) {
          await seatPage.clickSeat(seat);
          console.log(`💺  เลือกที่นั่ง: แถว ${seat.row} ลำดับที่ ${seat.index + 1}`);
        }
        await seatPage.clickProceed();
        console.log('✅  ยืนยันการเลือกที่นั่งแล้ว');

        // --- Step 4: Checkout ---
        console.log('⏳  กำลังไปหน้าชำระเงิน...');
        const checkoutPage = new CheckoutPage(page);
        await checkoutPage.selectDeliveryMethod(DELIVERY_METHOD);
        await checkoutPage.selectPaymentMethod(PAYMENT_METHOD);
        await checkoutPage.acceptTermsIfRequired();
        
        console.log('🚀  กำลังยืนยันคำสั่งซื้อ...');
        await checkoutPage.confirmOrder();
        
        if (PAYMENT_METHOD === 'qr') {
          console.log('⏳  กำลังรอ QR PromptPay...');
          await checkoutPage.waitForQR();
          console.log('🎉  QR Code แสดงแล้ว! กรุณาสแกนเพื่อชำระเงิน');
        } else {
          console.log('🎉  ไปที่หน้าชำระเงินแล้ว!');
        }
      } else {
        console.log('⚠️  ไม่พบที่นั่งว่างที่ตรงตามเงื่อนไข');
      }

    } catch (err) {
      console.error('❌  เกิดข้อผิดพลาดในขั้นตอนอัตโนมัติ:', err);
    }
  }

  console.log('\n💡  Browser จะยังเปิดอยู่เพื่อให้คุณดำเนินการต่อได้');
  console.log('   (กด Ctrl+C ใน terminal เพื่อปิด)\n');
  await page.waitForTimeout(600_000); // รอ 10 นาที
  await browser.close();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
