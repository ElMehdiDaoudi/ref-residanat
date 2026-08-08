#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_site.py
=================

Maintains a persistent HTML "database" (content/database.html) of every
course on the site, and incrementally MERGES new courses into it.

  - content/database.html   -> the persistent store (all courses' metadata:
                                 title, keywords, path, search excerpt).
                                 This file IS the database; it survives
                                 across runs and is rewritten (merged, not
                                 replaced) every time you add courses.
  - content/markdown/...    -> one .md file per course (the full content).

Each JSON input file you pass via --input is only a VECTOR used to ADD or
UPDATE courses in the database — it is not itself the source of truth and
does not need to be kept around afterwards. Run the script again with a
new JSON file (or folder of files) and it merges into the existing
database.html instead of starting over.

--------------------------------------------------------------------------
INPUT FORMAT (the "vector" of new/updated courses)
--------------------------------------------------------------------------

--input can point to EITHER:

  1. A single JSON file containing an array of course objects, OR
  2. A directory containing one .json file PER COURSE (recommended when an
     AI agent extracts courses one at a time). All *.json files found
     recursively are read. Each file holds either one course object or an
     array of course objects.

Each course object has these required keys:

    titre_cours   (string)  -> becomes the course title and the H1 heading
    grand_sujet   (string)  -> top-level subject, e.g. "Médecine"
    specialite    (string)  -> specialty, e.g. "Cardiologie"
    mots_cles     (array of strings) -> terms to auto-highlight
    texte_cours   (string, Markdown) -> the course body (no H1 in it)

--------------------------------------------------------------------------
MERGE BEHAVIOR
--------------------------------------------------------------------------

  - A course whose (Grand Sujet, Spécialité, Titre) already exists in
    content/database.html is UPDATED in place (its Markdown file and its
    database entry are overwritten with the new content).
  - A course with a new (Grand Sujet, Spécialité, Titre) combination is
    ADDED alongside the existing ones.
  - Courses already in the database that are NOT present in this run's
    JSON vector are left untouched (their .md file is not re-read or
    rewritten).
  - Use --reset-database to ignore any existing database.html and rebuild
    the database from scratch using only this run's input.

Usage:

    python generate_site.py --input source/          # merge a batch of new courses
    python generate_site.py --input un_cours.json     # merge a single course
    python generate_site.py --input data.json --reset-database

Works identically on Windows and Linux (pure stdlib, pathlib-based paths).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path
from datetime import datetime, timezone

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

REQUIRED_KEYS = ["titre_cours", "grand_sujet", "specialite", "mots_cles", "texte_cours"]

DATABASE_FILENAME = "database.html"
MANIFEST_FILENAME = ".generate_manifest.json"  # tracks content hashes between runs

DB_SCRIPT_ID = "courses-db"
DB_JSON_RE = re.compile(
    r'<script[^>]*id=["\']' + re.escape(DB_SCRIPT_ID) + r'["\'][^>]*>(.*?)</script>',
    re.DOTALL,
)

MD_STRIP_RE = re.compile(
    r"```.*?```"              # fenced code blocks
    r"|`[^`]*`"                 # inline code
    r"|!\[[^\]]*\]\([^)]*\)"     # images
    r"|\[[^\]]*\]\([^)]*\)"      # links -> keep text below instead
    , re.DOTALL,
)
MD_HEADER_RE = re.compile(r"^#{1,6}\s*", re.MULTILINE)
MD_EMPHASIS_RE = re.compile(r"(\*\*|\*|__|_|~~)")
MD_TABLE_PIPE_RE = re.compile(r"\|")
MD_QUOTE_RE = re.compile(r"^>\s?", re.MULTILINE)
WHITESPACE_RE = re.compile(r"\s+")

SEARCH_BLOB_MAX_CHARS = 3000


# --------------------------------------------------------------------------
# Slug / text helpers
# --------------------------------------------------------------------------

def slugify(text: str) -> str:
    """
    Convert arbitrary (accented, punctuated) text into a URL/filesystem-safe
    slug: lowercase, ASCII, hyphen-separated, no forbidden characters.
    Works identically on Windows and Linux since it never emits characters
    forbidden on either platform (\\ / : * ? " < > |).
    """
    if not text:
        return "sans-titre"
    normalized = unicodedata.normalize("NFKD", text)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_text = ascii_text.lower()
    ascii_text = re.sub(r"[^a-z0-9]+", "-", ascii_text)
    ascii_text = re.sub(r"-{2,}", "-", ascii_text).strip("-")
    return ascii_text or "sans-titre"


def sort_key(text: str) -> str:
    """Accent-insensitive sort key, used to order subjects/specialties/courses alphabetically."""
    normalized = unicodedata.normalize("NFKD", text or "")
    return normalized.encode("ascii", "ignore").decode("ascii").lower()


def normalize_keywords(raw) -> list[str]:
    """
    Accepts "mots_cles" as a list of strings (expected) but also tolerates
    a single delimited string as a fallback, so a slightly non-conforming
    agent output doesn't hard-fail the whole run.
    """
    if raw is None:
        return []
    if isinstance(raw, str):
        parts = re.split(r"[;,|]", raw)
    elif isinstance(raw, list):
        parts = [str(p) for p in raw]
    else:
        return []

    parts = [p.strip() for p in parts if str(p).strip()]
    seen_lower = set()
    unique = []
    for p in parts:
        low = p.lower()
        if low not in seen_lower:
            seen_lower.add(low)
            unique.append(p)
    unique.sort(key=len, reverse=True)  # compound expressions take priority
    return unique


def strip_markdown_to_text(markdown_text: str) -> str:
    """Produce a plain-text excerpt from Markdown, for the search index (search_blob)."""
    text = MD_STRIP_RE.sub(" ", markdown_text)
    text = MD_HEADER_RE.sub("", text)
    text = MD_EMPHASIS_RE.sub("", text)
    text = MD_QUOTE_RE.sub("", text)
    text = MD_TABLE_PIPE_RE.sub(" ", text)
    text = WHITESPACE_RE.sub(" ", text).strip()
    return text[:SEARCH_BLOB_MAX_CHARS]


def content_hash(*parts: str) -> str:
    h = hashlib.md5()
    for p in parts:
        h.update(p.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


# --------------------------------------------------------------------------
# Progress bar (stdlib only, cross-platform)
# --------------------------------------------------------------------------

def print_progress(done: int, total: int, label: str = "") -> None:
    total = max(total, 1)
    width = 30
    filled = int(width * done / total)
    bar = "#" * filled + "-" * (width - filled)
    pct = 100 * done / total
    sys.stdout.write(f"\r[{bar}] {done}/{total} ({pct:5.1f}%) {label[:40]:<40}")
    sys.stdout.flush()
    if done >= total:
        sys.stdout.write("\n")


# --------------------------------------------------------------------------
# Input loading (single JSON file OR a directory of JSON files) — the "vector"
# --------------------------------------------------------------------------

def read_courses(input_path: Path) -> tuple[list[dict], list[str]]:
    """Returns (raw_course_dicts, warnings) from the --input vector."""
    warnings: list[str] = []
    raw_courses: list[dict] = []

    if input_path.is_dir():
        json_files = sorted(input_path.rglob("*.json"))
        if not json_files:
            raise SystemExit(f"Aucun fichier .json trouvé dans le dossier : {input_path}")
        for jf in json_files:
            try:
                data = json.loads(jf.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                warnings.append(f"{jf}: JSON invalide, fichier ignoré ({e})")
                continue
            items = data if isinstance(data, list) else [data]
            for item in items:
                if not isinstance(item, dict):
                    warnings.append(f"{jf}: élément ignoré (pas un objet JSON)")
                    continue
                item["_source_file"] = str(jf)
                raw_courses.append(item)
    else:
        try:
            data = json.loads(input_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise SystemExit(f"JSON invalide dans {input_path} : {e}")
        items = data if isinstance(data, list) else [data]
        for item in items:
            if isinstance(item, dict):
                item["_source_file"] = str(input_path)
                raw_courses.append(item)
            else:
                warnings.append(f"{input_path}: élément ignoré (pas un objet JSON)")

    return raw_courses, warnings


# --------------------------------------------------------------------------
# Working structure: subjects[slug] = {title, specialties: {slug: {title, courses: {id: {...}}}}}
# --------------------------------------------------------------------------

def build_course_entries(raw_courses: list[dict]) -> tuple[dict, list[str]]:
    """Turn raw course dicts (from the JSON vector) into the working structure."""
    subjects: dict = {}
    warnings: list[str] = []
    seen_course_keys: set[tuple[str, str, str]] = set()

    for raw in raw_courses:
        source = raw.get("_source_file", "?")
        missing = [k for k in REQUIRED_KEYS if not raw.get(k)]
        if missing:
            warnings.append(f"{source}: champs manquants {missing}, cours ignoré.")
            continue

        title = str(raw["titre_cours"]).strip()
        subject_title = str(raw["grand_sujet"]).strip()
        specialty_title = str(raw["specialite"]).strip()
        keywords = normalize_keywords(raw.get("mots_cles"))
        body = str(raw["texte_cours"]).strip()

        subject_slug = slugify(subject_title)
        specialty_slug = slugify(specialty_title)
        course_slug = slugify(title)

        # Duplicates WITHIN this same input batch get renamed (-2, -3, ...).
        # A course matching one already in the persistent database is NOT a
        # duplicate here — it's an intentional update, handled by the merge step.
        key = (subject_slug, specialty_slug, course_slug)
        if key in seen_course_keys:
            n = 2
            while (subject_slug, specialty_slug, f"{course_slug}-{n}") in seen_course_keys:
                n += 1
            new_slug = f"{course_slug}-{n}"
            warnings.append(
                f"Doublon détecté pour « {title} » ({subject_title} / {specialty_title}) "
                f"[{source}]; renommé en « {new_slug} »."
            )
            course_slug = new_slug
        seen_course_keys.add((subject_slug, specialty_slug, course_slug))

        subjects.setdefault(subject_slug, {"title": subject_title, "specialties": {}})
        specialties = subjects[subject_slug]["specialties"]
        specialties.setdefault(specialty_slug, {"title": specialty_title, "courses": {}})
        specialties[specialty_slug]["courses"][course_slug] = {
            "id": course_slug,
            "title": title,
            "keywords": keywords,
            "body": body,
        }

    return subjects, warnings


def write_markdown_files(subjects: dict, content_dir: Path, manifest: dict, force: bool) -> tuple[dict, dict]:
    """
    Write one .md file per course from THIS RUN's batch only (skipping
    unchanged ones unless --force). Mutates each course dict in place to
    add "path" and "search_blob". Returns (updated_manifest_entries, stats).
    """
    markdown_dir = content_dir / "markdown"
    updated_manifest_entries: dict = {}
    stats = {"written": 0, "skipped": 0, "total": 0}

    all_courses = [
        (subject_slug, specialty_slug, course)
        for subject_slug, subject in subjects.items()
        for specialty_slug, specialty in subject["specialties"].items()
        for course in specialty["courses"].values()
    ]
    stats["total"] = len(all_courses)

    for i, (subject_slug, specialty_slug, course) in enumerate(all_courses, start=1):
        course_dir = markdown_dir / subject_slug / specialty_slug
        course_dir.mkdir(parents=True, exist_ok=True)
        file_path = course_dir / f"{course['id']}.md"

        markdown_text = f"# {course['title']}\n\n{course['body']}\n"
        keywords_str = "|".join(course["keywords"])
        manifest_key = f"{subject_slug}/{specialty_slug}/{course['id']}"
        h = content_hash(course["title"], keywords_str, course["body"])
        updated_manifest_entries[manifest_key] = h

        needs_write = force or manifest.get(manifest_key) != h or not file_path.exists()
        if needs_write:
            file_path.write_text(markdown_text, encoding="utf-8")
            stats["written"] += 1
        else:
            stats["skipped"] += 1

        course["path"] = str(file_path.relative_to(content_dir.parent)).replace("\\", "/")
        course["search_blob"] = strip_markdown_to_text(course["body"])

        print_progress(i, stats["total"], label=course["title"])

    return updated_manifest_entries, stats


# --------------------------------------------------------------------------
# content/database.html : persistent store, read + write + merge
# --------------------------------------------------------------------------

def parse_database_html(html_text: str) -> dict | None:
    """Extract the embedded JSON payload from an existing database.html, if any."""
    match = DB_JSON_RE.search(html_text)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def index_to_working_subjects(index: dict | None) -> dict:
    """Convert a database index ({"subjects":[...]}) into the working subjects dict."""
    subjects: dict = {}
    if not index:
        return subjects
    for subject in index.get("subjects", []):
        subject_slug = slugify(subject["title"])
        subjects[subject_slug] = {"title": subject["title"], "specialties": {}}
        for specialty in subject.get("specialties", []):
            specialty_slug = slugify(specialty["title"])
            subjects[subject_slug]["specialties"][specialty_slug] = {
                "title": specialty["title"],
                "courses": {
                    c["id"]: {
                        "id": c["id"],
                        "title": c["title"],
                        "keywords": c.get("keywords", []),
                        "path": c["path"],
                        "search_blob": c.get("search_blob", ""),
                        "added_at": c.get("added_at"),
                        # no "body": untouched courses never need their .md rewritten
                    }
                    for c in specialty.get("courses", [])
                },
            }
    return subjects


def merge_subjects(existing: dict, new: dict, run_timestamp: str) -> dict:
    """
    Merge the new batch into the existing database (deep merge).
    A course present in both is UPDATED (new content wins, but its original
    "added_at" is preserved — editing a course doesn't bump its add date).
    A genuinely new course gets "added_at" = run_timestamp.
    """
    merged = {
        s_slug: {"title": s["title"], "specialties": {sp_slug: {"title": sp["title"], "courses": dict(sp["courses"])}
                                                        for sp_slug, sp in s["specialties"].items()}}
        for s_slug, s in existing.items()
    }

    for s_slug, s in new.items():
        merged.setdefault(s_slug, {"title": s["title"], "specialties": {}})
        for sp_slug, sp in s["specialties"].items():
            merged[s_slug]["specialties"].setdefault(sp_slug, {"title": sp["title"], "courses": {}})
            existing_courses = merged[s_slug]["specialties"][sp_slug]["courses"]
            for course_id, course in sp["courses"].items():
                previous = existing_courses.get(course_id)
                course["added_at"] = previous["added_at"] if previous else run_timestamp
                existing_courses[course_id] = course

    return merged


def build_index(subjects: dict) -> dict:
    """Build the final {"subjects": [...]} structure, sorted alphabetically."""
    out_subjects = []
    for subject_slug, subject in sorted(subjects.items(), key=lambda kv: sort_key(kv[1]["title"])):
        out_specialties = []
        for specialty_slug, specialty in sorted(
            subject["specialties"].items(), key=lambda kv: sort_key(kv[1]["title"])
        ):
            out_courses = [
                {
                    "id": c["id"],
                    "title": c["title"],
                    "slug": c["id"],
                    "path": c["path"],
                    "keywords": c["keywords"],
                    "search_blob": c["search_blob"],
                    "added_at": c.get("added_at"),
                }
                for c in sorted(specialty["courses"].values(), key=lambda c: sort_key(c["title"]))
            ]
            out_specialties.append(
                {"id": specialty_slug, "title": specialty["title"], "courses": out_courses}
            )
        out_subjects.append(
            {"id": subject_slug, "title": subject["title"], "specialties": out_specialties}
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "subjects": out_subjects,
    }


def delete_courses(
    subjects: dict, ids_to_delete: set[str], content_dir: Path, manifest: dict
) -> tuple[dict, list[str], list[str]]:
    """
    Remove the given course ids from the working structure, delete their
    .md file from disk, and drop their manifest entry. Empty specialties
    and subjects left behind are pruned. Returns (subjects, deleted, not_found).
    """
    deleted: list[str] = []
    remaining_ids = set(ids_to_delete)

    for subject_slug in list(subjects.keys()):
        subject = subjects[subject_slug]
        for specialty_slug in list(subject["specialties"].keys()):
            specialty = subject["specialties"][specialty_slug]
            for course_id in list(specialty["courses"].keys()):
                if course_id not in ids_to_delete:
                    continue
                course = specialty["courses"].pop(course_id)
                remaining_ids.discard(course_id)
                deleted.append(f"{course['title']} ({course_id})")

                md_path = content_dir.parent / course["path"] if "path" in course else None
                if md_path and md_path.exists():
                    md_path.unlink()

                manifest_key = f"{subject_slug}/{specialty_slug}/{course_id}"
                manifest.pop(manifest_key, None)

            if not specialty["courses"]:
                del subject["specialties"][specialty_slug]
        if not subject["specialties"]:
            del subjects[subject_slug]

    not_found = sorted(remaining_ids)
    return subjects, deleted, not_found


def find_id_collisions(index: dict) -> list[str]:
    """
    Course ids must be globally unique across the whole site (they're the
    routing key, e.g. #/hta), even across different subjects/specialties.
    """
    seen: dict[str, str] = {}
    collisions = []
    for subject in index["subjects"]:
        for specialty in subject["specialties"]:
            for course in specialty["courses"]:
                loc = f"{subject['title']} / {specialty['title']} / {course['title']}"
                if course["id"] in seen:
                    collisions.append(f"id « {course['id']} » utilisé par : {seen[course['id']]}  ET  {loc}")
                else:
                    seen[course["id"]] = loc
    return collisions


def render_database_html(index: dict) -> str:
    """
    Render content/database.html: the persistent HTML database. Contains the
    course index as embedded JSON (parsed by the frontend at startup) plus a
    small human-readable summary for anyone opening the file directly.
    """
    subject_count = len(index["subjects"])
    specialty_count = sum(len(s["specialties"]) for s in index["subjects"])
    course_count = sum(len(sp["courses"]) for s in index["subjects"] for sp in s["specialties"])
    payload = json.dumps(index, ensure_ascii=False, indent=2)

    rows = []
    for s in index["subjects"]:
        for sp in s["specialties"]:
            for c in sp["courses"]:
                rows.append(
                    f"<tr><td>{escape_html(s['title'])}</td><td>{escape_html(sp['title'])}</td>"
                    f"<td>{escape_html(c['title'])}</td><td><code>{escape_html(c['id'])}</code></td>"
                    f"<td><code>{escape_html(c['path'])}</code></td></tr>"
                )

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>MedRef — Base de données des cours (générée automatiquement)</title>
<meta name="robots" content="noindex">
<style>
  body {{ font-family: system-ui, sans-serif; background:#0e0d12; color:#f0eef5; padding:2rem; }}
  h1 {{ font-size:1.3rem; }}
  p {{ color:#b3aec2; }}
  table {{ border-collapse: collapse; width:100%; font-size:0.85rem; margin-top:1rem; }}
  th, td {{ text-align:left; padding:6px 10px; border-bottom:1px solid #2a2733; }}
  th {{ color:#7a7488; font-weight:600; }}
  code {{ color:#33c3d6; }}
</style>
</head>
<body>
<h1>MedRef — Base de données des cours</h1>
<p>
  Fichier généré et mis à jour automatiquement par <code>generate_site.py</code>.
  Ne pas éditer manuellement — utilisez un vecteur JSON en entrée du script pour ajouter/modifier des cours,
  ou <code>--delete &lt;ID&gt;</code> (colonne « ID » ci-dessous) pour en supprimer.
  <br>Dernière génération : {escape_html(index['generated_at'])} ·
  {subject_count} grand(s) sujet(s) · {specialty_count} spécialité(s) · {course_count} cours.
</p>
<table>
<thead><tr><th>Grand sujet</th><th>Spécialité</th><th>Cours</th><th>ID</th><th>Fichier</th></tr></thead>
<tbody>
{''.join(rows)}
</tbody>
</table>

<!-- Données consommées par le frontend (assets/js/dataLoader.js) : NE PAS RENOMMER cet id. -->
<script type="application/json" id="{DB_SCRIPT_ID}">
{payload}
</script>
</body>
</html>
"""


def escape_html(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ajoute/met à jour des cours dans la base de données HTML du site à partir d'un vecteur JSON."
    )
    parser.add_argument(
        "--input", "-i", default="source",
        help="Fichier .json (tableau de cours) OU dossier contenant un .json par cours — le vecteur de cours à ajouter/mettre à jour",
    )
    parser.add_argument("--output", "-o", default=".", help="Racine du projet (contient index.html)")
    parser.add_argument("--force", action="store_true", help="Réécrit les fichiers Markdown de ce lot même si inchangés")
    parser.add_argument(
        "--reset-database", action="store_true",
        help="Ignore la base de données existante et la reconstruit uniquement à partir de ce lot",
    )
    parser.add_argument(
        "--delete", nargs="+", metavar="COURSE_ID", default=None,
        help="Supprime un ou plusieurs cours de la base par identifiant (visible dans database.html ou l'URL #/<id>), puis quitte.",
    )
    parser.add_argument(
        "--delete-file", default=None, metavar="FICHIER_JSON",
        help="Fichier JSON contenant un tableau d'identifiants de cours à supprimer, puis quitte.",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    project_root = Path(args.output)
    content_dir = project_root / "content"
    content_dir.mkdir(parents=True, exist_ok=True)

    delete_mode = bool(args.delete or args.delete_file)
    if not delete_mode and not input_path.exists():
        raise SystemExit(f"Introuvable : {input_path}")

    database_path = content_dir / DATABASE_FILENAME
    manifest_path = content_dir / MANIFEST_FILENAME

    manifest = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}

    existing_index = None
    if database_path.exists() and not args.reset_database:
        existing_index = parse_database_html(database_path.read_text(encoding="utf-8"))
        if existing_index is None:
            print(f"⚠ {database_path} existe mais n'a pas pu être lu ; reconstruction depuis ce lot uniquement.")

    existing_subjects = index_to_working_subjects(existing_index)

    # ---------------- Deletion mode: remove courses, then exit ----------------
    if args.delete or args.delete_file:
        if not existing_subjects:
            raise SystemExit(f"Aucune base de données existante à {database_path} : rien à supprimer.")

        ids_to_delete: set[str] = set(args.delete or [])
        if args.delete_file:
            delete_file_path = Path(args.delete_file)
            if not delete_file_path.exists():
                raise SystemExit(f"Introuvable : {delete_file_path}")
            try:
                extra_ids = json.loads(delete_file_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                raise SystemExit(f"JSON invalide dans {delete_file_path} : {e}")
            if not isinstance(extra_ids, list):
                raise SystemExit(f"{delete_file_path} doit contenir un tableau JSON d'identifiants.")
            ids_to_delete.update(str(i) for i in extra_ids)

        subjects_after, deleted, not_found = delete_courses(
            existing_subjects, ids_to_delete, content_dir, manifest
        )
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

        index = build_index(subjects_after)
        database_path.write_text(render_database_html(index), encoding="utf-8")

        total_courses = sum(len(sp["courses"]) for s in index["subjects"] for sp in s["specialties"])
        print(f"\n{len(deleted)} cours supprimé(s) :")
        for d in deleted:
            print(f"  - {d}")
        if not_found:
            print(f"\n⚠ {len(not_found)} identifiant(s) introuvable(s) dans la base :")
            for nf in not_found:
                print(f"  - {nf}")
        print(f"\nTotal de cours restants en base : {total_courses}")
        print(f"Base de données mise à jour : {database_path}")
        return

    print(
        f"Base existante : {sum(len(sp['courses']) for s in existing_subjects.values() for sp in s['specialties'].values())} cours."
        if existing_subjects else "Aucune base existante — première génération."
    )

    print(f"\nLecture du vecteur {input_path} ...")
    raw_courses, read_warnings = read_courses(input_path)
    print(f"{len(raw_courses)} cours dans ce lot.")

    new_subjects, build_warnings = build_course_entries(raw_courses)
    warnings = read_warnings + build_warnings

    print("Génération des fichiers Markdown pour ce lot :")
    batch_manifest_entries, stats = write_markdown_files(new_subjects, content_dir, manifest, args.force)
    manifest.update(batch_manifest_entries)  # merge, don't replace: keep hashes of untouched courses
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    merged_subjects = merge_subjects(existing_subjects, new_subjects, run_timestamp=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    index = build_index(merged_subjects)
    collisions = find_id_collisions(index)

    database_path.write_text(render_database_html(index), encoding="utf-8")

    total_courses = sum(len(sp["courses"]) for s in index["subjects"] for sp in s["specialties"])

    print("\n--- Résumé ---")
    print(f"Cours dans ce lot        : {stats['total']}")
    print(f"Fichiers .md écrits      : {stats['written']}")
    print(f"Fichiers .md inchangés   : {stats['skipped']}")
    print(f"Total de cours en base   : {total_courses}")
    print(f"Base de données          : {database_path}")

    if warnings:
        print(f"\n{len(warnings)} avertissement(s) :")
        for w in warnings:
            print(f"  - {w}")

    if collisions:
        print(f"\n⚠ {len(collisions)} collision(s) d'identifiant détectée(s) :")
        for c in collisions:
            print(f"  - {c}")

    print("\nTerminé. Le site est prêt à être publié sur GitHub Pages.")


if __name__ == "__main__":
    main()
