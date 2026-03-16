// Countdown timer
let totalSeconds = 9000; // 2.5 hours

function updateCountdown() {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  document.getElementById('hours').textContent = hours.toString().padStart(2, '0');
  document.getElementById('minutes').textContent = minutes.toString().padStart(2, '0');
  document.getElementById('seconds').textContent = seconds.toString().padStart(2, '0');

  if (totalSeconds > 0) {
    totalSeconds--;
  } else {
    totalSeconds = 9000; // Reset
  }
}

setInterval(updateCountdown, 1000);
updateCountdown();

// Fetch custom message
fetch('/api/maintenance/message')
  .then(res => res.json())
  .then(data => {
    if (data.message) {
      document.getElementById('custom-message').innerHTML =
        `${data.message} <strong>EventFlow</strong> experience.`;
    }
  })
  .catch(() => {
    // Keep default message
  });

// Keyboard shortcut for admin access
const keys = [];
document.addEventListener('keydown', e => {
  keys.push(e.key);
  if (keys.length > 3) {
    keys.shift();
  }

  if (e.ctrlKey && e.shiftKey && e.key === 'A') {
    e.preventDefault();
    window.location.href = '/auth';
  }

  if (keys.join('').toLowerCase().includes('admin')) {
    document.body.classList.add('show-hint');
    setTimeout(() => {
      document.body.classList.remove('show-hint');
    }, 3000);
  }
});
