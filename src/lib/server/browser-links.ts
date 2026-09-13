import sanitizeHtml from 'sanitize-html';

/** Prioritize report actions rather than email logos, tracking links and footers. */
export function reportLinkOptions(
  links: string[],
  bodyHtml: string | null | undefined,
  from: string
) {
  const labels = new Map<string, string>();
  for (const match of String(bodyHtml || '').matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  )) {
    const label = sanitizeHtml(match[2], { allowedTags: [], allowedAttributes: {} })
      .replace(/\s+/g, ' ')
      .trim();
    if (label) labels.set(match[1].replace(/&amp;/g, '&'), label.slice(0, 120));
  }
  const options = links.map((url) => ({ url, label: labels.get(url) || new URL(url).hostname }));
  const score = (label: string) =>
    /unsubscribe|privacy|help center|learn more/i.test(label)
      ? -1
      : /download|report|dashboard|statement/i.test(label)
        ? 2
        : 0;
  options.sort((a, b) => score(b.label) - score(a.label));
  if (
    /(?:<|^)no-reply@doordash\.com(?:>|$)/i.test(from.trim()) &&
    links.some((url) => {
      const host = new URL(url).hostname;
      return host === 'doordash.com' || host.endsWith('.doordash.com');
    })
  ) {
    options.unshift({
      url: 'https://www.doordash.com/merchant/reports',
      label: 'DoorDash reports (stable dashboard link)'
    });
  }
  const hasReportLinks = options.some((option) => score(option.label) > 0);
  return options
    .filter(
      (option, index) =>
        (!hasReportLinks || score(option.label) > 0) &&
        options.findIndex((other) => other.url === option.url) === index
    )
    .slice(0, 20);
}
