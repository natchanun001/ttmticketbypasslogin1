import { chromium } from 'playwright';
import * as readline from 'readline';
import * as path from 'path';
import { spawn } from 'child_process';
import * as http from 'http';

const LOGIN_URL = 'https://event.thaiticketmajor.com/user/signin.php?redir=/index.html';
const STATE_FILE = path.resolve(__dirname, 'auth-state.json');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

(async () => {
  const tempProfilePath = path.resolve(__dirname, '.chrome-temp');

  console.log('🚀  กำลังเปิด Google Chrome...');
  
  // เปิด Chrome โดยตรง (ไม่ผ่าน open command) เพื่อให้ได้ logs และควบคุมได้ดีกว่า
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=9222`,
    `--user-data-dir=${tempProfilePath}`,
    '--no-first-run',
    '--no-default-browser-check'
  ], {
    detached: true,
    stdio: 'ignore'
  });
  chromeProcess.unref();

  // รอจนกว่า Port จะเปิด (สูงสุด 10 วินาที)
  console.log('⏳  กำลังรอ Chrome ตอบรับ (Port 9222)...');
  let connected = false;
  for (let i = 0; i < 20; i++) {
    if (await isPortOpen(9222)) {
      connected = true;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!connected) {
    console.error('\n❌  ไม่สามารถเชื่อมต่อกับ Chrome ได้ (Timeout)');
    console.log('กรุณาลองปิด Chrome ทั้งหมดแล้วรันใหม่อีกครั้ง');
    process.exit(1);
  }

  console.log('🔗  เชื่อมต่อสำเร็จ! กำลังเปิดหน้า Login...');

  // เชื่อมต่อกับ Chrome ที่เปิดอยู่
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  
  // ตรวจสอบว่ามีหน้าเปิดอยู่ไหม ถ้าไม่มีให้สร้างใหม่
  let page = context.pages()[0];
  if (!page) {
    page = await context.newPage();
  }

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  console.log('\n✅  Chrome เปิดแล้ว — กรุณา login ด้วยมือ');
  console.log('   กลับมากด Enter เมื่อ login สำเร็จแล้ว\n');

  await waitForEnter('กด Enter เมื่อ login สำเร็จ...');

  await context.storageState({ path: STATE_FILE });
  console.log(`\n💾  บันทึก session แล้วที่: ${STATE_FILE}`);
  console.log('   รันต่อด้วย:  npx tsx buy-ticket.ts\n');

  await browser.close();
})();