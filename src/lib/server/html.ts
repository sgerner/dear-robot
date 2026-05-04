import sanitizeHtml from 'sanitize-html';

const allowedTags = sanitizeHtml.defaults.allowedTags.concat([
  'img',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6'
]);

export function sanitizeEmailHtml(value: string | null | undefined) {
  if (!value) return null;
  return sanitizeHtml(value, {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel', 'style'],
      img: ['src', 'alt', 'title', 'width', 'height', 'style'],
      table: ['border', 'cellpadding', 'cellspacing', 'width', 'height', 'align', 'style'],
      thead: ['align', 'valign', 'style'],
      tbody: ['align', 'valign', 'style'],
      tfoot: ['align', 'valign', 'style'],
      tr: ['align', 'valign', 'style'],
      th: ['align', 'valign', 'width', 'height', 'colspan', 'rowspan', 'style'],
      td: ['align', 'valign', 'width', 'height', 'colspan', 'rowspan', 'style'],
      '*': ['class', 'style']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    parseStyleAttributes: true,
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb[a]?\(.+\)$/, /^oklch\(.+\)$/, /^[a-zA-Z]+$/],
        'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgb[a]?\(.+\)$/, /^oklch\(.+\)$/, /^[a-zA-Z]+$/],
        'font-family': [/^[\w\s,'"-]+$/],
        'font-size': [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
        'font-weight': [/^(normal|bold|bolder|lighter|[1-9]00)$/],
        'font-style': [/^(normal|italic|oblique)$/],
        'text-decoration': [/^(none|underline|line-through|overline)$/],
        'text-align': [/^(left|right|center|justify|start|end)$/],
        'line-height': [/^\d+(\.\d+)?(px|pt|em|rem|%)?$/],
        'letter-spacing': [/^\d+(\.\d+)?(px|pt|em|rem|%)?$/],
        margin: [/^.*$/],
        'margin-top': [/^.*$/],
        'margin-right': [/^.*$/],
        'margin-bottom': [/^.*$/],
        'margin-left': [/^.*$/],
        padding: [/^.*$/],
        'padding-top': [/^.*$/],
        'padding-right': [/^.*$/],
        'padding-bottom': [/^.*$/],
        'padding-left': [/^.*$/],
        border: [/^.*$/],
        'border-top': [/^.*$/],
        'border-right': [/^.*$/],
        'border-bottom': [/^.*$/],
        'border-left': [/^.*$/],
        'border-radius': [/^.*$/],
        display: [/^(block|inline|inline-block|flex|inline-flex|table|table-row|table-cell|none)$/],
        width: [/^.*$/],
        'min-width': [/^.*$/],
        'max-width': [/^.*$/],
        height: [/^.*$/],
        'min-height': [/^.*$/],
        'max-height': [/^.*$/],
        float: [/^(left|right|none)$/],
        'vertical-align': [/^(baseline|middle|top|bottom|sub|super)$/],
        'white-space': [/^(normal|nowrap|pre|pre-wrap|pre-line)$/]
      }
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' })
    },
    disallowedTagsMode: 'discard'
  });
}
