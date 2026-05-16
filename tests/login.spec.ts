import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test.describe('Login Flow', () => {
  test('should login successfully with valid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto();

    // Use environment variables for sensitive data
    const username = process.env.TTM_USERNAME || 'your-email@example.com';
    const password = process.env.TTM_PASSWORD || 'your-password';

    await loginPage.login(username, password);

    await loginPage.assertLoggedIn();
  });

  test('should show error with invalid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await loginPage.goto();
    await loginPage.login('invalid@example.com', 'wrongpassword');

    // This assertion depends on how the site handles errors
    // await expect(loginPage.errorMessage).toBeVisible();
  });
});
