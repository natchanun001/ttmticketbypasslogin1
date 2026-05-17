
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
const EVENT_URL = 'https://www.thaiticketmajor.com/performance/girl-rules-final-ep-fan-meeting.html';

// ตั้งค่าเริ่มต้น (สามารถแก้ใน .env ได้)
const QUANTITY = parseInt(process.env.TTM_QUANTITY || '1', 10);
const ZONE_PRIORITY = (process.env.TTM_ZONE_PRIORITY || '').split(',').map(z => z.trim()).filter(z => z);
const DELIVERY_METHOD = (process.env.TTM_DELIVERY_METHOD || 'pickup') as 'pickup' | 'postal';
const PAYMENT_METHOD = (process.env.TTM_PAYMENT_METHOD || 'qr') as 'qr' | 'credit';

async function main() {
  if (!fs.existsSync(STATE_FILE)) {
    console.error('❌ ไม่พบ auth-state.json — กรุณารัน npx tsx manual-login.ts ก่อน');
    process.exit(1);
  }

  console.log('\n🌸 TTM Girl Rules Test (Automated Buy Flow)\n');
  console.log(`   Event URL : ${EVENT_URL}`);
  console.log(`   Quantity  : ${QUANTITY} ที่นั่ง`);
  console.log(`   Session   : ${STATE_FILE}\n`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    storageState: STATE_FILE,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: null,
  });

  const page = await context.newPage();

  console.log('🌐 กำลังไปที่หน้าอีเวนต์...');
  await page.goto(EVENT_URL, { waitUntil: 'domcontentloaded' });

  // เช็คว่าต้อง login ไหม
  if (page.url().includes('signin')) {
    console.error('❌ Session หมดอายุ — กรุณารัน manual-login.ts ใหม่อีกครั้ง');
    await browser.close();
    process.exit(1);
  }

  // --- Step 1: ค้นหาและกดปุ่ม "ซื้อบัตร" ---
  console.log('🔍 กำลังหาปุ่มซื้อบัตร...');
  
  // รอให้หน้าโหลดนิ่งๆ อีกนิด
  await page.waitForTimeout(2000);

  const buySelectors = [
    'a.btn-buynow', 
    'a[href*="booking.thaiticketmajor.com"]',
    'a:has-text("ซื้อบัตร")', 
    'a:has-text("Buy")',
    '.btn-red.btn-item',
    'span:has-text("ซื้อบัตร")',
    '.btn-buy'
  ];

  let clicked = false;
  
  // ลองหาในทุกลิงก์บนหน้าเว็บดู
  const allLinks = await page.locator('a').all();
  console.log(`ℹ️ พบลิงก์ทั้งหมด ${allLinks.length} ลิงก์บนหน้าเว็บ`);

  for (const selector of buySelectors) {
    try {
      const btn = page.locator(selector).first();
      const isVisible = await btn.isVisible();
      
      if (isVisible) {
        console.log(`🎯 พบปุ่มด้วย selector: ${selector}`);
        
        // ลอง scroll ไปหามันก่อน
        await btn.scrollIntoViewIfNeeded();
        
        // ลองกดแบบปกติ
        await btn.click({ timeout: 5000 });
        console.log(`✅ กดปุ่มซื้อบัตรแล้ว (${selector})`);
        clicked = true;
        break;
      }
    } catch (e) {
      // ลองกดผ่าน JavaScript ถ้ากดปกติไม่ได้
      try {
        const btn = page.locator(selector).first();
        await btn.evaluate(node => (node as HTMLElement).click());
        console.log(`✅ กดปุ่มซื้อบัตรแล้ว (via JS: ${selector})`);
        clicked = true;
        break;
      } catch (innerE) {}
    }
  }

  if (!clicked) {
    console.log('⚠️ ไม่พบปุ่มผ่าน Selector ปกติ กำลังลองค้นหาแบบเจาะจง...');
    // ลองค้นหาทุกลิงก์ที่อาจจะเป็นปุ่มซื้อ
    const buynowBtn = page.locator('a').filter({ has: page.locator('img[alt="ซื้อบัตร"]'), hasText: 'ซื้อบัตร' }).first();
    if (await buynowBtn.count() > 0) {
        await buynowBtn.click();
        console.log('✅ กดปุ่มซื้อบัตรแล้ว (Special Filter)');
        clicked = true;
    }
  }

  if (!clicked) {
    console.log('⚠️ ไม่พบปุ่มซื้อบัตรอัตโนมัติ (อาจจะยังไม่เปิดขายหรือต้องกดเองในหน้าจอ)');
  } else {
    try {
      // --- Step 2: เลือกโซน ---
      const seatPage = new SeatPage(page);
      console.log('⏳ กำลังโหลดผังที่นั่ง...');
      await seatPage.waitForSeatMap();
      
      const selectedZone = await selectZone(seatPage, ZONE_PRIORITY);
      if (selectedZone) {
        console.log(`✅ เลือกโซน: ${selectedZone}`);
      } else {
        console.log('⚠️ ไม่ระบุโซนเป้าหมาย หรือโซนที่ระบุเต็ม จะพยายามเลือกโซนแรกที่ว่าง...');
      }

      // --- Step 3: เลือกที่นั่ง ---
      console.log(`⏳ กำลังหาที่นั่งว่าง (${QUANTITY} ที่)...`);
      await seatPage.setQuantity(QUANTITY);
      
      const seatsByRow = await seatPage.getAllSeatsByRow();
      const result = selectSeats({ seatsByRow, quantity: QUANTITY });

      if (result.success) {
        for (const seat of result.selected) {
          await seatPage.clickSeat(seat);
          console.log(`💺 เลือกที่นั่ง: แถว ${seat.row} ลำดับที่ ${seat.index + 1}`);
        }
        await seatPage.clickProceed();
        console.log('✅ ยืนยันการเลือกที่นั่ง');

        // --- Step 4: ขั้นตอนการจ่ายเงิน (Checkout) ---
        console.log('⏳ กำลังไปหน้าชำระเงิน...');
        const checkoutPage = new CheckoutPage(page);
        
        await checkoutPage.selectDeliveryMethod(DELIVERY_METHOD);
        await checkoutPage.selectPaymentMethod(PAYMENT_METHOD);
        await checkoutPage.acceptTermsIfRequired();
        
        console.log('🚀 กำลังยืนยันคำสั่งซื้อเพื่อรับ QR Code...');
        await checkoutPage.confirmOrder();
        
        if (PAYMENT_METHOD === 'qr') {
          console.log('⏳ รอโหลด QR Code...');
          await checkoutPage.waitForQR();
          console.log('🎉 QR Code พร้อมแล้ว! สามารถสแกนจ่ายเงินได้ทันที');
        } else {
          console.log('🎉 มาถึงหน้าจ่ายเงินแล้ว!');
        }
      } else {
        console.log('❌ ไม่พบที่นั่งว่างที่ติดกันตามจำนวนที่ต้องการ');
      }

    } catch (err) {
      console.error('❌ เกิดข้อผิดพลาดระหว่างรัน:', err);
    }
  }

  console.log('\n💡 Browser จะเปิดค้างไว้ 10 นาทีเพื่อให้คุณจัดการต่อ');
  await page.waitForTimeout(600_000); 
  await browser.close();
}

main().catch(console.error);
