/**
 * router.js
 * Hash-based routing (works on GitHub Pages with zero server config).
 *
 *   #/                                     -> home view (all subjects)
 *   #/sujet/<subjectId>                    -> list of specialties in that subject
 *   #/specialite/<subjectId>/<specialtyId> -> list of courses in that specialty
 *   #/<courseId>                           -> course view, Markdown fetched lazily
 *
 * This gives the requested drill-down flow: click a "Grand Sujet" -> see its
 * specialties; click a specialty -> see its courses; click a course -> read it.
 */

import { state, pushRecentCourse, getRecentCourses } from "./state.js";
import { loadCourseMarkdown } from "./dataLoader.js";
import {
  renderMarkdownToHtml,
  wrapTablesForScroll,
  lazyLoadImages,
  hardenExternalLinks,
  renderFormulas,
} from "./markdownRenderer.js";
import { highlightKeywords } from "./keywordHighlighter.js";
import { renderBreadcrumb } from "./breadcrumb.js";
import { setActiveCourseLink } from "./sidebar.js";

const homeView = document.getElementById("homeView");
const subjectView = document.getElementById("subjectView");
const specialtyView = document.getElementById("specialtyView");
const courseView = document.getElementById("courseView");
const notFoundView = document.getElementById("notFoundView");

const courseBodyEl = document.getElementById("courseBody");
const mainContentEl = document.getElementById("main-content");

const SKELETON_HTML = courseBodyEl.innerHTML; // captured once at load, for reuse

function showView(view) {
  homeView.hidden = view !== "home";
  subjectView.hidden = view !== "subject";
  specialtyView.hidden = view !== "specialty";
  courseView.hidden = view !== "course";
  notFoundView.hidden = view !== "notfound";
}

export function initRouter() {
  window.addEventListener("hashchange", handleRoute);
  handleRoute();
}

async function handleRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const segments = hash.split("/").filter(Boolean).map(decodeURIComponent);

  if (segments.length === 0) {
    state.currentCourseId = null;
    renderHomeView();
    renderBreadcrumb([{ label: "Accueil" }]);
    showView("home");
    mainContentEl.scrollTo(0, 0);
    return;
  }

  if (segments[0] === "sujet" && segments[1]) {
    renderSubjectView(segments[1]);
    return;
  }

  if (segments[0] === "specialite" && segments[1] && segments[2]) {
    renderSpecialtyView(segments[1], segments[2]);
    return;
  }

  // Otherwise treat the first segment as a course id.
  const course = state.coursesById.get(segments[0]);
  if (!course) {
    showView("notfound");
    return;
  }
  await openCourse(course);
}

/* ---------------- Subject view: list its specialties ---------------- */

function renderSubjectView(subjectId) {
  const subject = state.index?.subjects.find((s) => s.id === subjectId);
  if (!subject) {
    showView("notfound");
    return;
  }

  document.getElementById("subjectTitle").textContent = subject.title;

  const grid = document.getElementById("subjectSpecialties");
  grid.innerHTML = subject.specialties
    .map(
      (sp) => `
      <a class="subject-card" href="#/specialite/${subject.id}/${sp.id}">
        <div class="subject-card-title">${escapeHtml(sp.title)}</div>
        <div class="subject-card-meta">${sp.courses.length} cours</div>
      </a>`
    )
    .join("");

  renderBreadcrumb([{ label: "Accueil", href: "#/" }, { label: subject.title }]);
  showView("subject");
  mainContentEl.scrollTo(0, 0);
}

/* ---------------- Specialty view: list its courses ---------------- */

function renderSpecialtyView(subjectId, specialtyId) {
  const subject = state.index?.subjects.find((s) => s.id === subjectId);
  const specialty = subject?.specialties.find((sp) => sp.id === specialtyId);
  if (!subject || !specialty) {
    showView("notfound");
    return;
  }

  document.getElementById("specialtyEyebrow").textContent = subject.title;
  document.getElementById("specialtyTitle").textContent = specialty.title;

  const list = document.getElementById("specialtyCourses");
  list.innerHTML = specialty.courses
    .map(
      (c) => `
      <a class="course-list-item" href="#/${c.id}">
        <span class="course-list-item-title">${escapeHtml(c.title)}</span>
        <span class="course-list-item-arrow">→</span>
      </a>`
    )
    .join("");

  renderBreadcrumb([
    { label: "Accueil", href: "#/" },
    { label: subject.title, href: `#/sujet/${subject.id}` },
    { label: specialty.title },
  ]);
  showView("specialty");
  mainContentEl.scrollTo(0, 0);
}

/* ---------------- Course view ---------------- */

async function openCourse(course) {
  state.currentCourseId = course.id;
  courseBodyEl.innerHTML = SKELETON_HTML; // loading state while markdown fetches

  renderBreadcrumb([
    { label: "Accueil", href: "#/" },
    { label: course.subjectTitle, href: `#/sujet/${course.subjectId}` },
    { label: course.specialtyTitle, href: `#/specialite/${course.subjectId}/${course.specialtyId}` },
    { label: course.title },
  ]);
  setActiveCourseLink(course.id);
  showView("course");
  mainContentEl.scrollTo(0, 0);

  try {
    const markdown = await loadCourseMarkdown(course.id);
    const html = renderMarkdownToHtml(markdown);
    courseBodyEl.innerHTML = html;

    wrapTablesForScroll(courseBodyEl);
    lazyLoadImages(courseBodyEl);
    hardenExternalLinks(courseBodyEl);
    renderFormulas(courseBodyEl);
    highlightKeywords(courseBodyEl, course.keywords || []);

    pushRecentCourse(course.id);
  } catch (err) {
    courseBodyEl.innerHTML = `<p style="color:#e0708a">Erreur de chargement du cours : ${escapeHtml(
      err.message
    )}</p>`;
  }
}

/* ---------------- Home view ---------------- */

function renderHomeView() {
  renderHomeStats();
  renderHomeSubjects();
  renderRecent();
}

function renderHomeStats() {
  const statsEl = document.getElementById("homeStats");
  if (!state.index) return;

  let subjectCount = 0,
    specialtyCount = 0,
    courseCount = 0;
  for (const s of state.index.subjects) {
    subjectCount++;
    for (const sp of s.specialties) {
      specialtyCount++;
      courseCount += sp.courses.length;
    }
  }

  statsEl.innerHTML = `
    <div class="home-stat"><div class="home-stat-value">${courseCount}</div><div class="home-stat-label">Cours</div></div>
    <div class="home-stat"><div class="home-stat-value">${specialtyCount}</div><div class="home-stat-label">Spécialités</div></div>
    <div class="home-stat"><div class="home-stat-value">${subjectCount}</div><div class="home-stat-label">Grands sujets</div></div>
  `;
}

function renderHomeSubjects() {
  const el = document.getElementById("homeSubjects");
  if (!state.index) return;

  el.innerHTML = state.index.subjects
    .map((s) => {
      const courseCount = s.specialties.reduce((n, sp) => n + sp.courses.length, 0);
      return `
      <a class="subject-card" href="#/sujet/${s.id}">
        <div class="subject-card-title">${escapeHtml(s.title)}</div>
        <div class="subject-card-meta">${s.specialties.length} spécialités · ${courseCount} cours</div>
      </a>`;
    })
    .join("");
}

function renderRecent() {
  const section = document.getElementById("recentSection");
  const list = document.getElementById("recentList");
  const ids = getRecentCourses().filter((id) => state.coursesById.has(id));

  if (ids.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  list.innerHTML = ids
    .map((id) => {
      const c = state.coursesById.get(id);
      return `
      <a class="recent-item" href="#/${c.id}">
        <span>${escapeHtml(c.title)}</span>
        <span class="recent-item-path">${escapeHtml(c.subjectTitle)} › ${escapeHtml(c.specialtyTitle)}</span>
      </a>`;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
