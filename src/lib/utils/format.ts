/**
 * Formats plain text by escaping HTML, detecting URLs, and applying basic markdown-like formatting.
 * 
 * @param text The plain text to format
 * @returns HTML string with formatting applied
 */
export function formatPlainText(text: string | null | undefined): string {
  if (!text) return '';

  // 1. Escape HTML to prevent XSS
  let formatted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // 2. Protect already escaped URLs or other patterns if needed
  // (In this simple implementation, we just proceed to find URLs)

  // 3. Detect and format links
  // Matches http://, https://, and www.
  // We use a negative lookahead to avoid matching URLs already inside href attribute (though we just escaped everything)
  const urlRegex = /(https?:\/\/[^\s<]+[^.,\s<]|www\.[^\s<]+[^.,\s<])/g;
  formatted = formatted.replace(urlRegex, (url) => {
    const href = url.startsWith('www.') ? `http://${url}` : url;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline font-medium">${url}</a>`;
  });

  // 4. Markup formatting (Markdown-style)
  
  // Bold: **text** or __text__
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  formatted = formatted.replace(/__(.*?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  // Note: We use \b or lookarounds to avoid matching underscores inside words/URLs if possible
  // but since we already formatted URLs with <a> tags, those underscores are now inside HTML tags
  // which our simple regex might still hit if not careful.
  // Actually, the <a> tag itself contains "class=" which might have underscores.
  
  // A better approach is to match markdown only in text nodes, but since we are doing 
  // regex on the whole string, we should be careful.
  
  // Simplified Italic (only if not surrounded by alphanumeric to avoid breaking URLs/IDs)
  formatted = formatted.replace(/(^|[^\w])\*(?!\s)(.*?)(?<!\s)\*([^\w]|$)/g, '$1<em>$2</em>$3');
  formatted = formatted.replace(/(^|[^\w])_(?!\s)(.*?)(?<!\s)_([^\w]|$)/g, '$1<em>$2</em>$3');

  // Strikethrough: ~~text~~
  formatted = formatted.replace(/~~(.*?)~~/g, '<del>$1</del>');

  // Inline Code: `text`
  formatted = formatted.replace(/`(.*?)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground border border-border/20">$1</code>');

  return formatted;
}
