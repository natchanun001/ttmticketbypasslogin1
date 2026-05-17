
import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const STATE_FILE = path.resolve(__dirname, 'auth-state.json');
const EVENT_URL = 'https://www.thaiticketmajor.com/concert/the-weeknd-after-hours--til-dawn-tour.html';

async function main() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        storageState: fs.existsSync(STATE_FILE) ? STATE_FILE : undefined,
    });
    const page = await context.newPage();

    console.log('Navigating to:', EVENT_URL);
    await page.goto(EVENT_URL, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'step1-event-page.png' });

    console.log('Finding Buy button...');
    
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
    for (const selector of buySelectors) {
        try {
            const btn = page.locator(selector).first();
            const isVisible = await btn.isVisible();
            
            if (isVisible) {
                console.log(`🎯 พบปุ่มด้วย selector: ${selector}`);
                await btn.scrollIntoViewIfNeeded();
                await btn.click({ timeout: 5000 });
                console.log(`✅ กดปุ่มซื้อบัตรแล้ว (${selector})`);
                clicked = true;
                break;
            }
        } catch (e) {
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
        const buynowBtn = page.locator('a').filter({ has: page.locator('img[alt="ซื้อบัตร"]'), hasText: 'ซื้อบัตร' }).first();
        if (await buynowBtn.count() > 0) {
            await buynowBtn.click();
            console.log('✅ กดปุ่มซื้อบัตรแล้ว (Special Filter)');
            clicked = true;
        }
    }

    if (clicked) {
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: 'step2-after-buy-click.png' });
        console.log('Current URL:', page.url());
    } else {
        console.log('Buy button not found or not visible.');
    }

    await browser.close();
}

main().catch(console.error);
