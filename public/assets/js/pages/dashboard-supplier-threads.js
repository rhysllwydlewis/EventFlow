document.addEventListener('DOMContentLoaded', () => {
  // Helper to hide skeleton loaders inside the threads-sup section
  function clearThreadsSupSkeleton() {
    const threadsSup = document.getElementById('threads-sup');
    if (threadsSup) {
      threadsSup.querySelectorAll('.skeleton').forEach(el => {
        el.style.display = 'none';
      });
    }
  }

  // Add a safety timeout to clear the threads-sup skeleton loader
  // in case the MessengerWidgetV4 fails to render or is slow
  const skeletonTimeout = setTimeout(clearThreadsSupSkeleton, 10000);

  if (typeof MessengerWidgetV4 !== 'undefined') {
    new MessengerWidgetV4('messenger-dashboard-widget-supplier', {
      maxItems: 5,
      // onRendered(allConversations, filteredConversations) – called after each render
      onRendered: function (allConversations, _filteredConversations) {
        // Clear the threads-sup skeleton loader now that the widget has rendered
        clearTimeout(skeletonTimeout);
        clearThreadsSupSkeleton();

        // Update the lead quality summary stats block
        const statsEl = document.getElementById('lead-quality-summary-stats');
        if (!statsEl || !allConversations || allConversations.length === 0) {
          return;
        }

        let high = 0,
          medium = 0,
          low = 0;
        allConversations.forEach(conv => {
          const score = conv.leadScore;
          const raw = conv.leadScoreRaw;
          let label = score;
          if (!label && typeof raw === 'number') {
            if (raw >= 80) {
              label = 'Hot';
            } else if (raw >= 60) {
              label = 'High';
            } else if (raw >= 40) {
              label = 'Good';
            } else {
              label = 'Low';
            }
          }
          if (label === 'High' || label === 'Hot') {
            high++;
          } else if (label === 'Medium' || label === 'Good') {
            medium++;
          } else if (label === 'Low') {
            low++;
          }
        });

        const total = allConversations.length;
        const hasQuality = high + medium + low > 0;
        if (!hasQuality) {
          return;
        }

        const highPct = total > 0 ? Math.round((high / total) * 100) : 0;
        statsEl.style.display = 'block';
        const highText = document.getElementById('lqs-high-text');
        const medText = document.getElementById('lqs-medium-text');
        const lowText = document.getElementById('lqs-low-text');
        const pctText = document.getElementById('lqs-pct');
        if (highText) {
          highText.textContent = `${high} High`;
        }
        if (medText) {
          medText.textContent = `${medium} Medium`;
        }
        if (lowText) {
          lowText.textContent = `${low} Low`;
        }
        if (pctText) {
          pctText.textContent = `${highPct}% high-quality leads`;
        }
      },
    });
  } else {
    // MessengerWidgetV4 not available — clear the skeleton immediately
    clearTimeout(skeletonTimeout);
    clearThreadsSupSkeleton();
  }
});
