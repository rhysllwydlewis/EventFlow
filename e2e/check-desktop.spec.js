const { test } = require('@playwright/test');

test('count all rules in components.css', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(() => {
    // Find components.css
    for (const sheet of document.styleSheets) {
      if (sheet.href && sheet.href.includes('components.css')) {
        const rules = [];
        for (let i = 0; i < sheet.cssRules.length; i++) {
          const r = sheet.cssRules[i];
          rules.push(
            r.cssText ? r.cssText.substring(0, 60).replace(/\s+/g, ' ') : r.constructor.name
          );
        }
        return { count: sheet.cssRules.length, lastFew: rules.slice(-10) };
      }
    }
    return { error: 'not found' };
  });
  console.log('Total rules:', result.count);
  console.log('Last 10 rules:');
  for (const r of result.lastFew || []) console.log(' -', r);
});
