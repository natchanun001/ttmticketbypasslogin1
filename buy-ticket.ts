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

async function handleQueueAndPopups(page: any, logPrefix: string) {
  const popups = [
    { selector: '#lbConfirm', name: "Yes, I'm here (Queue-it)" },
    { selector: 'button:has-text("Yes, I\'m here")', name: "Yes, I'm here" },
    { selector: 'button:has-text("เข้าร่วมคิว")', name: "เข้าร่วมคิว" },
    { selector: 'a:has-text("Click here to get in line")', name: "Click here to get in line" },
    { selector: 'a:has-text("GET QUEUE")', name: "GET QUEUE" },
    { selector: 'a:has-text("ENTER SITE")', name: "ENTER SITE" },
    { selector: 'button:has-text("ยืนยันตัวตน")', name: "ยืนยันตัวตน" },
    { selector: 'button:has-text("ฉันยังอยู่")', name: "ฉันยังอยู่" },
    { selector: 'button:has-text("I\'m here")', name: "I'm here" },
  ];

  for (const popup of popups) {
    try {
      const locator = page.locator(popup.selector);
      if (await locator.isVisible({ timeout: 300 }).catch(() => false)) {
        console.log(`${logPrefix} ✨  ตรวจพบและกำลังกด: ${popup.name}`);
        await locator.click({ timeout: 2000 }).catch(() => {});
      }
    } catch (e) {}
  }
}

async function runBuyTicket(sessionFile: string, userIndex: number) {
  const sessionPath = path.join(SESSIONS_DIR, sessionFile);
  const logPrefix = `[User ${userIndex}]`;

  // เลือกค่าตามลำดับ User (ถ้ามีไม่พอให้ใช้ตัวแรก)
  const myIdNumber = ID_NUMBERS[userIndex - 1] || ID_NUMBERS[0] || '1234567890123';
  const myQuantity = QUANTITIES[userIndex - 1] || QUANTITIES[0] || 1;
  const myMemberCode = MEMBER_CODES[userIndex - 1] || MEMBER_CODES[0] || '';
  const mySeatMode = (SEAT_MODES[userIndex - 1] || SEAT_MODES[0] || 'FRONT_LEFT') as any;

  console.log(`${logPrefix} 🎫  เริ่มทำงานสำหรับ: ${sessionFile} (ID: ${myIdNumber}, จำนวน: ${myQuantity}, โหมด: ${mySeatMode})`);

  const browser = await chromium.launch({ headless: false });

  try {
    const context = await browser.newContext({
      storageState: sessionPath,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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

    // --- Step 1: Click Buy Now & Select Round ---
    const seatPage = new SeatPage(page);
    let seatFound = false;
    const localDeadSeats = new Set<string>();
    let globalRetryCount = 0;

    while (!seatFound) {
      globalRetryCount++;
      console.log(`${logPrefix} ⏳ รอบที่ ${globalRetryCount}: เริ่มต้นค้นหาที่นั่งตามลำดับ Priority...`);

      // 1. ตรวจสอบว่าอยู่หน้าไหน ถ้ายังไม่อยู่หน้าจอง ให้พยายามกดเข้า
      let currentUrl = page.url();
      if (!currentUrl.includes('booking') && !currentUrl.includes('seat')) {
        console.log(`${logPrefix} 🔍 กำลังค้นหาปุ่มซื้อบัตรหรือหน้าเลือกรอบ...`);
        
        // ลองหาปุ่ม "ซื้อบัตร"
        const buySelectors = ['span:has-text("ซื้อบัตร")', 'a:has-text("ซื้อบัตร")', 'button:has-text("ซื้อบัตร")', 'a.btn-buynow', '.btn-buy'];
        let buyClicked = false;
        for (const selector of buySelectors) {
            const btns = page.locator(selector);
            if (await btns.count() > 0) {
                const targetIndex = Math.min(TARGET_ROUND_INDEX, (await btns.count()) - 1);
                const btn = btns.nth(targetIndex);
                if (await btn.isVisible()) {
                    await btn.click().catch(() => {});
                    buyClicked = true;
                    break;
                }
            }
        }

        // ลองหาปุ่มเลือกรอบ (กรณีเข้าหน้าเลือกรอบแยก)
        const roundSelectors = ['.btn-selection-round', 'a[href*="round="]', 'button:has-text("รอบที่")', 'a:has-text("รอบที่")', '.item-round', '.round-item', '[data-round]', '.round-list a'];
        for (const selector of roundSelectors) {
            const rounds = page.locator(selector);
            if (await rounds.count() > 0) {
                const targetIndex = Math.min(TARGET_ROUND_INDEX, (await rounds.count()) - 1);
                await rounds.nth(targetIndex).click().catch(() => {});
                buyClicked = true;
                break;
            }
        }

        if (buyClicked) {
            await page.waitForTimeout(3000);
            // ตรวจสอบเงื่อนไขเพิ่มเติม (ID Card, Terms, etc.)
            if (await page.isVisible('form#myform')) {
                await page.click(`button[data-method="thaiid"]`).catch(() => {});
                await page.fill('input#txt_verifycode', myIdNumber);
                await page.click('button#btnconfirm');
            } else if (await page.isVisible('#rdagree')) {
                await page.click('label.label-checkbox').catch(() => {});
                await page.click('button#btn_verify');
            } else if (await page.isVisible('input#txt_verifycode')) {
                await page.fill('input#txt_verifycode', myMemberCode);
                await page.click('button#btnconfirm');
            }
        } else {
            // ถ้ายังไม่เจออะไรเลย ให้รีเฟรชหรือไปหน้าหลักใหม่
            if (globalRetryCount % 5 === 0) await page.goto(EVENT_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
        }
      }

      // 2. ลูปค้นหาที่นั่งตามโซน
      for (const zoneToTry of ZONE_PRIORITY) {
        try {
          const targetZone = zoneToTry.toUpperCase();
          console.log(`${logPrefix} 🔍 [รอบ ${globalRetryCount}] กำลังลองเข้าโซน: ${targetZone}`);
          
          // ตรวจสอบว่าอยู่หน้าผังที่นั่งหรือไม่ ถ้าอยู่ให้ถอยกลับมาหน้าผังโซนเพื่อรีเฟรช
          const isAtSeatMap = await page.locator('#tableseats, .seat-container, .seat-map').isVisible();
          if (isAtSeatMap) {
              console.log(`${logPrefix} 🔄 อยู่หน้าผังที่นั่ง กำลังถอยกลับไปหน้าผังโซน...`);
              await page.goBack().catch(() => {});
              await page.waitForTimeout(1000);
          }

          await seatPage.waitForSeatMap();
          
          // ค้นหาพื้นที่โซนและคลิก (เน้นความแม่นยำสูง)
          let entered = false;
          const areas = page.locator('map area, area');
          const areaCount = await areas.count();
          
          for (let i = 0; i < areaCount; i++) {
              const area = areas.nth(i);
              const areaData = await area.evaluate(el => ({
                  href: el.getAttribute('href') || '',
                  alt: el.getAttribute('alt') || '',
                  title: el.getAttribute('title') || '',
                  outerHTML: el.outerHTML
              }));
              
              // ตรวจสอบความแม่นยำ: ต้องลงท้ายด้วย #SL หรือ alt/title เป็น SL เป๊ะๆ
              const isExactMatch = 
                  areaData.href.toUpperCase().endsWith(`#${targetZone}`) || 
                  areaData.alt.toUpperCase() === targetZone || 
                  areaData.title.toUpperCase() === targetZone ||
                  areaData.outerHTML.toUpperCase().includes(`"#${targetZone}"`) ||
                  areaData.outerHTML.toUpperCase().includes(`'#${targetZone}'`);

              if (isExactMatch) {
                  console.log(`${logPrefix} 🎯 พบโซน ${targetZone} (Exact Match)! กำลังคลิก...`);
                  await area.click({ force: true, timeout: 2000 }).catch(() => area.dispatchEvent('click'));
                  entered = true;
                  break;
              }
          }

          // Fallback: ถ้ายังไม่เจอ ให้ลองค้นหาแบบกว้างขึ้นนิดหน่อย
          if (!entered) {
              for (let i = 0; i < areaCount; i++) {
                  const area = areas.nth(i);
                  const info = await area.evaluate(el => (el.getAttribute('href') || '') + (el.getAttribute('alt') || '') + (el.getAttribute('title') || ''));
                  if (info.toUpperCase().includes(targetZone)) {
                      console.log(`${logPrefix} 🎯 พบโซน ${targetZone} (Partial Match)! กำลังคลิก...`);
                      await area.click({ force: true, timeout: 2000 }).catch(() => area.dispatchEvent('click'));
                      entered = true;
                      break;
                  }
              }
          }

          if (!entered) {
              entered = await seatPage.selectZoneByLabel(targetZone);
          }

          // รอผังที่นั่ง
          const isTableVisible = await page.waitForSelector('#tableseats', { timeout: 6000 }).catch(() => false);
          if (!isTableVisible) {
            if (await page.isVisible('select[name="quantity"]') || await page.isVisible('#ticket-quantity')) {
                console.log(`${logPrefix} 🎟️ โซนยืน: กำลังกดดำเนินการต่อ...`);
                await seatPage.setQuantity(myQuantity);
                await seatPage.clickProceed().catch(() => {});
                if (await page.locator('div#popup_alert').isVisible({ timeout: 1000 }).catch(() => false)) {
                    await page.keyboard.press('Escape');
                    continue;
                }
                seatFound = true;
                break;
            }
            await page.goBack().catch(() => {});
            continue;
          }

          // เลือกที่นั่ง
          let retryInZone = 0;
          while (retryInZone < 2) { 
            await seatPage.setQuantity(myQuantity);
            const seatsByRow = await seatPage.getAllSeatsByRow();
            const combinedExcludes = new Set([...globalSeatLock, ...localDeadSeats]);
            
            const result = selectSeats({ seatsByRow, quantity: myQuantity, zone: zoneToTry, excludeSet: combinedExcludes, mode: mySeatMode });

            if (result.success) {
              console.log(`${logPrefix} 🎉 พบที่นั่งในโซน ${zoneToTry}!`);
              let clickedKeys: string[] = [];
              let collisionFound = false;

              for (const seat of result.selected) {
                const seatKey = `${zoneToTry}-${seat.row}-${seat.index}`;
                globalSeatLock.add(seatKey);
                await seatPage.clickSeat(seat);
                
                if (await page.locator('div#popup_alert').isVisible({ timeout: 400 }).catch(() => false)) {
                  await page.keyboard.press('Escape');
                  result.selected.forEach(s => localDeadSeats.add(`${zoneToTry}-${s.row}-${s.index}`));
                  collisionFound = true;
                  break; 
                }
                clickedKeys.push(seatKey);
              }

              if (collisionFound) { retryInZone++; continue; }

              if (clickedKeys.length === myQuantity) {
                await seatPage.clickProceed();
                if (await page.locator('div#popup_alert').isVisible({ timeout: 1500 }).catch(() => false)) {
                  await page.keyboard.press('Escape');
                  clickedKeys.forEach(key => localDeadSeats.add(key));
                  retryInZone++; continue;
                }
                seatFound = true;
                break;
              } else { retryInZone++; continue; }
            } else {
              break; 
            }
          }
          if (seatFound) break;
          await page.goBack().catch(() => {});
          await page.waitForTimeout(500);
        } catch (err) {
          await page.goBack().catch(() => {}).catch(() => {});
        }
      }

      if (!seatFound) {
        if (globalRetryCount % 10 === 0) localDeadSeats.clear();
        await page.waitForTimeout(1000);
      }
    }

    if (seatFound) {
      console.log(`${logPrefix} ⏳  กำลังไปหน้าชำระเงิน...`);
      const checkoutPage = new CheckoutPage(page);
      await checkoutPage.selectDeliveryMethod(DELIVERY_METHOD);
      await checkoutPage.uncheckTicketProtection();
      await checkoutPage.acceptTermsIfRequired();
      await checkoutPage.selectPaymentMethod(PAYMENT_METHOD);
      console.log(`${logPrefix} ✅  มาถึงหน้าชำระเงินแล้ว!`);
    }

    await page.waitForTimeout(600_000);
  } catch (err) {
    console.error(`${logPrefix} ❌  Error:`, err);
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR);
  const sessionFiles = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  if (sessionFiles.length === 0) {
    console.error('❌  ไม่พบ session files');
    process.exit(1);
  }
  await Promise.all(sessionFiles.map((file, index) => runBuyTicket(file, index + 1)));
}

main().catch(console.error);
