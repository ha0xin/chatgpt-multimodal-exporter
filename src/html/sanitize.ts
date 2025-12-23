const ALLOWED_HTML_TAGS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'del', 'details', 'div', 'em',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre',
    'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'th',
    'thead', 'tr', 'u', 'ul'
]);
const DROP_HTML_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base']);
const GLOBAL_ALLOWED_ATTRS = new Set(['class', 'title', 'style', 'role']);
const TAG_ALLOWED_ATTRS: Record<string, Set<string>> = {
    a: new Set(['href', 'target', 'rel']),
    img: new Set(['src', 'alt', 'loading']),
    th: new Set(['colspan', 'rowspan', 'align', 'scope']),
    td: new Set(['colspan', 'rowspan', 'align'])
};
const SAFE_DATA_IMAGE_PATTERN = /^data:image\/(png|jpe?g|gif|webp);base64,/i;

function isSafeUrl(url: string, tagName: string): boolean {
    const trimmed = (url || '').trim();
    if (!trimmed) return true;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return false;
    if (lower.startsWith('data:')) {
        return tagName === 'img' && SAFE_DATA_IMAGE_PATTERN.test(lower);
    }
    if (
        lower.startsWith('http:') ||
        lower.startsWith('https:') ||
        lower.startsWith('mailto:') ||
        lower.startsWith('tel:') ||
        lower.startsWith('sandbox:') ||
        lower.startsWith('//')
    ) {
        return true;
    }
    return !/^[a-z][a-z0-9+.-]*:/.test(lower);
}

function isSafeStyle(style: string): boolean {
    const lower = (style || '').toLowerCase();
    if (lower.includes('expression(')) return false;
    if (lower.includes('javascript:')) return false;
    if (/url\(\s*['"]?\s*javascript:/i.test(lower)) return false;
    if (/url\(\s*['"]?\s*data:text\/html/i.test(lower)) return false;
    return true;
}

function isAllowedAttr(tagName: string, attrName: string): boolean {
    if (attrName.startsWith('data-')) return true;
    if (attrName.startsWith('aria-')) return true;
    if (GLOBAL_ALLOWED_ATTRS.has(attrName)) return true;
    const tagAllowed = TAG_ALLOWED_ATTRS[tagName];
    return Boolean(tagAllowed && tagAllowed.has(attrName));
}

function sanitizeElementAttributes(el: Element, tagName: string) {
    for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (!isAllowedAttr(tagName, name)) {
            el.removeAttribute(attr.name);
            continue;
        }
        if ((name === 'href' || name === 'src') && !isSafeUrl(attr.value, tagName)) {
            el.removeAttribute(attr.name);
            continue;
        }
        if (name === 'style' && !isSafeStyle(attr.value)) {
            el.removeAttribute(attr.name);
        }
    }

    if (tagName === 'a' && el.getAttribute('target') === '_blank') {
        const rel = (el.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
        if (!rel.includes('noopener')) rel.push('noopener');
        if (!rel.includes('noreferrer')) rel.push('noreferrer');
        el.setAttribute('rel', rel.join(' '));
    }
}

export function sanitizeHtmlContent(html: string): string {
    if (!html) return html;
    if (typeof DOMParser === 'undefined') return html;

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const elements = Array.from(doc.body.querySelectorAll('*'));

    for (const el of elements) {
        if (!el.parentNode) continue;
        const tagName = el.tagName.toLowerCase();
        if (!ALLOWED_HTML_TAGS.has(tagName)) {
            if (DROP_HTML_TAGS.has(tagName)) {
                el.remove();
                continue;
            }
            const parent = el.parentNode;
            if (!parent) continue;
            while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
            continue;
        }
        sanitizeElementAttributes(el, tagName);
    }

    return doc.body.innerHTML;
}
