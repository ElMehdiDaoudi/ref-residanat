# MedRef — Base de cours médicaux (site statique GitHub Pages)

Site 100 % statique (HTML/CSS/JS, aucun backend), alimenté par des fichiers
Markdown et une base de données HTML persistante, tous deux générés et
mis à jour automatiquement par `generate_site.py` à partir de vecteurs
JSON.

## Structure du projet

```
index.html                 Point d'entrée unique
assets/
  css/
    variables.css           Tokens de design (couleurs, typo, espacements)
    base.css                Reset + primitives globales
    layout.css               Grille de l'app, page d'accueil
    sidebar.css              Menu latéral repliable + arborescence
    search.css               Panneau de résultats de recherche instantanée
    content.css               Fil d'Ariane, mots-clés cliquables
    markdown.css              Rendu du Markdown (titres, tables, code, citations…)
    responsive.css            Mobile portrait / paysage / tablette / desktop
  js/
    state.js                 État global + persistance localStorage
    dataLoader.js             Chargement paresseux de database.html et des .md
    markdownRenderer.js       Markdown -> HTML (marked.js + DOMPurify + KaTeX)
    keywordHighlighter.js     Mise en évidence automatique des mots-clés
    sidebar.js                 Arborescence Sujet > Spécialité > Cours
    search.js                  Recherche instantanée (titre/mots-clés/contenu)
    breadcrumb.js              Fil d'Ariane
    router.js                  Routage par hash + vues Sujet/Spécialité/Cours
    main.js                    Bootstrap de l'application
content/
  database.html              LA BASE DE DONNÉES du site (générée, persistante — voir plus bas)
  markdown/<sujet>/<specialite>/<cours>.md   Contenu de chaque cours (généré)
  images/                     Images utilisées dans les cours (optionnel)
  .generate_manifest.json    Cache interne (hash) pour les mises à jour incrémentales
generate_site.py            Script de génération / fusion (vecteur JSON -> database.html + .md)
source/                     Exemple de vecteur : un fichier .json par cours
data.sample.json            Exemple de vecteur alternatif : un seul fichier, tableau de cours
```

## Le concept clé : `content/database.html` est la base de données

Le site ne garde **pas** de fichier JSON comme source de vérité. La base de
données de tous les cours (titres, mots-clés, chemins, extraits de
recherche) est stockée dans **`content/database.html`**, un fichier HTML
persistant que `generate_site.py` **fusionne** (met à jour, n'écrase pas)
à chaque exécution.

Les fichiers JSON que vous fournissez en `--input` ne sont que des
**vecteurs d'ajout ou de mise à jour** : vous n'avez pas besoin de les
conserver après coup, contrairement à un fichier source qu'il faudrait
garder indéfiniment pour pouvoir tout régénérer.

- Un cours du vecteur dont le **Grand Sujet + Spécialité + Titre** existe
  déjà dans la base → il est **mis à jour** (son `.md` et son entrée dans
  `database.html` sont remplacés).
- Un cours avec une combinaison nouvelle → il est **ajouté**.
- Les cours déjà présents dans la base mais absents de ce lot ne sont
  **jamais touchés**.
- `content/database.html` reste un fichier HTML valide : ouvrez-le
  directement dans un navigateur pour voir un tableau récapitulatif de
  tous les cours en base. Les données qu'utilise le site lui-même sont
  intégrées dedans, dans un bloc `<script type="application/json" id="courses-db">`.

## Démarrage rapide

1. **Ajouter/mettre à jour des cours** à partir d'un vecteur JSON :

   ```bash
   python generate_site.py --input source --output .
   # ou, avec un seul fichier contenant un tableau de cours :
   python generate_site.py --input data.json --output .
   ```

   Relancez cette commande autant de fois que nécessaire, avec de
   nouveaux vecteurs à chaque fois : `content/database.html` s'enrichit
   au fil des exécutions, il n'est jamais reparti de zéro.

2. **Prévisualiser en local** (nécessaire car le site fait des `fetch()`,
   qui échouent en ouvrant `index.html` directement avec `file://`) :

   ```bash
   python -m http.server 8000
   # puis ouvrir http://localhost:8000
   ```

3. **Publier sur GitHub Pages** : poussez le contenu du dossier tel quel
   sur la branche `main` (ou `gh-pages`), puis activez GitHub Pages dans
   les paramètres du dépôt (Settings → Pages → Source : branche + dossier
   `/`). Aucune étape de build n'est nécessaire.

## Format d'un vecteur JSON (cours à ajouter/mettre à jour)

`--input` accepte deux formats, au choix :

### 1. Un dossier avec un fichier `.json` par cours *(recommandé)*

C'est le format à utiliser quand un agent IA extrait les cours un par un :
chaque appel écrit un seul petit fichier, sans risque de casser un gros
tableau JSON en le complétant. Tous les `.json` du dossier (récursif) sont
lus automatiquement — voir `source/` pour 3 exemples.

```json
{
  "titre_cours": "HTA",
  "grand_sujet": "Médecine",
  "specialite": "Cardiologie",
  "mots_cles": ["HTA", "hypertension artérielle", "phéochromocytome"],
  "texte_cours": "## Définition\n\nL'hypertension artérielle est...\n\n| Grade | PAS |\n|---|---|\n| 1 | 140-159 |"
}
```

### 2. Un seul fichier JSON contenant un tableau de cours

Pratique pour un import groupé. Voir `data.sample.json`.

```json
[
  { "titre_cours": "...", "grand_sujet": "...", "specialite": "...", "mots_cles": [...], "texte_cours": "..." },
  { "titre_cours": "...", "grand_sujet": "...", "specialite": "...", "mots_cles": [...], "texte_cours": "..." }
]
```

### Champs (obligatoires pour chaque cours)

- **`titre_cours`** *(string)* : devient le titre du cours et le `# H1` généré automatiquement en tête du Markdown. Le site n'affiche ce titre qu'une seule fois (via ce H1) — ne le répétez pas dans `texte_cours`.
- **`grand_sujet`** *(string)* : niveau 1 de la hiérarchie de navigation (ex. `Médecine`).
- **`specialite`** *(string)* : niveau 2 de la hiérarchie (ex. `Cardiologie`).
- **`mots_cles`** *(tableau de strings)* : termes à mettre en évidence automatiquement dans le cours affiché. Ces mots-clés doivent être des éléments que l'étudiant doit **obligatoirement mémoriser** — sémiologiques (signes, symptômes), paracliniques (examens, valeurs seuils, scores) ou thérapeutiques (molécules, classes, posologies) — pas n'importe quel terme « important ». Les expressions composées (ex. `"hypertension artérielle"`) sont automatiquement prioritaires sur les mots simples lors de la mise en évidence côté client.
- **`texte_cours`** *(string, Markdown)* : le corps du cours (tables, listes, citations, code, liens, images, `$formules$` LaTeX...), échappé en JSON standard (`\n` pour les retours à la ligne, `\"` pour un guillemet).

Un fichier légèrement non conforme (ex. `mots_cles` fourni comme une chaîne `"a;b;c"` au lieu d'un tableau) est toléré par robustesse, mais le format tableau est le format attendu.

## Ce que fait `generate_site.py`

- Lit la base existante (`content/database.html`), si elle existe.
- Lit le vecteur JSON passé en `--input` (dossier de fichiers ou fichier unique).
- **Fusionne** : met à jour les cours existants qui réapparaissent dans le vecteur, ajoute les nouveaux, laisse intacts tous les autres.
- Crée automatiquement l'arborescence de dossiers `content/markdown/<sujet>/<specialite>/`.
- Génère un slug propre pour chaque sujet/spécialité/cours (accents supprimés, minuscules, caractères interdits remplacés par des tirets — compatible Windows **et** Linux).
- Détecte les doublons **à l'intérieur d'un même lot** (même sujet + spécialité + titre répété deux fois dans le vecteur) et renomme automatiquement le fichier en conflit (`-2`, `-3`, …) avec un avertissement, en précisant le fichier source en cause. Un cours qui correspond à un cours déjà en base n'est pas un doublon : c'est une mise à jour intentionnelle.
- Ne réécrit un fichier Markdown que si son contenu a réellement changé (hash MD5 dans `content/.generate_manifest.json`), pour des mises à jour rapides. `--force` réécrit systématiquement les fichiers du lot en cours.
- Réécrit `content/database.html` avec la base fusionnée.
- Affiche une barre de progression, un résumé, et signale toute collision d'identifiant globale (deux cours de sujets différents qui donneraient le même identifiant de route).
- Fonctionne sous Windows et Linux (bibliothèques standard uniquement : `pathlib`, `json`, `hashlib`, `unicodedata`, `argparse`).

```bash
python generate_site.py --input source --output .                  # fusionne ce lot dans la base existante
python generate_site.py --input source --output . --force          # + réécrit les .md du lot même si inchangés
python generate_site.py --input source --output . --reset-database  # ignore la base existante, repart de ce lot seul
```

## Prompt d'extraction pour un agent IA

Si vous utilisez un LLM pour extraire le contenu d'un document source vers ce format, exigez :
- une sortie JSON stricte (un objet, ou un tableau d'objets), rien d'autre (pas de bloc de code, pas de commentaire) ;
- aucune reformulation du `texte_cours` : copie exacte du document, mise en forme Markdown fidèle ;
- des `mots_cles` limités aux éléments sémiologiques/paracliniques/thérapeutiques à mémoriser, jamais des mots courants.

## Fonctionnement du frontend

- **Chargement paresseux** : `content/database.html` (léger : seulement les métadonnées) est chargé une seule fois au démarrage ; `dataLoader.js` en extrait le bloc JSON embarqué. Le Markdown d'un cours n'est récupéré que lorsque l'utilisateur ouvre ce cours, puis mis en cache en mémoire pour le reste de la session. Le site reste donc rapide même avec plus de 10 000 cours.
- **Rendu Markdown** : [marked.js](https://cdnjs.cloudflare.com/ajax/libs/marked) convertit le Markdown en HTML (titres, listes, tables GFM, citations, code, liens, images, séparateurs), [DOMPurify](https://cdnjs.cloudflare.com/ajax/libs/dompurify) assainit le HTML, et [KaTeX](https://cdnjs.cloudflare.com/ajax/libs/KaTeX) rend les formules `$...$` / `$$...$$`. Le titre du cours n'est affiché qu'une fois, via le `# H1` généré en tête du Markdown.
- **Mise en évidence des mots-clés** : après le rendu, `keywordHighlighter.js` parcourt le texte du cours et transforme chaque occurrence d'un mot-clé (insensible à la casse, expressions composées prioritaires) en lien cliquable, gras et coloré, qui ouvre `https://www.google.com/search?q=...` dans un nouvel onglet. Le texte à l'intérieur des liens et des blocs de code n'est jamais modifié.
- **Recherche instantanée** : filtre côté client sur le titre, les mots-clés et un extrait du contenu (`search_blob`, généré par le script Python), sans jamais télécharger les fichiers Markdown.
- **Navigation** : accueil → clic sur un grand sujet → liste des spécialités → clic sur une spécialité → liste des cours → clic sur un cours. Menu latéral repliable (bouton flèche sur desktop, tiroir superposé sur mobile), fil d'Ariane à chaque niveau, routage par hash (`#/sujet/<id>`, `#/specialite/<sujet>/<specialite>`, `#/<cours>` — compatible GitHub Pages sans configuration serveur), et mémorisation du dernier cours consulté (`localStorage`) affichée dans « Récemment consulté » sur l'accueil.
- **Thème** : sombre par défaut (accent cyan), bascule possible vers un thème clair, préférence mémorisée.

## Personnalisation

- Couleurs, polices, espacements : tout est centralisé dans `assets/css/variables.css`.
- Le moteur de mise en évidence des mots-clés peut être adapté (ex. changer l'URL de recherche cible) dans `assets/js/keywordHighlighter.js`, fonction `googleSearchUrl()`.
- Les versions des bibliothèques CDN (marked, DOMPurify, KaTeX) sont épinglées dans `index.html` ; mettez-les à jour selon vos besoins.
