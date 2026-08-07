/**
 * state.js
 * Small centralized state holder. No framework — just an object plus
 * a few localStorage-backed helpers (theme, sidebar collapsed, history).
 */

const LS_KEYS = {
  theme: "medref:theme",
  sidebarCollapsed: "medref:sidebarCollapsed",
  recent: "medref:recentCourses",
};

export const state = {
  /** Full database.json-equivalent (parsed from content/database.html), loaded once at startup. */
  index: null,
  /** Flat map slug(full path id) -> course object, built from index. */
  coursesById: new Map(),
  /** Currently open course id, or null on the home view. */
  currentCourseId: null,
};

export function getTheme() {
  return localStorage.getItem(LS_KEYS.theme) || "dark";
}

export function setTheme(theme) {
  localStorage.setItem(LS_KEYS.theme, theme);
  document.documentElement.setAttribute("data-theme", theme);
}

export function isSidebarCollapsed() {
  return localStorage.getItem(LS_KEYS.sidebarCollapsed) === "1";
}

export function setSidebarCollapsed(collapsed) {
  localStorage.setItem(LS_KEYS.sidebarCollapsed, collapsed ? "1" : "0");
}

/** Record a course as "recently viewed" (most recent first, max 8). */
export function pushRecentCourse(courseId) {
  let list = getRecentCourses();
  list = list.filter((id) => id !== courseId);
  list.unshift(courseId);
  list = list.slice(0, 8);
  localStorage.setItem(LS_KEYS.recent, JSON.stringify(list));
}

export function getRecentCourses() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEYS.recent)) || [];
  } catch {
    return [];
  }
}

/** The very last course opened — used to restore state on next visit. */
export function getLastCourseId() {
  const list = getRecentCourses();
  return list.length ? list[0] : null;
}
