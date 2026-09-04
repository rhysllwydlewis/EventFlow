'use strict';
/**
 * EventFlow — Travel fuel/mileage calculator.
 *
 * An OPTIONAL module for the premium article template. It is article-specific:
 * only a guide that ships the `[data-gp-calc]` panel needs to load it, so the
 * core template runtime stays free of any one article's subject matter. The
 * pattern is the point — a future article that needs its own interactive widget
 * gets its own module here rather than growing `guide-premium.ts`.
 *
 * Progressive enhancement only: with this file blocked the panel still renders
 * and reads as a worked example with its default figures.
 *
 * Source of truth is `src/guides/guide-travel-calculator.ts`; the browser file
 * at `public/assets/js/pages/guide-travel-calculator.js` is compiled via
 * `npm run build:guides`.
 */
(() => {
  const panel = document.querySelector('[data-gp-calc]');
  if (!panel) {
    return;
  }
  const milesEl = panel.querySelector('#gp-calc-miles');
  const mpgEl = panel.querySelector('#gp-calc-mpg');
  const priceEl = panel.querySelector('#gp-calc-price');
  if (!milesEl || !mpgEl || !priceEl) {
    return;
  }
  const LITRES_PER_GALLON = 4.54609;
  // HMRC approved mileage allowance for an employee's first 10,000 car/van
  // business miles in the 2026/27 tax year, effective 6 April 2026.
  const HMRC_RATE_PER_MILE = 0.55;
  const money = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  /** Round to `places` decimals without float drift showing up in the UI. */
  function round(value, places = 2) {
    const factor = 10 ** places;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }
  const inputs = [milesEl, mpgEl, priceEl];
  const out = {
    headline: panel.querySelector('[data-gp-out="fuel"]'),
    perMile: panel.querySelector('[data-gp-out="per-mile"]'),
    fuelAmount: panel.querySelector('[data-gp-out="fuel-amount"]'),
    hmrcAmount: panel.querySelector('[data-gp-out="hmrc-amount"]'),
    fuelBar: panel.querySelector('[data-gp-bar="fuel"]'),
    hmrcBar: panel.querySelector('[data-gp-bar="hmrc"]'),
    verdict: panel.querySelector('[data-gp-out="verdict"]'),
  };
  const readValues = () => ({
    miles: Number(milesEl.value),
    mpg: Number(mpgEl.value),
    pencePerLitre: Number(priceEl.value),
  });
  /** Paint the filled portion of a range track and its readout chip. */
  const paintRange = input => {
    const min = Number(input.min);
    const max = Number(input.max);
    const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--gp-range-fill', `${round(pct, 2)}%`);
    const readout = panel.querySelector(`[data-gp-readout="${input.id}"]`);
    if (readout) {
      const decimals = Number(input.dataset.gpDecimals ?? 0);
      readout.textContent = `${Number(input.value).toFixed(decimals)}${input.dataset.gpUnit ?? ''}`;
    }
  };
  const update = () => {
    const { miles, mpg, pencePerLitre } = readValues();
    inputs.forEach(paintRange);
    const gallons = miles / mpg;
    const fuelCost = gallons * LITRES_PER_GALLON * (pencePerLitre / 100);
    const perMilePence = miles > 0 ? (fuelCost / miles) * 100 : 0;
    const hmrcCost = miles * HMRC_RATE_PER_MILE;
    const peak = Math.max(fuelCost, hmrcCost, 0.01);
    if (out.headline) {
      out.headline.textContent = money.format(fuelCost);
    }
    if (out.perMile) {
      out.perMile.textContent = `${perMilePence.toFixed(1)}p per mile in fuel · ${miles} mile round trip`;
    }
    if (out.fuelAmount) {
      out.fuelAmount.textContent = money.format(fuelCost);
    }
    if (out.hmrcAmount) {
      out.hmrcAmount.textContent = money.format(hmrcCost);
    }
    if (out.fuelBar) {
      out.fuelBar.style.setProperty('--gp-bar-w', `${round((fuelCost / peak) * 100, 2)}%`);
    }
    if (out.hmrcBar) {
      out.hmrcBar.style.setProperty('--gp-bar-w', `${round((hmrcCost / peak) * 100, 2)}%`);
    }
    if (out.verdict) {
      const gap = hmrcCost - fuelCost;
      out.verdict.innerHTML =
        gap >= 0
          ? `Reimbursing at 55p leaves <strong>${money.format(gap)}</strong> above estimated fuel on this trip — the approved mileage rate is intended to recognise wider vehicle costs as well as fuel.`
          : `At this price and economy the estimated fuel alone costs <strong>${money.format(Math.abs(gap))}</strong> more than a 55p reimbursement would return. Budget the real fuel figure rather than assuming the approved employee rate covers the journey.`;
    }
  };
  inputs.forEach(input => {
    input.addEventListener('input', update);
    input.addEventListener('change', update);
  });
  update();
})();
