/**
 * keywordHighlighter.js
 *
 * After a course's Markdown has been rendered to HTML, walk the resulting
 * DOM and turn every occurrence of a keyword provided by the Python script
 * into a bold, colored, clickable term that opens a Google search in a
 * new tab. Requirements handled here:
 *   - case-insensitive matching
 *   - multi-word ("compound") expressions detected as a whole
 *   - compound expressions take priority over single-word keywords
 *     (guaranteed by sorting keywords by length, longest first, before
 *     building the match regex — the alternation then greedily prefers
 *     the longest match starting at any given position)
 *   - text inside links, code, and pre blocks is left untouched, so we
 *     never nest an <a> inside another <a> or mangle code samples
 */

const SKIP_TAGS = new Set(["A", "CODE", "PRE", "SCRIPT", "STYLE", "KATEX", "SVG"]);

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build one big regex that matches any of the given keywords, longest
 * first, with Unicode-aware word boundaries (so accented French terms
 * like "hypertension artérielle" are matched correctly).
 */
function buildKeywordRegex(keywords) {
  const unique = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  unique.sort((a, b) => b.length - a.length); // compound / longer expressions first
  const alternation = unique.map(escapeRegExp).join("|");
  // (?<![\p{L}\p{N}]) / (?![\p{L}\p{N}]) act as Unicode-safe word boundaries
  return new RegExp(`(?<![\\p{L}\\p{N}])(${alternation})(?![\\p{L}\\p{N}])`, "giu");
}

function googleSearchUrl(term) {
  return `https://www.google.com/search?q=${encodeURIComponent(term)}`;
}

/**
 * @param {HTMLElement} container - rendered .markdown-body element
 * @param {string[]} keywords - list of keywords/expressions to highlight
 */
export function highlightKeywords(container, keywords) {
  const regex = buildKeywordRegex(keywords);
  if (!regex) return;

  // Collect text nodes first so we don't mutate the DOM while walking it.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement;
      while (el && el !== container) {
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);

  for (const textNode of textNodes) {
    const text = textNode.nodeValue;
    regex.lastIndex = 0;
    if (!regex.test(text)) continue;
    regex.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const [matched] = match;
      const start = match.index;

      if (start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }

      const link = document.createElement("a");
      link.className = "kw-link";
      link.href = googleSearchUrl(matched);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = `Rechercher « ${matched} » sur Google`;
      link.textContent = matched;
      frag.appendChild(link);

      lastIndex = start + matched.length;

      // Guard against zero-length matches causing an infinite loop.
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(frag, textNode);
  }
}
