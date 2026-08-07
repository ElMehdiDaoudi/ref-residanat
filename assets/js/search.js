/**
 * search.js
 * Instant search across title, keywords, and content — all served from the
 * lightweight content/database.html (never fetches Markdown files), so it
 * stays fast even with 10 000+ courses.
 */

import { state } from "./state.js";

const input = document.getElementById("searchInput");
const resultsEl = document.getElementById("searchResults");

const MAX_RESULTS = 25;

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip accents for forgiving matching
}

/** Build a flat searchable array once the index is loaded. */
let searchCorpus = [];

export function buildSearchCorpus() {
  searchCorpus = [];
  if (!state.index) return;
  for (const subject of state.index.subjects) {
    for (const specialty of subject.specialties) {
      for (const course of specialty.courses) {
        searchCorpus.push({
          id: course.id,
          title: course.title,
          subjectTitle: subject.title,
          specialtyTitle: specialty.title,
          normTitle: normalize(course.title),
          normKeywords: normalize((course.keywords || []).join(" ")),
          normBlob: normalize(course.search_blob || ""),
        });
      }
    }
  }
}

function search(query) {
  const q = normalize(query.trim());
  if (!q) return [];

  const results = [];
  for (const item of searchCorpus) {
    let score = 0;
    if (item.normTitle.includes(q)) score += item.normTitle.startsWith(q) ? 100 : 60;
    if (item.normKeywords.includes(q)) score += 30;
    if (item.normBlob.includes(q)) score += 10;
    if (score > 0) results.push({ ...item, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, MAX_RESULTS);
}

function highlightMatch(title, query) {
  const idx = normalize(title).indexOf(normalize(query));
  if (idx === -1) return escapeHtml(title);
  const before = title.slice(0, idx);
  const match = title.slice(idx, idx + query.length);
  const after = title.slice(idx + query.length);
  return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderResults(query, results) {
  if (results.length === 0) {
    resultsEl.innerHTML = `<div class="search-result-empty">Aucun résultat pour « ${escapeHtml(query)} »</div>`;
    resultsEl.hidden = false;
    return;
  }

  resultsEl.innerHTML = results
    .map(
      (r) => `
      <a class="search-result-item" href="#/${r.id}" data-course-id="${r.id}">
        <div class="search-result-title">${highlightMatch(r.title, query)}</div>
        <div class="search-result-path">${escapeHtml(r.subjectTitle)} › ${escapeHtml(r.specialtyTitle)}</div>
      </a>`
    )
    .join("");
  resultsEl.hidden = false;
}

export function initSearch() {
  input.addEventListener("input", () => {
    const q = input.value;
    if (!q.trim()) {
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
      return;
    }
    renderResults(q, search(q));
  });

  resultsEl.addEventListener("click", (e) => {
    if (e.target.closest(".search-result-item")) {
      resultsEl.hidden = true;
      input.value = "";
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".sidebar-search") && !e.target.closest(".search-results")) {
      resultsEl.hidden = true;
    }
  });

  // "/" focuses search from anywhere, unless typing in a field already.
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      input.focus();
    }
    if (e.key === "Escape" && document.activeElement === input) {
      input.value = "";
      resultsEl.hidden = true;
      input.blur();
    }
  });
}
