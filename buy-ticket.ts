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

// ใช้ล็อคที่นั่งข้าม Browser Context ในเครื่องเดียวกัน เพื่อไม่ให้บอทแย่งกันเอง
const globalSeatLock = new Set<string>();

// ===== ตั้งค่า Event และ การซื้อบัตร =====
const EVENT_URL = process.env.TTM_EVENT_URL || 'https://event.thaiticketmajor.com';
const QUANTITIES = (process.env.TTM_QUANTITY || '1').split(',').map(q => parseInt(q.trim(), 10));
const ZONE_PRIORITY = (process.env.TTM_ZONE_PRIORITY || '').split(',').map(z => z.trim()).filter(z => z);
const DELIVERY_METHOD = (process.env.TTM_DELIVERY_METHOD || 'pickup') as 'pickup' | 'postal';
const PAYMENT_METHOD = (process.env.TTM_PAYMENT_METHOD || 'qr') as 'qr' | 'credit';
const TARGET_ROUND_INDEX = parseInt(process.env.TARGET_ROUND_INDEX || '0', 10);
const ID_NUMBERS = (process.env.TTM_ID || '').split(',').map(id => id.trim());
const MEMBER_CODES = (process.env.TTM_MEMBER_CODE || '').split(',').map(code => code.trim());
const SEAT_MODES = (process.env.TTM_SEAT_MODE || 'FRONT_LEFT').split(',').map(m => m.trim().toUpperCase());
// ============================================

async function runBuyTicket(sessionFile: string, userIndex: number) {
  const sessionPath = path.join(SESSIONS_DIR, sessionFile);
  const logPrefix = `[User ${userIndex}]`;

  // เลือกค่าตามลำดับ User (ถ้ามีไม่พอให้ใช้ตัวแรก)
  const myIdNumber = ID_NUMBERS[userIndex - 1] || ID_NUMBERS[0] || '1234567890123';
  const myQuantity = QUANTITIES[userIndex - 1] || QUANTITIES[0] || 1;
  const myMemberCode = MEMBER_CODES[userIndex - 1] || MEMBER_CODES[0] || '';
  const mySeatMode = (SEAT_MODES[userIndex - 1] || SEAT_MODES[0] || 'FRONT_LEFT') as any;

  console.log(`${logPrefix} 🎫  เริ่มทำงานสำหรับ: ${sessionFile} (ID: ${myIdNumber}, จำนวน: ${myQuantity}, โหมด: ${mySeatMode})`);

  const browser = await chromium.launch({
    headless: false,
    // args: ['--start-maximized'],
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

    // --- Resource Blocking ---
    if (process.env.BLOCK_RESOURCES === 'true') {
      await page.route('**/*', (route) => {
        const req = route.request();
        const type = req.resourceType();
        const url = req.url();

        if (
          ['image', 'font', 'media'].includes(type) ||
          /youtube\.com|youtu\.be|facebook\.com|fbcdn\.net/i.test(url)
        ) {
          return route.abort();
        }

        return route.continue();
      });
    }

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
    const buySelectors = [`span:has-text("ซื้อบัตร")`];

    let clicked = false;
    for (const selector of buySelectors) {
      try {
        const btn = page.locator(selector).nth(TARGET_ROUND_INDEX);
        await btn.click();
        console.log(`${logPrefix} ✅  กดปุ่มซื้อบัตรสำหรับรอบที่ ${TARGET_ROUND_INDEX + 1} แล้ว`);
        clicked = true;

        await page.waitForLoadState('domcontentloaded', { timeout: 2000 });
        const isNeedMoreInfo = await page.isVisible('form#myform');
        const isNeedAcceptTerms = await page.isVisible('#rdagree');
        const isNeedMemberCode = await page.isVisible('input#txt_verifycode');

        if (isNeedMoreInfo) {
          console.log(`${logPrefix} 📝  กำลังกรอกข้อมูลเพิ่มเติม (ID Card: ${myIdNumber})...`);
          await page.click(`button[data-method="thaiid"]`);
          await page.fill('input#txt_verifycode', myIdNumber);
          await page.click('button#btnconfirm');
        } else if (isNeedAcceptTerms) {
          console.log(`${logPrefix} ⚖️  กำลังยอมรับเงื่อนไข...`);
          await page.click('label.label-checkbox');
          await page.click('button#btn_verify');
        } else if (isNeedMemberCode) {
          console.log(`${logPrefix} 🧑‍💻  กำลังกรอกโค้ดสมาชิก (Code: ${myMemberCode})...`);
          await page.fill('input#txt_verifycode', myMemberCode);
          await page.click('button#btnconfirm');
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

    const localDeadSeats = new Set<string>(); // ที่นั่งที่เสียในรอบนี้ (ติด Alert)

    for (const zoneToTry of ZONE_PRIORITY) {
      try {
        console.log(`${logPrefix} 🔍  กำลังลองเข้าโซน: ${zoneToTry}`);
        
        // ป้องกันการติดอยู่ในโซนเดิม: ถ้าเจอ #tableseats แสดงว่ายังไม่ออกหน้าผังโซน
        if (await page.locator('#tableseats').isVisible()) {
          console.log(`${logPrefix} 🔄  ยังค้างอยู่ในโซนอื่น กำลังถอยกลับไปหน้าผัง...`);
          await page.goBack().catch(() => {});
        }

        await seatPage.waitForSeatMap();

        const entered = await seatPage.selectZoneByLabel(zoneToTry);
        if (!entered) {
          console.log(`${logPrefix} ⏭️  โซน ${zoneToTry} ไม่ว่างหรือคลิกไม่ได้ ข้ามไปโซนถัดไป...`);
          continue;
        }

        console.log(`${logPrefix} ⏳  กำลังโหลดผังที่นั่งในโซน ${zoneToTry}...`);
        await page.waitForSelector('#tableseats', { timeout: 10000 }).catch(() => {
          throw new Error(`โหลดผังที่นั่งโซน ${zoneToTry} ไม่สำเร็จ`);
        });

        // วนลูปเลือกที่นั่งในโซนนี้ (เผื่อติด Popup แย่งที่นั่ง)
        let retryInZone = 0;
        while (retryInZone < 10) {
          await seatPage.setQuantity(myQuantity);
          const seatsByRow = await seatPage.getAllSeatsByRow();
          
          // ใช้ globalSeatLock และ localDeadSeats เพื่อเลี่ยงที่นั่งที่ไม่ว่าง
          const combinedExcludes = new Set([...globalSeatLock, ...localDeadSeats]);
          
          const result = selectSeats({ 
            seatsByRow, 
            quantity: myQuantity, 
            zone: zoneToTry, 
            excludeSet: combinedExcludes,
            mode: mySeatMode
          });

          if (result.success) {
            console.log(`${logPrefix} 🎉  พบที่นั่งในโซน ${zoneToTry}! กำลังเลือก...`);
            
            let clickedKeys: string[] = [];
            let collisionFound = false;

            for (const seat of result.selected) {
              const seatKey = `${zoneToTry}-${seat.row}-${seat.index}`;
              globalSeatLock.add(seatKey); // จองไว้ในระบบบอทเราเองก่อน
              
              await seatPage.clickSeat(seat);
              
              // เช็ค Popup ทันทีหลังกดแต่ละที่นั่ง
              const alert = page.locator('div#popup_alert');
              if (await alert.isVisible({ timeout: 500 }).catch(() => false)) {
                console.log(`${logPrefix} ⚠️  ที่นั่ง ${seat.row}-${seat.index} ถูกแย่ง! กำลังลองที่ใหม่...`);
                await page.keyboard.press('Escape');
                
                // เก็บที่นั่งกลุ่มนี้ลง deadSeats เพื่อไม่ให้เลือกซ้ำอีก
                result.selected.forEach(s => localDeadSeats.add(`${zoneToTry}-${s.row}-${s.index}`));
                
                collisionFound = true;
                break; 
              }
              
              clickedKeys.push(seatKey);
              console.log(`${logPrefix} 💺  เลือก: แถว ${seat.row} เลขที่ ${seat.index}`);
            }

            if (collisionFound) {
              retryInZone++;
              continue; // วนหาที่ใหม่ในโซนเดิม
            }

            // ตรวจสอบความชัวร์ว่าเลือกที่นั่งครบตามจำนวนก่อนกด Proceed
            if (clickedKeys.length === myQuantity) {
              await seatPage.clickProceed();
              
              // เช็ค Alert สุดท้ายหลังกด Proceed
              const finalAlert = page.locator('div#popup_alert');
              if (await finalAlert.isVisible({ timeout: 500 }).catch(() => false)) {
                console.log(`${logPrefix} ⚠️  ติดปัญหาตอนยืนยัน (Final Alert)! กำลังลองที่ใหม่...`);
                await page.keyboard.press('Escape');
                clickedKeys.forEach(key => localDeadSeats.add(key));
                retryInZone++;
                continue;
              }
              
              seatFound = true;
              break;
            } else {
              console.log(`${logPrefix} ⚠️  เลือกที่นั่งได้ไม่ครบ (${clickedKeys.length}/${myQuantity}) กำลังลองใหม่...`);
              retryInZone++;
              continue;
            }
          } else {
            console.log(`${logPrefix} 🔄  โซน ${zoneToTry} ไม่มีที่นั่งว่างที่ตรงเงื่อนไข...`);
            await page.goBack().catch(() => {});
            break; // ออกจาก while ไปลองโซนถัดไป
          }
        }

        if (seatFound) {
          break;
        } else {
          if (await page.locator('#tableseats').isVisible()) {
            await page.goBack().catch(() => {});
          }
        }
      } catch (err) {
        console.error(`${logPrefix} ❌  พบปัญหาในโซน ${zoneToTry}:`, err);
        if (await page.locator('#tableseats').isVisible()) {
          await page.goBack().catch(() => { });
        }
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
  console.log(`   Quantity  : ${QUANTITIES.join(', ')}`);
  console.log(`   Priority  : ${ZONE_PRIORITY.join(' > ')}\n`);

  await Promise.all(sessionFiles.map((file, index) => runBuyTicket(file, index + 1)));
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
