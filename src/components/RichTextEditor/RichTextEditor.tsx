import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Bold, Italic, Link2, List, ListOrdered, Unlink, Check, X } from 'lucide-react';
import {
  escapeHtml,
  htmlToPlainText,
  sanitizeLinkHref,
  sanitizeRichText,
} from '../../lib/sanitizeHtml';
import './RichTextEditor.css';

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  label?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}

const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Small contentEditable rich-text editor with an allowlisted output.
 *
 * `execCommand` is deprecated but remains the only dependency-free way to
 * apply inline formatting inside a contentEditable in every Home WebView. The
 * output is always sanitized again on blur and on publish.
 */
export default function RichTextEditor({
  value,
  onChange,
  label = 'Description',
  placeholder = 'Add a description…',
  maxLength = 10_000,
  disabled = false,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const linkInputRef = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const focused = useRef(false);

  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState('');
  const [length, setLength] = useState(0);
  const [states, setStates] = useState({ bold: false, italic: false, unordered: false, ordered: false });

  const syncLength = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    setLength(htmlToPlainText(editor.innerHTML).length);
  }, []);

  // Keep the DOM in sync with external value changes (e.g. reset), but never
  // while the user is typing or a caret reset would jump the cursor.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || focused.current) return;
    if (editor.innerHTML !== value) editor.innerHTML = value;
    syncLength();
  }, [value, syncLength]);

  useEffect(() => {
    const onSelectionChange = () => {
      if (!focused.current) return;
      try {
        setStates({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          unordered: document.queryCommandState('insertUnorderedList'),
          ordered: document.queryCommandState('insertOrderedList'),
        });
      } catch {
        // queryCommandState is unavailable in a few engines; buttons still work.
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  const emit = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(editor.innerHTML);
    syncLength();
  }, [onChange, syncLength]);

  const exec = useCallback(
    (command: string, argument?: string) => {
      if (disabled) return;
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      try {
        document.execCommand('styleWithCSS', false, 'false');
        document.execCommand(command, false, argument);
      } catch {
        // Ignore unsupported command; the editor remains usable.
      }
      emit();
    },
    [disabled, emit],
  );

  const saveSelection = useCallback(() => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedRange.current = selection.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const range = savedRange.current;
    if (!range) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  const applyLink = useCallback(() => {
    const href = sanitizeLinkHref(linkUrl);
    if (!href) {
      setLinkError('Enter an http(s) or mailto link.');
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    restoreSelection();

    const selection = window.getSelection();
    const collapsed = !selection || selection.isCollapsed || selection.rangeCount === 0;
    if (collapsed) {
      document.execCommand(
        'insertHTML',
        false,
        `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>&nbsp;`,
      );
    } else {
      document.execCommand('createLink', false, href);
    }
    savedRange.current = null;
    setShowLink(false);
    setLinkUrl('');
    setLinkError('');
    emit();
  }, [emit, linkUrl, restoreSelection]);

  const openLink = useCallback(() => {
    saveSelection();
    setShowLink(true);
    setLinkError('');
    setLinkUrl('');
    window.setTimeout(() => linkInputRef.current?.focus(), 0);
  }, [saveSelection]);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // Paste as plain text: pasted markup must never reach the document.
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
      emit();
    },
    [emit],
  );

  const handleBlur = useCallback(() => {
    focused.current = false;
    const editor = editorRef.current;
    if (!editor) return;
    const sanitized = sanitizeRichText(editor.innerHTML);
    if (sanitized !== editor.innerHTML) editor.innerHTML = sanitized;
    if (sanitized !== value) onChange(sanitized);
    syncLength();
  }, [onChange, syncLength, value]);

  const toolbarButton = (
    action: () => void,
    icon: React.ReactNode,
    labelText: string,
    pressed: boolean,
    shortcut?: string,
  ) => (
    <button
      type="button"
      className={`rte__btn${pressed ? ' rte__btn--active' : ''}`}
      aria-label={labelText}
      aria-pressed={pressed}
      title={shortcut ? `${labelText} (${shortcut})` : labelText}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
      disabled={disabled}
    >
      {icon}
    </button>
  );

  const modifier = isMac() ? '⌘' : 'Ctrl';

  return (
    <div className={`rte${disabled ? ' rte--disabled' : ''}`}>
      <div className="rte__toolbar" role="toolbar" aria-label="Description formatting">
        {toolbarButton(() => exec('bold'), <Bold size={15} />, 'Bold', states.bold, `${modifier}+B`)}
        {toolbarButton(() => exec('italic'), <Italic size={15} />, 'Italic', states.italic, `${modifier}+I`)}
        {toolbarButton(
          () => exec('insertUnorderedList'),
          <List size={15} />,
          'Bulleted list',
          states.unordered,
        )}
        {toolbarButton(
          () => exec('insertOrderedList'),
          <ListOrdered size={15} />,
          'Numbered list',
          states.ordered,
        )}
        <span className="rte__divider" aria-hidden="true" />
        {toolbarButton(openLink, <Link2 size={15} />, 'Add link', showLink)}
        {toolbarButton(() => exec('unlink'), <Unlink size={15} />, 'Remove link', false)}
      </div>

      {showLink && (
        <div className="rte__linkbar" role="group" aria-label="Link">
          <input
            ref={linkInputRef}
            type="url"
            className="rte__link-input"
            placeholder="https://example.com"
            value={linkUrl}
            aria-label="Link URL"
            aria-invalid={Boolean(linkError)}
            onChange={(event) => {
              setLinkUrl(event.target.value);
              if (linkError) setLinkError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setShowLink(false);
              }
            }}
          />
          <button type="button" className="rte__link-apply" onClick={applyLink} aria-label="Apply link">
            <Check size={15} />
          </button>
          <button
            type="button"
            className="rte__link-cancel"
            onClick={() => setShowLink(false)}
            aria-label="Cancel link"
          >
            <X size={15} />
          </button>
          {linkError && (
            <span className="rte__link-error" role="alert">
              {linkError}
            </span>
          )}
        </div>
      )}

      <div
        ref={editorRef}
        id={labelId}
        className="rte__editor"
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-disabled={disabled}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={handleBlur}
        onFocus={() => {
          focused.current = true;
        }}
        onPaste={handlePaste}
      />

      <div className="rte__footer">
        <span className={length > maxLength ? 'rte__count rte__count--over' : 'rte__count'}>
          {length}/{maxLength} characters
        </span>
        <span className="rte__hint">Description is public on QDN. Do not include secrets.</span>
      </div>
    </div>
  );
}
