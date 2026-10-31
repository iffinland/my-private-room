/**
 * Allowlist HTML sanitizer for file descriptions.
 *
 * Descriptions are authored in an in-app rich-text editor, stored as a JSON
 * QDN resource and rendered back with `dangerouslySetInnerHTML`. That render
 * path is only safe because this module is applied on write AND on read.
 *
 * Rules:
 *  - only a small allowlist of formatting tags survives;
 *  - every element is rebuilt from scratch, so unknown attributes, event
 *    handlers, `style`, `src` and similar never reach the DOM;
 *  - dangerous containers (script/style/iframe/object/embed/media/img/forms)
 *    are removed together with their content;
 *  - links must resolve to http(s) or mailto and get rel/target hardening;
 *  - nesting depth is bounded so a hostile document cannot exhaust the stack.
 */

const ALLOWED_TAGS = new Set([
  'A',
  'B',
  'BR',
  'DIV',
  'EM',
  'I',
  'LI',
  'OL',
  'P',
  'STRONG',
  'U',
  'UL',
]);

/** Elements removed together with all of their content. */
const DROP_WITH_CONTENT = new Set([
  'APPLET',
  'AUDIO',
  'BUTTON',
  'CANVAS',
  'EMBED',
  'FORM',
  'FRAME',
  'FRAMESET',
  'IFRAME',
  'IMG',
  'INPUT',
  'LINK',
  'MATH',
  'META',
  'NOSCRIPT',
  'OBJECT',
  'SCRIPT',
  'SELECT',
  'STYLE',
  'SVG',
  'TEMPLATE',
  'TEXTAREA',
  'VIDEO',
]);

const MAX_DEPTH = 40;

const parseHtml = (html: string): HTMLElement | null => {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body;
};

/** Normalize a link target; returns null when the URL must not be kept. */
export const sanitizeLinkHref = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  // Browsers ignore leading control characters/whitespace in URLs, so strip
  // them before deciding which scheme this really is.
  // Control characters are intentionally stripped: browsers ignore them when
  // resolving a URL, so `\u0000javascript:` must be treated as `javascript:`.
  // eslint-disable-next-line no-control-regex
  const value = raw.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value, 'https://qdn.invalid/');
  } catch {
    return null;
  }

  if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
    return url.href;
  }
  return null;
};

const rebuildNode = (
  source: Node,
  target: Document,
  output: Node,
  depth: number,
): void => {
  if (depth > MAX_DEPTH) {
    if (source.textContent) output.appendChild(target.createTextNode(source.textContent));
    return;
  }

  source.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      output.appendChild(target.createTextNode(child.textContent ?? ''));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;

    const element = child as Element;
    const tag = element.tagName.toUpperCase();

    if (DROP_WITH_CONTENT.has(tag)) return;

    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown wrappers are unwrapped: their text stays, their markup does not.
      rebuildNode(element, target, output, depth + 1);
      return;
    }

    if (tag === 'A') {
      const href = sanitizeLinkHref(element.getAttribute('href'));
      if (!href) {
        rebuildNode(element, target, output, depth + 1);
        return;
      }
      const anchor = target.createElement('a');
      anchor.setAttribute('href', href);
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer nofollow');
      const title = element.getAttribute('title');
      if (title) anchor.setAttribute('title', title.slice(0, 200));
      rebuildNode(element, target, anchor, depth + 1);
      output.appendChild(anchor);
      return;
    }

    const clean = target.createElement(tag.toLowerCase());
    rebuildNode(element, target, clean, depth + 1);
    output.appendChild(clean);
  });
};

/**
 * Sanitize rich-text HTML into the supported formatting subset.
 * Returns an empty string for content with no visible text or list items.
 */
export const sanitizeRichText = (html: string): string => {
  if (typeof html !== 'string' || html.trim() === '') return '';

  const body = parseHtml(html);
  if (!body) return '';

  const target = body.ownerDocument;
  const container = target.createElement('div');
  rebuildNode(body, target, container, 0);

  // Drop empty trailing formatting wrappers such as `<p><br></p>`.
  if (htmlToPlainText(container.innerHTML).trim() === '' && !container.querySelector('li')) {
    return '';
  }

  return container.innerHTML;
};

const BLOCK_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'BR']);

/** Convert sanitized rich text to plain text for metadata/excerpts. */
export const htmlToPlainText = (html: string): string => {
  const body = parseHtml(html);
  if (!body) return '';

  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node as Element).tagName.toUpperCase();
    if (tag === 'LI') parts.push('\n• ');
    node.childNodes.forEach(walk);
    if (BLOCK_TAGS.has(tag)) parts.push(tag === 'UL' || tag === 'OL' ? '\n' : '\n');
  };

  body.childNodes.forEach(walk);
  return parts
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/** Escape plain text for safe insertion into HTML. */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Render legacy plain-text descriptions safely as simple paragraphs. */
export const plainTextToHtml = (text: string): string =>
  text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');

/** Truncate a string to a UTF-8 byte budget without splitting a code point. */
export const truncateUtf8 = (value: string, maxBytes: number): string => {
  let result = '';
  let bytes = 0;
  for (const char of value) {
    const charBytes = new TextEncoder().encode(char).length;
    if (bytes + charBytes > maxBytes) break;
    result += char;
    bytes += charBytes;
  }
  return result;
};

/**
 * Plain-text excerpt for Core's mutable `description` metadata.
 * Home 2.1 accepts 500 bytes; Core stores at most 240.
 */
export const metadataExcerpt = (text: string, maxBytes = 240): string =>
  truncateUtf8(text.replace(/\s+/g, ' ').trim(), maxBytes).trim();
