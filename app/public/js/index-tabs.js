// Page-level tab switching for the home page (Game Stats / Opening Books).
// Scoped to elements inside .full-panel > .tabs so it never touches the
// static per-account .tabs labels rendered inside each .card.
document.addEventListener('DOMContentLoaded', function () {
  const tabBar = document.querySelector('.full-panel > .tabs');
  if (!tabBar) {
    return;
  }

  const tabs = tabBar.querySelectorAll('.tab[data-tab-target]');

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      const targetId = tab.getAttribute('data-tab-target');
      const targetPanel = document.getElementById(targetId);
      if (!targetPanel) {
        return;
      }

      tabs.forEach(function (otherTab) {
        otherTab.classList.remove('active');
      });
      document.querySelectorAll('.full-panel > .tab-panel').forEach(function (panel) {
        panel.classList.add('hidden');
      });

      tab.classList.add('active');
      targetPanel.classList.remove('hidden');
    });
  });
});
