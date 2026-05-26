import { chromium, BrowserContext } from 'playwright';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const LOGIN_URL = 'https://event.thaiticketmajor.com/user/signin.php?redir=/index.html';
const SESSIONS_DIR = path.resolve(__dirname, 'sessions');
const PROFILES_DIR = path.resolve(__dirname, '.chrome-profiles');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (ans: string) => { rl.close(); resolve(ans); }));
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res: http.IncomingMessage) => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

(async () => {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR);
  if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR);

  console.log('🎫  TTM Multi-User Manual Login (Direct Chrome Spawn)');
  const numUsersStr = await askQuestion('ต้องการ Login กี่ User? (ค่าเริ่มต้น 10): ');
  const numUsers = parseInt(numUsersStr) || 10;

  const chromeProcesses: ChildProcess[] = [];
  const ports = Array.from({ length: numUsers }, (_, i) => 9222 + i);

  console.log(`🚀  กำลังเริ่มเปิด Chrome ${numUsers} หน้าต่าง...`);

  for (let i = 0; i < numUsers; i++) {
    const port = ports[i];
    const userProfilePath = path.join(PROFILES_DIR, `user_${i + 1}`);
    const userEmail = process.env[`TTM_USER${i + 1}_EMAIL`];
    const userPass = process.env[`TTM_USER${i + 1}_PASS`];
    
    console.log(`⏳  เปิดหน้าต่างที่ ${i + 1} (Port: ${port})...`);

    const cp = spawn(CHROME_PATH, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userProfilePath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled'
    ], { detached: true, stdio: 'ignore' });
    cp.unref();
    chromeProcesses.push(cp);

    // รอจนกว่า Port จะพร้อม
    let connected = false;
    for (let j = 0; j < 15; j++) {
      if (await isPortOpen(port)) {
        connected = true;
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (connected) {
        try {
            const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
            const context = browser.contexts()[0];
            const page = context.pages()[0] || await context.newPage();
            
            await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
            console.log(`   ✅ User ${i + 1} กำลังโหลดหน้า Login...`);

            // ถ้ามี credentials ใน .env ให้กรอกให้อัตโนมัติ
            if (userEmail && userPass) {
                try {
                    console.log(`   ⌨️  User ${i + 1}: กำลังกรอกข้อมูล Login...`);
                    const userField = page.locator('input[name="email"], input[name="username"]').first();
                    const passField = page.locator('input[name="password"]').first();
                    const loginBtn = page.locator('button[type="submit"].btn-signin').first();

                    await userField.waitFor({ state: 'visible', timeout: 10000 });
                    await userField.fill(userEmail);
                    await passField.fill(userPass);
                    
                    // วิธีที่ 1: กด Enter ในช่องรหัสผ่าน (มักจะได้ผลดีที่สุด)
                    await page.waitForTimeout(500);
                    await passField.press('Enter');
                    console.log(`   🚀 User ${i + 1}: ส่งข้อมูล Login (กด Enter)...`);
                    
                    // วิธีที่ 2: รอซักพัก ถ้ายังไม่เปลี่ยนหน้า ให้พยายามกดปุ่มโดยตรง
                    await page.waitForTimeout(2000);
                    if (page.url().includes('signin.php')) {
                        console.log(`   ⏳ User ${i + 1}: ยังอยู่ที่เดิม กำลังลองกดปุ่ม Login โดยตรง...`);
                        try {
                            const loginBtn = page.locator('button.btn-signin[type="submit"], button.btn-red.btn-signin').first();
                            await loginBtn.click({ force: true, timeout: 3000 });
                        } catch (err) {
                            // สุดท้าย: ลองใช้ JavaScript คลิกที่ปุ่มที่มีคำว่า "เข้าสู่ระบบ"
                            await page.evaluate(() => {
                                const btns = Array.from(document.querySelectorAll('button'));
                                const loginBtn = btns.find(b => b.innerText.includes('เข้าสู่ระบบ') || b.className.includes('btn-signin'));
                                if (loginBtn) loginBtn.click();
                            });
                        }
                    }
                    
                    console.log(`   ✨ User ${i + 1}: ดำเนินการส่งข้อมูลเรียบร้อย`);
                } catch (err) {
                    console.log(`   ⚠️  User ${i + 1}: ระบบอัตโนมัติพบปัญหา: ${err.message}`);
                }
            }

            // ถอด browser.close() ออกจากตรงนี้เพื่อให้ Connection และหน้าต่างเปิดค้างไว้จนกว่าจะกด Enter
        } catch (e) {
            console.error(`   ❌ ไม่สามารถเชื่อมต่อ CDP กับ User ${i + 1} ได้: ${e}`);
        }
    } else {
        console.error(`   ❌ User ${i + 1} เปิดไม่สำเร็จ (Port ${port} Timeout)`);
    }
  }

  console.log('\n✅  ทุกหน้าต่างเปิดแล้ว — กรุณาตรวจสอบการ Login');
  console.log('   (ถ้าติด Captcha หรือยังไม่ Login กรุณาจัดการด้วยตนเอง)');
  console.log('   เมื่อสำเร็จครบหมดแล้ว กลับมากด Enter ที่นี่เพื่อบันทึก session และปิด Chrome\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('กด Enter เมื่อ Login สำเร็จครบทุกหน้าต่าง...', resolve));
  rl.close();

  console.log('\n💾  กำลังบันทึก sessions และปิด Chrome...');
  for (let i = 0; i < numUsers; i++) {
    try {
      const port = ports[i];
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const context = browser.contexts()[0];
      const sessionPath = path.join(SESSIONS_DIR, `user_${i + 1}.json`);
      
      await context.storageState({ path: sessionPath });
      console.log(`   ✅ บันทึก User ${i + 1} สำเร็จ`);
      
      await browser.close();
      console.log(`   🚪 ปิดหน้าต่าง User ${i + 1} แล้ว`);
    } catch (e) {
      console.error(`   ❌ ไม่สามารถบันทึกหรือปิด User ${i + 1} ได้: ${e}`);
    }
  }

  // Fallback kill
  chromeProcesses.forEach((cp) => {
    if (cp.pid) {
      try { process.kill(-cp.pid, 'SIGTERM'); } catch (e) {}
    }
  });

  console.log('\n✨  เสร็จเรียบร้อย! พร้อมรันซื้อบัตรต่อ');
  process.exit(0);
})();