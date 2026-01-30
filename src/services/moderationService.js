let isValidPhoneNumber;
let validator;
let profanityFilter;

try {
  const libphonenumber = require('libphonenumber-js');
  isValidPhoneNumber = libphonenumber.isValidPhoneNumber;
} catch (e) {
  // Fallback: simple phone validation
  isValidPhoneNumber = (phone) => /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(phone);
}

try {
  validator = require('validator');
} catch (e) {
  validator = null;
}


try {
  const Filter = require('bad-words');
  profanityFilter = new Filter();

} catch (e) {
  // Fallback: basic check (should not happen if package is installed)
  console.warn('bad-words package not found. Please install: npm install bad-words');
  profanityFilter = {
    isProfane: (text) => {
      if (!text || typeof text !== 'string') return false;
      // Basic fallback - but library should be installed
      const basicProfanity = ['fuck', 'shit', 'damn', 'ass', 'bitch', 'sex', 'porn'];
      const lower = text.toLowerCase();
      return basicProfanity.some(word => {
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordPattern = new RegExp(`\\b${escapedWord}\\b`, 'i');
        return wordPattern.test(lower);
      });
    },
  };
}


// PHI patterns
const PHI_PATTERNS = [
  { regex: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, type: 'phone', weight: 0.8 },
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, type: 'ssn', weight: 1.0 },
  { regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, type: 'email', weight: 0.6 },
  { regex: /\b\d{5}(?:-\d{4})?\b/g, type: 'zip', weight: 0.5 },
  { regex: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, type: 'date', weight: 0.4 },
  { regex: /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?)\s+[\w\s]+\d+/gi, type: 'address', weight: 0.7 },
  { regex: /\b(?:medical record|patient id|mrn|medical record number)\s*:?\s*\d+/gi, type: 'medical_record', weight: 0.9 },
];

// Sales pitch keywords
const SALES_KEYWORDS = [
  'buy now', 'purchase', 'special offer', 'limited time', 'act now',
  'call now', 'dm me', 'message me', 'contact me for', 'for sale',
  'discount', 'deal', 'cheap', 'affordable', 'best price', 'lowest price',
];

// Spam indicators
const SPAM_PATTERNS = [
  { regex: /(.)\1{4,}/g, type: 'repeated_chars', weight: 0.3 }, // Repeated characters
  { regex: /\b(?:click here|visit|check out|link in bio)\s+https?:\/\//gi, type: 'link_spam', weight: 0.7 },
  { regex: /(?:www\.|http)/gi, type: 'urls', weight: 0.5 },
  { regex: /\b(free|win|prize|congratulations)\s+(?:click|visit|call)/gi, type: 'scam_keywords', weight: 0.8 },
];

/**
 * Detect PHI in text
 */
function detectPHI(text) {
  const detections = [];
  let phiScore = 0;

  for (const pattern of PHI_PATTERNS) {
    const matches = text.match(pattern.regex);
    if (matches) {
      detections.push({
        type: pattern.type,
        matches: matches,
        weight: pattern.weight,
      });
      phiScore += pattern.weight * matches.length;
    }
  }

  // Additional phone number validation using libphonenumber
  try {
    const phoneMatches = text.match(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g);
    if (phoneMatches) {
      for (const phone of phoneMatches) {
        try {
          if (isValidPhoneNumber(phone, 'US')) {
            detections.push({
              type: 'validated_phone',
              matches: [phone],
              weight: 0.9,
            });
            phiScore += 0.9;
          }
        } catch (e) {
          // Invalid phone number format
        }
      }
    }
  } catch (e) {
    // Skip phone validation on error
  }

  return {
    score: Math.min(phiScore, 1.0), // Cap at 1.0
    detections,
  };
}

/**
 * Detect sales pitch content
 */
function detectSalesPitch(text) {
  const lowerText = text.toLowerCase();
  let salesScore = 0;
  const matches = [];

  for (const keyword of SALES_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      matches.push(keyword);
      salesScore += 0.2;
    }
  }

  return {
    score: Math.min(salesScore, 1.0),
    matches,
  };
}

/**
 * Detect spam patterns
 */
function detectSpam(text) {
  let spamScore = 0;
  const detections = [];

  for (const pattern of SPAM_PATTERNS) {
    const matches = text.match(pattern.regex);
    if (matches) {
      detections.push({
        type: pattern.type,
        matches: matches.length,
      });
      spamScore += pattern.weight * Math.min(matches.length, 3); // Cap contribution
    }
  }

  return {
    score: Math.min(spamScore, 1.0),
    detections,
  };
}

/**
 * Detect URLs and links
 */
function detectLinks(text) {
  const urls = text.match(/https?:\/\/[^\s]+/gi) || [];
  const domains = text.match(/\b(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}/gi) || [];

  let linkRiskScore = 0;

  // URLs are riskier than just domains
  linkRiskScore += urls.length * 0.3;
  linkRiskScore += domains.length * 0.1;

  // Check for suspicious domains
  const suspiciousDomains = ['bit.ly', 'tinyurl', 't.co', 'goo.gl'];
  const hasSuspicious = urls.some(url => suspiciousDomains.some(dom => url.includes(dom)));
  if (hasSuspicious) {
    linkRiskScore += 0.4;
  }

  return {
    score: Math.min(linkRiskScore, 1.0),
    urls: urls.length,
    domains: domains.length,
  };
}

/**
 * Normalize text to detect obfuscated profanity
 * Removes spaces, special characters, and common bypass techniques
 */
function normalizeTextForDetection(text) {
  if (!text || typeof text !== 'string') return '';

  // Convert to lowercase
  let normalized = text.toLowerCase();

  // Remove all spaces, dashes, underscores, dots, and other separators
  normalized = normalized.replace(/[\s\-_\.\*\+\#\@\!]/g, '');

  // Replace common leet speak characters
  normalized = normalized.replace(/0/g, 'o');
  normalized = normalized.replace(/1/g, 'i');
  normalized = normalized.replace(/3/g, 'e');
  normalized = normalized.replace(/4/g, 'a');
  normalized = normalized.replace(/5/g, 's');
  normalized = normalized.replace(/7/g, 't');
  normalized = normalized.replace(/8/g, 'b');
  normalized = normalized.replace(/9/g, 'g');
  normalized = normalized.replace(/\$/g, 's');
  normalized = normalized.replace(/\!/g, 'i');
  normalized = normalized.replace(/\@/g, 'a');

  // Remove repeated characters (e.g., "fuuuck" -> "fuck")
  normalized = normalized.replace(/(.)\1{2,}/g, '$1$1');

  return normalized;
}

/**
 * Check for profanity patterns in normalized text
 * Uses smart matching to catch obfuscated profanity
 */
function checkProfanityPatterns(normalizedText) {
  if (!normalizedText || normalizedText.length < 2) return false;

  // Comprehensive list of profanity patterns (normalized forms)
  // Ordered by length (longer patterns first to avoid partial matches)
  const profanityPatterns = [
    // 4+ letter words
    'masturbat', 'mastrbat', 'mstrbat',
    'nigger', 'nigga', 'niga', 'ngga', 'nger',
    'bastard', 'bastrd', 'bstrd',
    'violence', 'vlnce', 'violnc',
    'suicide', 'suicid', 'sucide',
    'murder', 'murdr', 'mrdr',
    'orgasm', 'orgsm', 'orgas',
    'erotic', 'erotc', 'erotik',
    'porn', 'prn', 'p0rn', 'pornn',
    'naked', 'nakd', 'nked',
    'retard', 'retrd', 'rtard', 'retad',
    'bitch', 'bich', 'bitchh', 'btch',
    'pussy', 'puss', 'pusy', 'pssy',
    'whore', 'whor', 'hore', 'whoar',
    'abuse', 'abus', 'abse',
    'stupid', 'stpid', 'stupd',
    'idiot', 'idot', 'idit',
    'moron', 'mron', 'morrn',
    // 3-4 letter words
    'fuck', 'fuk', 'fcuk', 'fuc', 'fuq',
    'shit', 'sht', 'shyt', 'shitt',
    'damn', 'damm', 'dam',
    'crap', 'crp', 'krap',
    'piss', 'pis', 'pss',
    'dick', 'dik', 'dck', 'dic',
    'cock', 'cok', 'kok', 'cokc',
    'cunt', 'cnt', 'kunt',
    'slut', 'slt', 'slutt',
    'nude', 'nud', 'nudee',
    'kill', 'kil', 'kll',
    'hate', 'hat', 'hte',
    'rape', 'rap', 'rpe',
    'dumb', 'dmb', 'dum',
    // 2-3 letter words (be careful with these)
    'ass', 'arse', // 'as' removed to avoid false positives
    'sex', 'sx', 'sexx', 'seks',
  ];

  // Check if any pattern exists in normalized text
  // Use smart matching: check if pattern appears as standalone or with minimal context
  for (const pattern of profanityPatterns) {
    if (pattern.length < 2) continue;

    const index = normalizedText.indexOf(pattern);
    if (index !== -1) {
      // Check if it's at word boundary or standalone
      const before = index > 0 ? normalizedText[index - 1] : '';
      const after = index + pattern.length < normalizedText.length
        ? normalizedText[index + pattern.length]
        : '';

      // Allow if it's at start/end or surrounded by non-alphabetic chars
      // This catches: "fuck", "f-u-c-k", "f u c k" (normalized)
      if (index === 0 ||
        index + pattern.length === normalizedText.length ||
        !/[a-z0-9]/.test(before) ||
        !/[a-z0-9]/.test(after)) {
        return true;
      }

      // For short patterns (2-3 chars), be more strict
      if (pattern.length <= 3) {
        // Only match if it's clearly standalone (not part of longer word)
        const context = normalizedText.substring(Math.max(0, index - 2), Math.min(normalizedText.length, index + pattern.length + 2));
        // If pattern is at word boundary in context, it's likely profanity
        if (context === pattern ||
          context.startsWith(pattern) && !/[a-z0-9]/.test(context[pattern.length]) ||
          context.endsWith(pattern) && !/[a-z0-9]/.test(context[context.length - pattern.length - 1])) {
          return true;
        }
      } else {
        // For longer patterns, if found, likely profanity
        return true;
      }
    }
  }

  return false;
}

/**
 * Detect profanity/toxicity with comprehensive bypass detection
 * Handles: spaced words (f u c k), special chars (f*ck), leet speak (f0ck), etc.
 */
function detectToxicity(text) {
  if (!text || typeof text !== 'string') {
    return { score: 0, isProfane: false };
  }

  // Method 1: Use the bad-words library (if available)
  let isProfane = false;
  try {
    isProfane = profanityFilter.isProfane(text);
  } catch (e) {
    // Library not available or error
  }

  // Method 2: Normalize text and check for obfuscated profanity
  const normalizedText = normalizeTextForDetection(text);
  const hasObfuscatedProfanity = checkProfanityPatterns(normalizedText);

  // Method 3: Check original text for common profanity words (word boundaries)
  const lowerText = text.toLowerCase();
  const commonProfanity = ['fuck', 'shit', 'damn', 'ass', 'bitch', 'sex', 'porn', 'kill', 'hate', 'abuse'];
  const hasDirectProfanity = commonProfanity.some(word => {
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordPattern = new RegExp(`\\b${escapedWord}\\b`, 'i');
    return wordPattern.test(lowerText);
  });

  // If ANY method detects profanity, reject it
  if (isProfane || hasObfuscatedProfanity || hasDirectProfanity) {
    return {
      score: 1.0, // Maximum score - will result in REJECT
      isProfane: true,
    };
  }

  return {
    score: 0,
    isProfane: false,
  };
}

/**
 * Get user trust score (placeholder - should be calculated from user history)
 */
async function getUserTrustScore(userId) {
  // TODO: Calculate from user history, quarantine count, etc.
  // For MVP, return default trust score
  const User = require('../models/User');
  try {
    const user = await User.findById(userId);

    // Default trust score
    let trustScore = 0.7;

    // Adjust based on user age (older accounts more trusted)
    if (user?.createdAt) {
      const accountAgeDays = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (accountAgeDays > 30) trustScore += 0.1;
      if (accountAgeDays > 90) trustScore += 0.1;
    }

    // Check quarantine count (would need to track this)
    // For now, default trust

    return Math.min(trustScore, 1.0);
  } catch (e) {
    return 0.5; // Default if error
  }
}

/**
 * Main moderation scan function
 */
async function scan({ text, userId, context = {} }) {
  if (!text || typeof text !== 'string') {
    return {
      status: 'REJECT',
      scores: {
        phi_score: 0,
        spam_score: 0,
        sales_pitch_score: 0,
        toxicity_score: 0,
        link_risk_score: 0,
        user_trust_score: 0,
      },
      flags: [],
      detectedSpans: [],
      reason: 'Invalid input',
    };
  }

  // Calculate all scores
  const phiResult = detectPHI(text);
  const salesResult = detectSalesPitch(text);
  const spamResult = detectSpam(text);
  const linkResult = detectLinks(text);
  const toxicityResult = detectToxicity(text);
  const userTrustScore = userId ? await getUserTrustScore(userId) : 0.5;

  const scores = {
    phi_score: phiResult.score,
    spam_score: spamResult.score,
    sales_pitch_score: salesResult.score,
    toxicity_score: toxicityResult.score,
    link_risk_score: linkResult.score,
    user_trust_score: userTrustScore,
  };

  // Collect detected text spans
  const detectedSpans = [];

  phiResult.detections.forEach(det => {
    det.matches.forEach(match => {
      detectedSpans.push({
        text: match,
        type: 'phi',
        subtype: det.type,
        start: text.indexOf(match),
        end: text.indexOf(match) + match.length,
      });
    });
  });

  // Determine flags
  const flags = [];
  if (scores.phi_score > 0.3) flags.push('phi_detected');
  if (scores.spam_score > 0.5) flags.push('spam_detected');
  if (scores.sales_pitch_score > 0.6) flags.push('sales_pitch');
  if (scores.toxicity_score > 0) flags.push('toxicity'); // Any profanity detected
  if (scores.link_risk_score > 0.6) flags.push('suspicious_links');

  // Determine status based on scores and rules
  let status = 'ALLOW';

  // ANY profanity/toxicity detected → REJECT immediately
  if (scores.toxicity_score > 0) {
    status = 'REJECT';
  }
  // High PHI score → QUARANTINE
  else if (scores.phi_score > 0.5) {
    status = 'QUARANTINE';
  }
  // High sales pitch + low trust → REJECT
  else if (scores.sales_pitch_score > 0.7 && scores.user_trust_score < 0.5) {
    status = 'REJECT';
  }
  // High spam score → QUARANTINE
  else if (scores.spam_score > 0.7) {
    status = 'QUARANTINE';
  }
  // Multiple risk factors → QUARANTINE
  else if (
    (scores.phi_score > 0.2 && scores.link_risk_score > 0.4) ||
    (scores.spam_score > 0.4 && scores.sales_pitch_score > 0.5)
  ) {
    status = 'QUARANTINE';
  }
  // Moderate risks → SOFT_BLOCK
  else if (
    scores.phi_score > 0.2 ||
    scores.spam_score > 0.3 ||
    scores.link_risk_score > 0.5
  ) {
    status = 'SOFT_BLOCK';
  }

  return {
    status,
    scores,
    flags,
    detectedSpans,
    timestamp: new Date().toISOString(),
    context,
  };
}

module.exports = {
  scan,
  detectPHI,
  detectSalesPitch,
  detectSpam,
  detectLinks,
  detectToxicity,
  getUserTrustScore,
};

