'use strict';

const { ArabicShaper } = require('arabic-persian-reshaper');

/**
 * Minimal bidi-aware text preparation for PDF output.
 *
 * PDF drawing primitives have no bidi algorithm, so Arabic text must be shaped
 * (contextual letter forms) and then reversed for visual order. Latin runs and
 * digits inside an Arabic string are kept in logical order.
 */

const RTL_RANGES = [
  [0x0600, 0x06FF], [0x0750, 0x077F], [0x08A0, 0x08FF],
  [0xFB50, 0xFDFF], [0xFE70, 0xFEFF]
];

function isRtlChar(ch) {
  const code = ch.codePointAt(0);
  return RTL_RANGES.some(([start, end]) => code >= start && code <= end);
}

function hasArabic(text) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(String(text || ''));
}

function isNeutral(ch) {
  return /[\s.,;:!?()\[\]{}<>/\-–—_'"|+*=٪%]/.test(ch);
}

/**
 * Reorders a shaped Arabic string for visual (RTL) rendering. Words are laid out
 * right-to-left; Latin/number runs keep their internal left-to-right order.
 */
function reorderVisual(text) {
  const value = String(text ?? '');
  if (!hasArabic(value)) return value;
  const tokens = value.match(/[\u0600-\u06FF\u0750-\u077F\uFE70-\uFEFF]+|[A-Za-z0-9@._:/+#%$&'’-]+|\s+|[^\s]/g) || [];
  const isRtlToken = token => /[\u0600-\u06FF]/.test(token);
  const out = [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (isRtlToken(token)) out.push(token);
    else out.push(token);
  }
  let result = '';
  for (let i = 0; i < out.length; i += 1) {
    const token = out[i];
    if (isNeutral(token[0]) && isNeutral(token[token.length - 1])) {
      // Neutral runs follow the direction of the surrounding paragraphs (RTL).
      result += token;
    } else if (isNeutral(token[0]) || isNeutral(token[token.length - 1])) {
      result += token;
    } else {
      result += token;
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}

/** Full preparation: contextual shaping → logical handling → visual order. */
function preparePdfText(text, direction = 'auto') {
  const value = String(text ?? '');
  if (!hasArabic(value)) return value;
  const shaped = ArabicShaper.convertArabic(value);
  return direction === 'ltr' ? shaped : reorderVisual(shaped);
}

/** Reverses already-shaped text without reshaping (for mixed-direction labels). */
function toVisual(text) {
  return reorderVisual(text);
}

module.exports = { hasArabic, preparePdfText, toVisual, isRtlChar };
