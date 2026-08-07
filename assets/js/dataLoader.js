/**
 * dataLoader.js
 * All network/fetch access lives here.
 *
 * Design for scale (10 000+ courses):
 *  - content/database.html is fetched ONCE at startup. It's the persistent
 *    HTML "database" maintained by generate_site.py: an embedded JSON
 *    payload (<script type="application/json" id="courses-db">) holding
 *    lightweight metadata per course (title, slug, path, keywords, a
 *    short search excerpt) — never the full Markdown body.
 *  - The Markdown body of a course is fetched lazily, only when that
 *    course is actually opened, and then cached in memory so revisiting
 *    it during the session is instant.
 */

import { state } from "./state.js";

const markdownCache = new Map();
const DATABASE_URL = "content/database.html";
const DB_SCRIPT_ID = "courses-db";

/** Fetch content/database.html, extract its embedded JSON, and build the coursesById lookup map. */
export async function loadIndex() {
  const res = await fetch(DATABASE_URL, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Impossible de charger ${DATABASE_URL} (${res.status})`);
  const html = await res.text();

  const doc = new DOMParser().parseFromString(html, "text/html");
  const script = doc.getElementById(DB_SCRIPT_ID);
  if (!script) {
    throw new Error(
      `${DATABASE_URL} ne contient pas le bloc de données attendu (id="${DB_SCRIPT_ID}"). ` +
        `Avez-vous bien lancé generate_site.py ?`
    );
  }

  let data;
  try {
    data = JSON.parse(script.textContent);
  } catch (e) {
    throw new Error(`Données invalides dans ${DATABASE_URL} : ${e.message}`);
  }

  state.index = data;

  state.coursesById.clear();
  for (const subject of data.subjects) {
    for (const specialty of subject.specialties) {
      for (const course of specialty.courses) {
        state.coursesById.set(course.id, {
          ...course,
          subjectId: subject.id,
          subjectTitle: subject.title,
          specialtyId: specialty.id,
          specialtyTitle: specialty.title,
        });
      }
    }
  }
  return data;
}

/** Fetch (and cache) the raw Markdown source for one course, by its id. */
export async function loadCourseMarkdown(courseId) {
  if (markdownCache.has(courseId)) return markdownCache.get(courseId);

  const course = state.coursesById.get(courseId);
  if (!course) throw new Error(`Cours inconnu: ${courseId}`);

  const res = await fetch(course.path);
  if (!res.ok) throw new Error(`Impossible de charger ${course.path} (${res.status})`);
  const text = await res.text();
  markdownCache.set(courseId, text);
  return text;
}
