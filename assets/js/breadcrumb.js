/**
 * breadcrumb.js
 * Renders the "fil d'Ariane". Accepts a list of crumbs:
 *   [{ label, href }, ..., { label }]   // last crumb has no href (current page)
 */

const breadcrumbEl = document.getElementById("breadcrumb");

/** @param {{label: string, href?: string}[]} crumbs */
export function renderBreadcrumb(crumbs) {
  breadcrumbEl.innerHTML = crumbs
    .map((crumb, i) => {
      const isLast = i === crumbs.length - 1;
      if (isLast || !crumb.href) {
        return `<span class="crumb-current">${escapeHtml(crumb.label)}</span>`;
      }
      return `<a href="${crumb.href}">${escapeHtml(crumb.label)}</a>`;
    })
    .join(`<span class="crumb-sep">/</span>`);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
