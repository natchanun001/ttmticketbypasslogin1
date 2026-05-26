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

const SESSIONS_DIR = path.resolve(__dirname, 'sessions');

// ===== ตั้งค่า Event และ การซื้อบัตร =====
const EVENT_URL = process.env.TTM_EVENT_URL || 'https://event.thaiticketmajor.com';
const QUANTITY = parseInt(process.env.TTM_QUANTITY || '1', 10);
const ZONE_PRIORITY = (process.env.TTM_ZONE_PRIORITY || '').split(',').map(z => z.trim()).filter(z => z);
const DELIVERY_METHOD = (process.env.TTM_DELIVERY_METHOD || 'pickup') as 'pickup' | 'postal';
const PAYMENT_METHOD = (process.env.TTM_PAYMENT_METHOD || 'qr') as 'qr' | 'credit';
// ============================================

async function runBuyTicket(sessionFile: string, userIndex: number) {
  const sessionPath = path.join(SESSIONS_DIR, sessionFile);
  const logPrefix = `[User ${userIndex}]`;

  console.log(`${logPrefix} 🎫  กำลังเริ่มทำงานสำหรับ session: ${sessionFile}`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  try {
    const context = await browser.newContext({
      storageState: sessionPath,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: null,
    });

    const page = await context.newPage();

    console.log(`${logPrefix} 🌐  กำลังไปที่ event page...`);
    await page.goto(EVENT_URL, { waitUntil: 'domcontentloaded' });

    if (page.url().includes('signin')) {
      console.error(`${logPrefix} ❌  Session หมดอายุ — กรุณารัน manual-login.ts ใหม่อีกครั้ง`);
      await browser.close();
      return;
    }

    console.log(`${logPrefix} ✅  Session ยังใช้ได้`);

    // --- Step 1: Click Buy Now ---
    console.log(`${logPrefix} 🔍  กำลังหาปุ่มซื้อบัตร...`);
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
        console.log(`${logPrefix} ✅  กดปุ่มซื้อบัตรแล้ว`);
        clicked = true;
        break;
      } catch {}
    }

    if (!clicked) {
      console.log(`${logPrefix} ⚠️  ไม่พบปุ่มซื้อบัตรอัตโนมัติ — กรุณาดำเนินการต่อเองใน browser`);
    } else {
      try {
        // --- Step 2: Select Zone ---
        const seatPage = new SeatPage(page);
        console.log(`${logPrefix} ⏳  กำลังโหลดหน้าเลือกโซน...`);
        await seatPage.waitForSeatMap();
        
        const selectedZone = await selectZone(seatPage, ZONE_PRIORITY);
        if (selectedZone) {
          console.log(`${logPrefix} ✅  เลือกโซน: ${selectedZone}`);
        } else {
          console.log(`${logPrefix} ⚠️  ไม่สามารถเลือกโซนได้ (อาจจะเต็มหมดแล้ว)`);
        }

        // --- Step 3: Select Seats ---
        console.log(`${logPrefix} ⏳  กำลังหาที่นั่ง (${QUANTITY} ที่)...`);
        await seatPage.setQuantity(QUANTITY);
        
        const seatsByRow = await seatPage.getAllSeatsByRow();
        const result = selectSeats({ seatsByRow, quantity: QUANTITY });

        if (result.success) {
          for (const seat of result.selected) {
            await seatPage.clickSeat(seat);
            console.log(`${logPrefix} 💺  เลือกที่นั่ง: แถว ${seat.row} ลำดับที่ ${seat.index + 1}`);
          }
          await seatPage.clickProceed();
          console.log(`${logPrefix} ✅  ยืนยันการเลือกที่นั่งแล้ว`);

          // --- Step 4: Checkout ---
          console.log(`${logPrefix} ⏳  กำลังไปหน้าชำระเงิน...`);
          const checkoutPage = new CheckoutPage(page);
          await checkoutPage.selectDeliveryMethod(DELIVERY_METHOD);
          await checkoutPage.selectPaymentMethod(PAYMENT_METHOD);
          await checkoutPage.acceptTermsIfRequired();
          
          console.log(`${logPrefix} 🚀  กำลังยืนยันคำสั่งซื้อ...`);
          await checkoutPage.confirmOrder();
          
          if (PAYMENT_METHOD === 'qr') {
            console.log(`${logPrefix} ⏳  กำลังรอ QR PromptPay...`);
            await checkoutPage.waitForQR();
            console.log(`${logPrefix} 🎉  QR Code แสดงแล้ว! กรุณาสแกนเพื่อชำระเงิน`);
          } else {
            console.log(`${logPrefix} 🎉  ไปที่หน้าชำระเงินแล้ว!`);
          }
        } else {
          console.log(`${logPrefix} ⚠️  ไม่พบที่นั่งว่างที่ตรงตามเงื่อนไข`);
        }

      } catch (err) {
        console.error(`${logPrefix} ❌  เกิดข้อผิดพลาดในขั้นตอนอัตโนมัติ:`, err);
      }
    }

    console.log(`${logPrefix} 💡  เสร็จสิ้นขั้นตอนสำหรับ User ${userIndex} (Browser จะเปิดค้างไว้ 10 นาที)`);
    await page.waitForTimeout(600_000); 

  } catch (err) {
    console.error(`${logPrefix} ❌  Fatal error:`, err);
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.error('❌  ไม่พบโฟลเดอร์ sessions — กรุณารัน manual-login.ts ก่อน');
    process.exit(1);
  }

  const sessionFiles = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));

  if (sessionFiles.length === 0) {
    console.error('❌  ไม่พบ session files ในโฟลเดอร์ sessions — กรุณารัน manual-login.ts ก่อน');
    process.exit(1);
  }

  console.log('\n🎫  TTM Buy Ticket (Multi-User Parallel Mode)\n');
  console.log(`   Event URL : ${EVENT_URL}`);
  console.log(`   Quantity  : ${QUANTITY}`);
  console.log(`   Users     : ${sessionFiles.length}\n`);

  // รันทุก session พร้อมกัน
  await Promise.all(sessionFiles.map((file, index) => runBuyTicket(file, index + 1)));

  console.log('\n✨  ทุกกระบวนการทำงานเสร็จสิ้น\n');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
