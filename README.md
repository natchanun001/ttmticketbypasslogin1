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
# ttmTicketBypassLogin1
# ttmTicketBypassLogin1
