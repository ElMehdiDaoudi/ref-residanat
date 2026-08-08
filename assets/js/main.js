/**
 * main.js
 * Application bootstrap: loads the index, wires up the sidebar, search,
 * theme toggle, and starts the router. This is the only script referenced
 * from index.html (type="module"), everything else is imported from here.
 */

import { getTheme, setTheme } from "./state.js";
import { loadIndex } from "./dataLoader.js";
import { renderSidebarTree, initSidebarToggle, initSortControl } from "./sidebar.js";
import { buildSearchCorpus, initSearch } from "./search.js";
import { initRouter } from "./router.js";

function initTheme() {
  const theme = getTheme();
  setTheme(theme);
  updateThemeLabel(theme);

  document.getElementById("themeToggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    setTheme(next);
    updateThemeLabel(next);
  });
}

function updateThemeLabel(theme) {
  const label = document.getElementById("themeLabel");
  label.textContent = theme === "dark" ? "Mode clair" : "Mode sombre";
}

async function bootstrap() {
  initTheme();
  initSidebarToggle();
  initSortControl();
  initSearch();

  try {
    await loadIndex();
  } catch (err) {
    document.getElementById("homeSubjects").innerHTML = `
      <p style="color:#e0708a">Erreur de chargement de content/database.html : ${err.message}</p>`;
    return;
  }

  renderSidebarTree();
  buildSearchCorpus();
  initRouter();
}

bootstrap();
