const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  try {
    console.log('Navigating to login page...');
    await page.goto('https://event.thaiticketmajor.com/user/signin.php?redir=/index.html', { waitUntil: 'networkidle' });
    
    const title = await page.title();
    console.log('Page Title:', title);
    
    const content = await page.content();
    console.log('Page Content Length:', content.length);
    
    // Look for common login selectors
    const inputs = await page.$$eval('input', el => el.map(i => ({
      type: i.type,
      name: i.name,
      id: i.id,
      placeholder: i.placeholder,
      className: i.className
    })));
    console.log('Input fields found:', JSON.stringify(inputs, null, 2));
    
    const buttons = await page.$$eval('button, input[type="submit"]', el => el.map(b => ({
      text: b.innerText || b.value,
      type: b.type,
      id: b.id,
      className: b.className
    })));
    console.log('Buttons found:', JSON.stringify(buttons, null, 2));

  } catch (error) {
    console.error('Error during inspection:', error);
  } finally {
    await browser.close();
  }
})();
