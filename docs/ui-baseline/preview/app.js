const body = document.body;
const modalShell = document.getElementById("modalShell");
const themeToggle = document.getElementById("themeToggle");
const headerLogo = document.getElementById("brandHeaderLogo");
const footerLogo = document.getElementById("brandFooterLogo");
const mobileMenuButton = document.getElementById("mobileMenuButton");
const mobileNav = document.getElementById("mobileNav");
const dropdownToggle = document.getElementById("dropdownToggle");
const dropdownPanel = document.getElementById("dropdownPanel");

function closeModal() {
  modalShell.hidden = true;
}

function openModal() {
  modalShell.hidden = false;
}

function updateTheme(isDark) {
  body.classList.toggle("theme-dark", isDark);
  themeToggle.textContent = isDark ? "Modo light" : "Modo dark";
}

document.getElementById("openModalButton").addEventListener("click", openModal);
document.getElementById("closeModalButton").addEventListener("click", closeModal);
document.getElementById("cancelModalButton").addEventListener("click", closeModal);
document.getElementById("confirmModalButton").addEventListener("click", closeModal);

themeToggle.addEventListener("click", () => {
  const nextIsDark = !body.classList.contains("theme-dark");
  updateTheme(nextIsDark);
});

mobileMenuButton.addEventListener("click", () => {
  mobileNav.classList.toggle("is-open");
});

dropdownPanel.hidden = true;
dropdownToggle.addEventListener("click", () => {
  dropdownPanel.hidden = !dropdownPanel.hidden;
});

window.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (!target.closest(".dropdown-sim")) {
    dropdownPanel.hidden = true;
  }
});
