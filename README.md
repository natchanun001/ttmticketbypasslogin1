# ThaiTicketMajor Login Automation (Playwright)

This project contains a Playwright-based structure to automate the login process for ThaiTicketMajor.

## Structure

- `pages/LoginPage.ts`: Page Object Model containing selectors and actions for the login page.
- `tests/login.spec.ts`: Test cases for successful and failed login scenarios.
- `playwright.config.ts`: Configuration for Playwright (baseURL, browsers, etc.).
- `.env`: Environment variables for sensitive data (username/password).

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Playwright browsers:
   ```bash
   npx playwright install
   ```

3. Configure your credentials:
   - Copy `.env.example` to `.env`.
   - Update `TTM_USERNAME` and `TTM_PASSWORD` with your real ThaiTicketMajor credentials.

## Running Tests

- Run all tests (headless):
  ```bash
  npm test
  ```

- Run tests in headed mode (visible browser):
  ```bash
  npm run test:headed
  ```

- Open Playwright UI:
  ```bash
  npm run test:ui
  ```

## Troubleshooting

- **Access Denied (403):** ThaiTicketMajor has strong bot protection. If you encounter an "Access Denied" page, try running in **headed mode** (`npm run test:headed`) and manually solve any CAPTCHAs or challenges.
- **Selectors:** If the login page structure changes, update the selectors in `pages/LoginPage.ts`. Currently, it uses common name attributes like `email` and `password`.
- **URL:** The target URL is set to `https://event.thaiticketmajor.com/user/signin.php?redir=/index.html`. If you need to login via the main member page, update the `baseURL` in `playwright.config.ts` or the `goto()` method in `LoginPage.ts`.
## วิธีการใช้งาน (Manual Login Flow)

ทำตามลำดับนี้เพื่อบันทึก Session และซื้อบัตร:

1. **ปิด Chrome ทุกหน้าต่างก่อน** (สำคัญมาก)
2. **เปิด Chrome ใหม่แบบ remote debug:**
   เปิด Terminal แล้วรันคำสั่ง:
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
   ```
3. **เปิด Terminal ใหม่อีกอัน** แล้วรัน:
   ```bash
   cd ~/Downloads/ttm.new
   npx tsx manual-login.ts
   ```
4. **Login ด้วยมือ** ใน Chrome ที่เปิดขึ้นมาใหม่นั้นให้เรียบร้อย แล้วกลับมากด **Enter** ใน Terminal ที่รัน `manual-login.ts`
5. **หลังจาก session บันทึกเรียบร้อยแล้ว** ให้รันคำสั่งซื้อบัตร (รองรับระบบกดโซนและที่นั่งอัตโนมัติ):
   ```bash
   npx tsx buy-ticket.ts
   ```

### การตั้งค่าเพิ่มเติม (.env)

คุณสามารถตั้งค่าการซื้อบัตรอัตโนมัติได้ในไฟล์ `.env`:
- `TTM_QUANTITY`: จำนวนบัตรที่ต้องการ (เช่น 1, 2)
- `TTM_ZONE_PRIORITY`: ลำดับโซนที่ต้องการ (เช่น A1,B1,A2) ถ้าโซนแรกเต็มจะข้ามไปโซนถัดไป
- `TTM_DELIVERY_METHOD`: วิธีรับบัตร (`pickup` รับหน้างาน, `postal` ส่งไปรษณีย์)
- `TTM_PAYMENT_METHOD`: วิธีชำระเงิน (`qr` สำหรับ PromptPay, `credit` สำหรับบัตรเครดิต)

# ttmTicketBypassLogin1
# ttmTicketBypassLogin1
