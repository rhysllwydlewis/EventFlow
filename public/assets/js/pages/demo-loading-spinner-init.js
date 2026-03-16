const spinner1 = new LoadingSpinner();
const spinner2 = new LoadingSpinner({ size: 'small' });
const spinner3 = new LoadingSpinner({ size: 'large' });

function demo1() {
  spinner1.show(document.getElementById('demo1'), 'Loading data...');
}

function hide1() {
  spinner1.hide(document.getElementById('demo1'));
}

function demo2() {
  spinner2.show(document.getElementById('demo2'), 'Processing your request...');
}

function hide2() {
  spinner2.hide(document.getElementById('demo2'));
}

function demo3() {
  spinner3.show(document.getElementById('demo3'), 'Uploading files...');
}

function hide3() {
  spinner3.hide(document.getElementById('demo3'));
}

function demo4() {
  window.loading.showFullPage('Loading application...');
  setTimeout(() => {
    window.loading.hideFullPage();
  }, 3000);
}

console.log('✅ LoadingSpinner demo loaded');
console.log('Available instances:', {
  spinner1: 'medium',
  spinner2: 'small',
  spinner3: 'large',
  globalInstance: 'window.loading',
});

// Bind button event listeners
document.addEventListener('DOMContentLoaded', () => {
  const btnBindings = [
    ['Show Medium Spinner', demo1],
    ['Hide Spinner', hide1],
    ['Show Small Spinner', demo2],
    ['Show Large Spinner', demo3],
    ['Show Full Page Spinner (3 seconds)', demo4],
  ];

  // Bind each button by finding pairs
  const allButtons = Array.from(document.querySelectorAll('button'));
  allButtons.forEach(btn => {
    const label = btn.textContent.trim();
    for (const [text, fn] of btnBindings) {
      if (label === text) {
        btn.addEventListener('click', fn);
        break;
      }
    }
  });

  // Bind hide buttons individually since they have identical text
  // Find hide buttons by their sibling context
  document.querySelectorAll('button').forEach(btn => {
    if (btn.textContent.trim() === 'Hide Spinner') {
      const section = btn.closest('div') || btn.parentElement;
      const prev = btn.previousElementSibling;
      if (prev && prev.textContent.includes('Small')) {
        btn.addEventListener('click', hide2);
      } else if (prev && prev.textContent.includes('Large')) {
        btn.addEventListener('click', hide3);
      }
    }
  });
});
