/**
 * courseSort.js
 * Shared sorting logic for course lists (sidebar tree, specialty view).
 * Two modes: "alpha" (A→Z, accent-insensitive) and "recent" (most
 * recently added course first, based on the "added_at" timestamp that
 * generate_site.py stamps on each course — preserved across content
 * updates, only set once when a course is first added).
 */

function normalizeForSort(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * @param {object[]} courses
 * @param {"alpha"|"recent"} mode
 * @returns {object[]} a new sorted array (input is not mutated)
 */
export function sortCourses(courses, mode) {
  const list = [...courses];
  if (mode === "recent") {
    list.sort((a, b) => new Date(b.added_at || 0) - new Date(a.added_at || 0));
  } else {
    list.sort((a, b) => normalizeForSort(a.title).localeCompare(normalizeForSort(b.title)));
  }
  return list;
}
