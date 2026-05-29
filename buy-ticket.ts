import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { SeatPage } from './pages/SeatPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { selectSeats } from './pages/SeatHelper';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const SESSIONS_DIR = path.resolve(__dirname, 'sessions');

// ===== ตั้งค่า Event และ การซื้อบัตร =====
const EVENT_URL = process.env.TTM_EVENT_URL || 'https://event.thaiticketmajor.com';
const QUANTITY = parseInt(process.env.TTM_QUANTITY || '1', 10);
const ZONE_PRIORITY = (process.env.TTM_ZONE_PRIORITY || '').split(',').map(z => z.trim()).filter(z => z);
const DELIVERY_METHOD = (process.env.TTM_DELIVERY_METHOD || 'pickup') as 'pickup' | 'postal'; // เลือกวิธีรับบัตร btn_pickup | btn_thaipost | btn_eticket
const PAYMENT_METHOD = (process.env.TTM_PAYMENT_METHOD || 'qr') as 'qr' | 'credit';
const TARGET_ROUND_INDEX = parseInt(process.env.TARGET_ROUND_INDEX || '0', 10);
const ID_NUMBER = process.env.TTM_ID || '1234567890123';
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
    // await page.goto(EVENT_URL, { waitUntil: 'domcontentloaded' });
    await page.goto(EVENT_URL);

    if (page.url().includes('signin')) {
      console.error(`${logPrefix} ❌  Session หมดอายุ — กรุณารัน manual-login.ts ใหม่อีกครั้ง`);
      await browser.close();
      return;
    }

    console.log(`${logPrefix} ✅  Session ยังใช้ได้`);

    // --- Step 1: Click Buy Now ---
    console.log(`${logPrefix} 🔍  กำลังหาปุ่มซื้อบัตร...`);
    const buySelectors = [`span:has-text("ซื้อบัตร")`];

    let clicked = false;
    for (const selector of buySelectors) {
      try {
        const btn = page.locator(selector).nth(TARGET_ROUND_INDEX);
        // await btn.waitFor({ state: 'visible', timeout: 3000 });
        await btn.click();
        console.log(`${logPrefix} ✅  กดปุ่มซื้อบัตรสำหรับรอบที่ ${TARGET_ROUND_INDEX + 1} แล้ว`);
        clicked = true;

        const nextStateLocator = page.locator('.map-zone').or(page.locator('form#myform')).or(page.locator('#rdagree'));
        // await nextStateLocator.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });

        const isNeedMoreInfo = await page.locator('form#myform').isVisible();
        const isNeedAcceptTerms = await page.locator('#rdagree').isVisible();

        if (isNeedMoreInfo) {
          console.log(`${logPrefix} 📝  กำลังกรอกข้อมูลเพิ่มเติม (ID Card)...`);
          await page.click(`button[data-method="thaiid"]`);
          await page.fill('input#txt_verifycode', ID_NUMBER);
          await page.click('button#btnconfirm');
        } else if (isNeedAcceptTerms) {
          console.log(`${logPrefix} ⚖️  กำลังยอมรับเงื่อนไข...`);
          await page.click('label.label-checkbox');
          await page.click('button#btn_verify');
        }
        break;
      } catch {
        console.error(`${logPrefix} ❌  ไม่สามารถกดปุ่มซื้อบัตรได้`);
      }
    }

    if (!clicked) {
      console.log(`${logPrefix} ⚠️  ไม่พบปุ่มซื้อบัตรอัตโนมัติ`);
      return;
    }

    // --- Step 2 & 3: Loop Priority Zones and Select Seats ---
    const seatPage = new SeatPage(page);
    let seatFound = false;

    console.log(`${logPrefix} ⏳  เริ่มค้นหาที่นั่งตามลำดับ Priority...`);

    for (const zoneToTry of ZONE_PRIORITY) {
      try {
        console.log(`${logPrefix} 🔍  กำลังลองเข้าโซน: ${zoneToTry}`);
        await seatPage.waitForSeatMap();

        const entered = await seatPage.selectZoneByLabel(zoneToTry);
        if (!entered) {
          console.log(`${logPrefix} ⏭️  โซน ${zoneToTry} ไม่ว่างหรือคลิกไม่ได้ ข้ามไปโซนถัดไป...`);
          continue;
        }

        // รอโหลดผังที่นั่งในโซน
        console.log(`${logPrefix} ⏳  กำลังโหลดผังที่นั่งในโซน ${zoneToTry}...`);
        // await page.waitForSelector('#tableseats', { timeout: 10000 }).catch(() => { });
        await page.waitForSelector('#tableseats');

        await seatPage.setQuantity(QUANTITY);
        const seatsByRow = await seatPage.getAllSeatsByRow();
        const result = selectSeats({ seatsByRow, quantity: QUANTITY });

        if (result.success) {
          console.log(`${logPrefix} 🎉  พบที่นั่งในโซน ${zoneToTry}! กำลังเลือก...`);
          for (const seat of result.selected) {
            await seatPage.clickSeat(seat);
            console.log(`${logPrefix} 💺  เลือก: แถว ${seat.row} เลขที่ ${seat.index}`);
          }
          await seatPage.clickProceed();
          seatFound = true;
          break;
        } else {
          console.log(`${logPrefix} 🔄  โซน ${zoneToTry} ไม่มีที่นั่งว่างที่ตรงเงื่อนไข กำลังถอยออก...`);
          await page.goBack();
          // await page.waitForTimeout(1000);
        }
      } catch (err) {
        console.error(`${logPrefix} ❌  พบปัญหาในโซน ${zoneToTry}:`, err);
        await page.goBack().catch(() => { });
      }
    }

    if (seatFound) {
      // --- Step 4: Checkout ---
      console.log(`${logPrefix} ⏳  กำลังไปหน้าชำระเงิน...`);
      const checkoutPage = new CheckoutPage(page);
      await checkoutPage.selectDeliveryMethod(DELIVERY_METHOD);
      await checkoutPage.uncheckTicketProtection();
      await checkoutPage.acceptTermsIfRequired();
      await checkoutPage.selectPaymentMethod(PAYMENT_METHOD);
      await page.pause();

      // console.log(`${logPrefix} 🚀  กำลังยืนยันคำสั่งซื้อ...`);
      // await checkoutPage.confirmOrder();

      // if (PAYMENT_METHOD === 'qr') {
      //   await checkoutPage.waitForQR();
      // }
    } else {
      console.error(`${logPrefix} ❌  ไล่ครบทุกโซนใน Priority แล้วแต่ไม่พบที่นั่งว่างเลย หยุดทำงาน`);
    }

    console.log(`${logPrefix} 💡  เสร็จสิ้นขั้นตอน (Browser จะเปิดค้างไว้ 10 นาที)`);
    await page.waitForTimeout(600_000);

  } catch (err) {
    console.error(`${logPrefix} ❌  Fatal error:`, err);
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.error('❌  ไม่พบโฟลเดอร์ sessions');
    process.exit(1);
  }

  const sessionFiles = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  if (sessionFiles.length === 0) {
    console.error('❌  ไม่พบ session files');
    process.exit(1);
  }

  console.log(`\n🎫  TTM Buy Ticket (Priority Loop Mode)\n`);
  console.log(`   Event URL : ${EVENT_URL}`);
  console.log(`   Quantity  : ${QUANTITY}`);
  console.log(`   Priority  : ${ZONE_PRIORITY.join(' > ')}\n`);

  await Promise.all(sessionFiles.map((file, index) => runBuyTicket(file, index + 1)));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
