import { describe, it, expect } from 'vitest';
import { formatPlainText } from '../src/lib/utils/format';

describe('formatPlainText', () => {
  it('should escape HTML characters', () => {
    const input = '<b>bold</b> & "quoted"';
    const output = formatPlainText(input);
    expect(output).toBe('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;');
  });

  it('should detect and format http links', () => {
    const input = 'Check this out: https://example.com/path?query=1';
    const output = formatPlainText(input);
    expect(output).toContain('<a href="https://example.com/path?query=1" target="_blank" rel="noopener noreferrer"');
    expect(output).toContain('>https://example.com/path?query=1</a>');
  });

  it('should detect and format www links', () => {
    const input = 'Visit www.google.com';
    const output = formatPlainText(input);
    expect(output).toContain('<a href="http://www.google.com" target="_blank" rel="noopener noreferrer"');
    expect(output).toContain('>www.google.com</a>');
  });

  it('should format bold text', () => {
    const input = 'This is **bold** and __also bold__';
    const output = formatPlainText(input);
    expect(output).toBe('This is <strong>bold</strong> and <strong>also bold</strong>');
  });

  it('should format italic text', () => {
    const input = 'This is *italic* and _also italic_';
    const output = formatPlainText(input);
    expect(output).toBe('This is <em>italic</em> and <em>also italic</em>');
  });

  it('should not break italic formatting inside words or URLs', () => {
    const input = 'some_variable and https://example.com/some_path';
    const output = formatPlainText(input);
    // It should format the URL first, then NOT match underscores inside the URL tag
    expect(output).toContain('<a href="https://example.com/some_path"');
    expect(output).not.toContain('<em>');
  });

  it('should format strikethrough text', () => {
    const input = 'This is ~~done~~';
    const output = formatPlainText(input);
    expect(output).toBe('This is <del>done</del>');
  });

  it('should format inline code', () => {
    const input = 'Use `npm install` to start';
    const output = formatPlainText(input);
    expect(output).toContain('<code class="bg-muted');
    expect(output).toContain('>npm install</code>');
  });

  it('should handle complex combinations', () => {
    const input = 'Check **this link**: https://example.com/ and `code`';
    const output = formatPlainText(input);
    expect(output).toContain('<strong>this link</strong>');
    expect(output).toContain('<a href="https://example.com/"');
    expect(output).toContain('>code</code>');
  });
});
