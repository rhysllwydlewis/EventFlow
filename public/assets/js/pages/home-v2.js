(() => {
  "use strict";

  const menuButton = document.querySelector(".v2-menu-toggle");
  const mobileMenu = document.getElementById("v2-mobile-menu");
  const categoryField = document.getElementById("home-v2-category");
  const locationField = document.getElementById("home-v2-location");
  const chipButtons = document.querySelectorAll(
    ".v2-chip-row button[data-category]",
  );
  const searchForm = document.querySelector(".v2-search");

  function closeMenu() {
    if (!menuButton || !mobileMenu) return;
    menuButton.setAttribute("aria-expanded", "false");
    mobileMenu.hidden = true;
  }

  if (menuButton && mobileMenu) {
    menuButton.addEventListener("click", () => {
      const isOpen = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!isOpen));
      mobileMenu.hidden = isOpen;
    });

    mobileMenu.addEventListener("click", (event) => {
      if (event.target instanceof HTMLAnchorElement) {
        closeMenu();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    });
  }

  chipButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (categoryField) {
        categoryField.value = button.dataset.category || "";
      }

      if (locationField && button.dataset.location) {
        locationField.value = button.dataset.location;
      }

      if (searchForm) {
        searchForm.requestSubmit();
      }
    });
  });

  if (searchForm) {
    searchForm.addEventListener("submit", () => {
      const submitButton = searchForm.querySelector('button[type="submit"]');
      if (submitButton) {
        submitButton.setAttribute("aria-busy", "true");
      }
    });
  }
})();
