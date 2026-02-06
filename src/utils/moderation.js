const phiPatterns = [
  { regex: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, reason: 'Possible phone number' },
  { regex: /\b\d{3}-\d{2}-\d{4}\b/, reason: 'Possible SSN' },
  { regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, reason: 'Possible email address' },
  { regex: /\b\d{5}(?:-\d{4})?\b/, reason: 'Possible ZIP code or address fragment' },
  { regex: /\b\d{9,}\b/, reason: 'Long numeric identifier' },
];

// Dictionary-based keyword moderation (not AI)
// List of prohibited words/phrases (case-insensitive matching)
// Basic prohibited words fallback
const prohibitedWords = [
  'hate',
  'kill',
  'violence',
  'abuse',
];

// Try to load leo-profanity for a comprehensive dictionary
let leo = null;
try {
  // dynamic require so this file is resilient
  leo = require('leo-profanity');
} catch (e) {
  leo = null;
}

/**
 * Check if text contains prohibited words
 * Returns { blocked: boolean, word: string | null, reason: string }
 */
function checkForProhibitedWords(text = '') {
  const sanitized = sanitizeInput(text);
  const lower = sanitized.toLowerCase();

  // Check for prohibited words
  for (const word of prohibitedWords) {
    // Word boundary matching to avoid false positives
    const wordPattern = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (wordPattern.test(sanitized)) {
      return {
        blocked: true,
        word: word,
        reason: `Prohibited word detected: "${word}"`
      };
    }
  }

  return { blocked: false, word: null };
}

// New: simple word-list based analysis for posts (server-side)
const PROMO_WORDS = [
  'buy now', 'purchase', 'special offer', 'limited time', 'act now', 'call now', 'dm me', 'message me', 'contact me for', 'for sale', 'discount', 'deal', 'cheap', 'affordable', 'best price', 'lowest price'
];

const SPAM_WORDS = [
  'free', 'win', 'prize', 'congratulations', 'click here', 'visit', 'check out', 'link in bio', 'subscribe', 'follow for more'
];

function analyzeTextForModeration(text = '') {
  const sanitized = sanitizeInput(text);
  const lower = sanitized.toLowerCase();

  const badWordHits = leo
    ? (leo.check ? (leo.check(sanitized) ? ['profane'] : []) : [])
    : prohibitedWords.filter(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(sanitized));
  const promoHits = PROMO_WORDS.filter(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(sanitized));
  const spamHits = SPAM_WORDS.filter(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(sanitized));

  const phiDetections = [];
  for (const p of phiPatterns) {
    const m = sanitized.match(p.regex);
    if (m) {
      phiDetections.push({ type: p.reason || p.type || 'phi', matches: m });
    }
  }

  const categories = [];
  if (badWordHits.length) categories.push('bad_words');
  if (promoHits.length) categories.push('promotion');
  if (spamHits.length) categories.push('spam');
  if (phiDetections.length) categories.push('phi');

  return {
    badWordHits,
    promoHits,
    spamHits,
    phiDetections,
    categories,
    alertRequired: categories.length > 0,
  };
}

function sanitizeInput(text = '') {
  // Remove script/style blocks entirely
  let cleaned = text.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1>/gi, '');
  // Strip remaining HTML tags to mitigate XSS; keep line breaks.
  cleaned = cleaned.replace(/<[^>]*>?/g, '');
  return cleaned.trim();
}

function checkForPHI(text = '') {
  const sanitized = sanitizeInput(text);
  const lower = sanitized.toLowerCase();

  for (const pattern of phiPatterns) {
    if (pattern.regex.test(sanitized)) {
      return { blocked: true, reason: pattern.reason };
    }
  }

  // simple keyword cues for addresses / medical record mentions
  const keywords = ['street', 'st.', 'road', 'rd.', 'avenue', 'ave', 'medical record'];
  if (keywords.some((k) => lower.includes(k))) {
    return { blocked: true, reason: 'Possible address or record identifier' };
  }

  return { blocked: false };
}

module.exports = { sanitizeInput, checkForPHI, analyzeTextForModeration };
