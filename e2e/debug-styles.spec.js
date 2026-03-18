const { test } = require('@playwright/test');

test('verify ef-stats-grid layout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  
  const result = await page.evaluate(() => {
    const grid = document.querySelector('.ef-stats-grid');
    const cs = window.getComputedStyle(grid);
    return {
      display: cs.display,
      gridTemplateColumns: cs.gridTemplateColumns,
    };
  });
  console.log('Desktop:', JSON.stringify(result));
  
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(100);
  
  const resultMobile = await page.evaluate(() => {
    const grid = document.querySelector('.ef-stats-grid');
    const cs = window.getComputedStyle(grid);
    const numEl = document.querySelector('.ef-stat__number');
    const labelEl = document.querySelector('.ef-stat__label');
    return {
      display: cs.display,
      gridTemplateColumns: cs.gridTemplateColumns,
      numberFontSize: window.getComputedStyle(numEl).fontSize,
      labelFontSize: window.getComputedStyle(labelEl).fontSize,
    };
  });
  console.log('Mobile:', JSON.stringify(resultMobile));
});
