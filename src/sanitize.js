// Note HTML that did not come from the editor (Evernote imports, backups, anything shown via
// innerHTML) goes through here. It keeps what notes use — formatting, tables, images, task
// attributes, att:/blob: references, YouTube embeds — and drops anything that can run code.
import DOMPurify from 'dompurify';

const YOUTUBE_EMBED = /^https:\/\/(www\.)?(youtube-nocookie\.com|youtube\.com)\/embed\//;

// Default list plus techo's own att: (attachment) and blob: (resolved attachment) schemes.
const ALLOWED_URI = /^(?:(?:https?|mailto|tel|att|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const purifier = DOMPurify();
purifier.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'iframe' && !YOUTUBE_EMBED.test(node.getAttribute('src') || '')) node.remove();
});

// <input> stays: saved task items carry their checkbox, and with event attributes stripped
// an input cannot run anything.
const CONFIG = {
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allowfullscreen', 'target', 'contenteditable', 'draggable', 'checked'],
  FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'object', 'embed', 'base', 'meta', 'link'],
  ALLOWED_URI_REGEXP: ALLOWED_URI,
};

export const sanitizeHtml = html => purifier.sanitize(html || '', CONFIG);
