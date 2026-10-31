import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  htmlToPlainText,
  metadataExcerpt,
  plainTextToHtml,
  sanitizeLinkHref,
  sanitizeRichText,
  truncateUtf8,
} from './sanitizeHtml';

describe('sanitizeLinkHref', () => {
  it('keeps http, https and mailto links', () => {
    expect(sanitizeLinkHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(sanitizeLinkHref('http://example.com')).toBe('http://example.com/');
    expect(sanitizeLinkHref('mailto:user@example.com')).toBe('mailto:user@example.com');
  });

  it('rejects script, data and javascript schemes', () => {
    expect(sanitizeLinkHref('javascript:alert(1)')).toBeNull();
    expect(sanitizeLinkHref('  javascript:alert(1)')).toBeNull();
    expect(sanitizeLinkHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeLinkHref('vbscript:msgbox(1)')).toBeNull();
    expect(sanitizeLinkHref(42)).toBeNull();
  });
});

describe('sanitizeRichText', () => {
  it('keeps the supported formatting subset', () => {
    const output = sanitizeRichText(
      '<p><strong>Bold</strong> and <em>italic</em> and <u>under</u></p><ul><li>One</li></ul><ol><li>Two</li></ol>',
    );
    expect(output).toContain('<strong>Bold</strong>');
    expect(output).toContain('<em>italic</em>');
    expect(output).toContain('<u>under</u>');
    expect(output).toContain('<ul><li>One</li></ul>');
    expect(output).toContain('<ol><li>Two</li></ol>');
  });

  it('removes scripts and event handlers together with their content', () => {
    const output = sanitizeRichText(
      '<p onclick="alert(1)">Safe<script>alert(2)</script></p><script>alert(3)</script>',
    );
    expect(output).toContain('Safe');
    expect(output).not.toContain('script');
    expect(output).not.toContain('onclick');
    expect(output).not.toContain('alert');
  });

  it('drops images, iframes, styles and form controls', () => {
    const output = sanitizeRichText(
      '<img src="x" onerror="alert(1)"><iframe src="https://evil"></iframe><style>body{display:none}</style><input value="x">Text',
    );
    expect(output).toBe('Text');
  });

  it('drops unsafe links but keeps their text', () => {
    const output = sanitizeRichText('<a href="javascript:alert(1)">click me</a>');
    expect(output).toBe('click me');
  });

  it('hardens safe links', () => {
    const output = sanitizeRichText('<a href="https://example.com" title="Example">site</a>');
    expect(output).toContain('href="https://example.com/"');
    expect(output).toContain('target="_blank"');
    expect(output).toContain('rel="noopener noreferrer nofollow"');
  });

  it('unwraps unknown containers while preserving text', () => {
    expect(sanitizeRichText('<section><p>Kept</p></section>')).toBe('<p>Kept</p>');
  });

  it('returns an empty string for visually empty content', () => {
    expect(sanitizeRichText('<p><br></p>')).toBe('');
    expect(sanitizeRichText('   ')).toBe('');
    expect(sanitizeRichText('<ul></ul>')).toBe('');
  });

  it('keeps a list item that carries no text', () => {
    expect(sanitizeRichText('<ul><li></li></ul>')).toContain('<li>');
  });
});

describe('text helpers', () => {
  it('escapes plain text for HTML insertion', () => {
    expect(escapeHtml('<b>"x" & \'y\'</b>')).toBe(
      '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;',
    );
  });

  it('renders legacy plain text as escaped paragraphs', () => {
    expect(plainTextToHtml('one\n\ntwo <script>')).toBe(
      '<p>one</p><p>two &lt;script&gt;</p>',
    );
  });

  it('converts rich text to readable plain text', () => {
    const text = htmlToPlainText('<p>Hello <strong>world</strong></p><ul><li>a</li><li>b</li></ul>');
    expect(text).toContain('Hello world');
    expect(text).toContain('• a');
    expect(text).toContain('• b');
  });

  it('truncates at a UTF-8 byte budget without splitting characters', () => {
    expect(truncateUtf8('abcdef', 3)).toBe('abc');
    expect(truncateUtf8('ää', 3)).toBe('ä');
    expect(truncateUtf8('äö', 4)).toBe('äö');
  });

  it('bounds the Core metadata excerpt to 240 bytes', () => {
    const excerpt = metadataExcerpt('ä'.repeat(500));
    expect(new TextEncoder().encode(excerpt).length).toBeLessThanOrEqual(240);
  });
});
