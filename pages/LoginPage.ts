import { Page, Locator, expect } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    // Based on common TTM structure, these might need adjustment
    // Using name attributes as they are often more stable
    this.usernameInput = page.locator('input[name="email"], input[name="username"]');
    this.passwordInput = page.locator('input[name="password"]');
    this.loginButton = page.locator('button[type="submit"], input[type="submit"]');
    this.errorMessage = page.locator('.error-message, .alert-danger'); // Common error classes
  }

  async goto() {
    await this.page.goto('/user/signin.php?redir=/index.html');
  }

  async login(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  async assertLoggedIn() {
    // Check for an element that only appears when logged in, e.g., logout button or user profile
    await expect(this.page).toHaveURL(/.*index.html/);
    // You might want to add more specific assertions here
  }
}
