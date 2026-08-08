/**
 * sidebar.js
 * Builds the collapsible hierarchical tree: Grand Sujet -> Spécialité -> Cours,
 * and handles the collapse/expand of the whole sidebar (desktop) or the
 * open/close drawer behavior (mobile).
 */

import { state, isSidebarCollapsed, setSidebarCollapsed, getSortMode, setSortMode } from "./state.js";
import { sortCourses } from "./courseSort.js";

const treeEl = document.getElementById("sidebarTree");
const appEl = document.getElementById("app");
const sidebarToggleBtn = document.getElementById("sidebarToggle");
const menuBtn = document.getElementById("menuBtn");
const backdrop = document.getElementById("sidebarBackdrop");

let expandedSpecialtyIds = new Set();

/** Render the full subject > specialty > course tree from state.index. */
export function renderSidebarTree() {
  treeEl.innerHTML = "";
  if (!state.index) return;

  for (const subject of state.index.subjects) {
    treeEl.appendChild(buildSubjectNode(subject));
  }
}

function buildSubjectNode(subject) {
  const wrap = document.createElement("div");
  wrap.className = "tree-subject";

  const btn = document.createElement("button");
  btn.className = "tree-node-btn";
  btn.setAttribute("aria-expanded", "true");
  btn.innerHTML = `${caretSvg()} <span>${escapeHtml(subject.title)}</span>`;

  const childrenWrap = document.createElement("div");
  childrenWrap.className = "tree-children open";

  for (const specialty of subject.specialties) {
    childrenWrap.appendChild(buildSpecialtyNode(specialty));
  }

  btn.addEventListener("click", () => toggleNode(btn, childrenWrap));

  wrap.appendChild(btn);
  wrap.appendChild(childrenWrap);
  return wrap;
}

function buildSpecialtyNode(specialty) {
  const wrap = document.createElement("div");
  wrap.className = "tree-specialty";

  const btn = document.createElement("button");
  const expanded = expandedSpecialtyIds.has(specialty.id);
  btn.className = "tree-node-btn";
  btn.setAttribute("aria-expanded", String(expanded));
  btn.innerHTML = `${caretSvg()} <span>${escapeHtml(specialty.title)}</span>`;

  const childrenWrap = document.createElement("div");
  childrenWrap.className = "tree-children" + (expanded ? " open" : "");

  const sortedCourses = sortCourses(specialty.courses, getSortMode());
  for (const course of sortedCourses) {
    const link = document.createElement("a");
    link.className = "tree-course-link";
    link.href = `#/${course.id}`;
    link.textContent = course.title;
    link.dataset.courseId = course.id;
    childrenWrap.appendChild(link);
  }

  btn.addEventListener("click", () => {
    const isOpen = toggleNode(btn, childrenWrap);
    if (isOpen) expandedSpecialtyIds.add(specialty.id);
    else expandedSpecialtyIds.delete(specialty.id);
  });

  wrap.appendChild(btn);
  wrap.appendChild(childrenWrap);
  return wrap;
}

function toggleNode(btn, childrenWrap) {
  const open = !childrenWrap.classList.contains("open");
  childrenWrap.classList.toggle("open", open);
  btn.setAttribute("aria-expanded", String(open));
  return open;
}

function caretSvg() {
  return `<svg class="tree-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M9 18l6-6-6-6"/></svg>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** Highlight the active course link and expand its ancestor tree nodes. */
export function setActiveCourseLink(courseId) {
  treeEl.querySelectorAll(".tree-course-link.active").forEach((el) => el.classList.remove("active"));
  const active = treeEl.querySelector(`.tree-course-link[data-course-id="${cssEscape(courseId)}"]`);
  if (!active) return;
  active.classList.add("active");

  // Expand ancestor specialty node.
  let node = active.closest(".tree-specialty");
  if (node) {
    const btn = node.querySelector(":scope > .tree-node-btn");
    const kids = node.querySelector(":scope > .tree-children");
    if (btn && kids && !kids.classList.contains("open")) {
      kids.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      const course = state.coursesById.get(courseId);
      if (course) expandedSpecialtyIds.add(course.specialtyId);
    }
  }
  active.scrollIntoView({ block: "nearest" });
}

function cssEscape(str) {
  return window.CSS && CSS.escape ? CSS.escape(str) : str.replace(/["\\]/g, "\\$&");
}

/* ---------------- Collapse / responsive drawer behavior ---------------- */

function applyDesktopCollapsedState() {
  const collapsed = isSidebarCollapsed();
  appEl.classList.toggle("sidebar-collapsed", collapsed);
  sidebarToggleBtn.setAttribute("aria-expanded", String(!collapsed));
}

export function initSidebarToggle() {
  applyDesktopCollapsedState();

  sidebarToggleBtn.addEventListener("click", () => {
    const collapsed = !appEl.classList.contains("sidebar-collapsed");
    appEl.classList.toggle("sidebar-collapsed", collapsed);
    setSidebarCollapsed(collapsed);
    sidebarToggleBtn.setAttribute("aria-expanded", String(!collapsed));
  });

  // Mobile: hamburger opens the drawer, backdrop / Escape closes it.
  menuBtn?.addEventListener("click", () => appEl.classList.add("sidebar-open"));
  backdrop.addEventListener("click", closeMobileDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMobileDrawer();
  });

  // Close the mobile drawer whenever a course link is clicked.
  treeEl.addEventListener("click", (e) => {
    if (e.target.closest(".tree-course-link")) closeMobileDrawer();
  });
}

function closeMobileDrawer() {
  appEl.classList.remove("sidebar-open");
}

/* ---------------- Course display order (A→Z / Récents) ---------------- */

export function initSortControl() {
  const buttons = document.querySelectorAll(".sort-btn");
  const applyPressedState = (mode) => {
    buttons.forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.sort === mode)));
  };

  applyPressedState(getSortMode());

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.sort;
      setSortMode(mode);
      applyPressedState(mode);
      renderSidebarTree();
      // Let router.js know it should re-render the current view (e.g. a
      // specialty's course list) with the new order. Avoids a circular
      // import between sidebar.js and router.js.
      document.dispatchEvent(new CustomEvent("medref:sortchange"));
    });
  });
}
