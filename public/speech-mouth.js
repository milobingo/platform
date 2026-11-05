// Lightweight visual speech for the browser voice. These are approximate
// Dutch spelling cues, not phoneme timestamps or an analysis of the audio.
const CLOSED = Object.freeze({open: 0, round: 0});
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const smooth = n => { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); };
const memo = new Map();

function soundCue(grapheme) {
  if (/^[pbm]$/.test(grapheme)) return {open: 0, round: 0, weight: .7};
  if (/^[fv]$/.test(grapheme)) return {open: .13, round: 0, weight: .8};
  if (/^(oe|oo|o|uu|u|eu)$/.test(grapheme)) return {open: .57, round: .94, weight: grapheme.length > 1 ? 1.35 : 1};
  if (/^(aa|a)$/.test(grapheme)) return {open: .96, round: .05, weight: grapheme.length > 1 ? 1.4 : 1.1};
  if (/^(ee|e|ie|i|y)$/.test(grapheme)) return {open: .57, round: .06, weight: grapheme.length > 1 ? 1.3 : .9};
  if (/^(ij|ei)$/.test(grapheme)) return {open: .76, round: .08, weight: 1.4};
  if (/^(ui|ou|au)$/.test(grapheme)) return {open: .75, round: .68, weight: 1.4};
  if (/^[w]$/.test(grapheme)) return {open: .2, round: .42, weight: .7};
  // Most consonants need little visible jaw motion; only bilabials close it.
  return {open: .22, round: .06, weight: .72};
}

function compile(text) {
  if (memo.has(text)) return memo.get(text);
  const units = [], words = [];
  let weight = 0;
  const append = (cue, start, end) => {
    units.push({...cue, start, end, at: weight});
    weight += cue.weight;
  };
  for (const token of text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|\s+|./gu)) {
    const raw = token[0], start = token.index, end = start + raw.length;
    if (/^[\p{L}\p{N}]/u.test(raw)) {
      const word = {start, end, at: weight};
      // Digraphs are consumed before single letters. This intentionally stays
      // a small spelling heuristic; Dutch schwa, stress and numbers vary.
      const normalized = raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      for (const part of normalized.matchAll(/oe|oo|uu|eu|aa|ee|ie|ij|ei|ui|ou|au|ch|ng|./gu)) {
        const cue = /^[\d]$/.test(part[0])
          ? {open: .58, round: .2, weight: 1.8}
          : soundCue(part[0]);
        append(cue, start + part.index, start + part.index + part[0].length);
      }
      word.to = weight; words.push(word);
    } else {
      const pause = /[.!?…]/u.test(raw) ? 2.8 : /[,;:]/u.test(raw) ? 1.7 : /\s/u.test(raw) ? .45 : .3;
      append({open: 0, round: 0, weight: pause}, start, end);
    }
  }
  const result = {units, words, weight};
  if (memo.size >= 16) memo.delete(memo.keys().next().value);
  memo.set(text, result);
  return result;
}

function mix(a, b, t) {
  return {open: a.open + (b.open - a.open) * t, round: a.round + (b.round - a.round) * t};
}

/**
 * Pure sampled animation: no timers and no mutation of app state.
 * Times are performance.now() milliseconds. speechDuration is an estimate.
 * A boundary restarts the current word, then extrapolates the remaining text.
 * A newer boundary corrects that estimate; end/error/stop close immediately.
 */
export function speechMouthAt(state, now) {
  if (!state?.speaking || state.stopped || !Number.isFinite(now)) return CLOSED;
  const text = typeof state.speechText === 'string' ? state.speechText : '';
  if (!/[\p{L}\p{N}]/u.test(text)) return CLOSED;
  const plan = compile(text);
  if (!plan.units.length || !plan.weight) return CLOSED;
  const speed = Number.isFinite(state.speed) ? clamp(state.speed, .5, 2) : 1;
  const duration = Number.isFinite(state.speechDuration) && state.speechDuration > 0
    ? state.speechDuration : Math.max(1500, plan.words.length * 410 / speed);
  const start = Number.isFinite(state.speechStart) ? state.speechStart : now;
  let elapsed = now - start;
  if (elapsed < 0) return CLOSED;

  const boundary = state.lastBoundary;
  const index = state.speechChar;
  if (Number.isFinite(boundary) && boundary >= start && boundary <= now &&
      Number.isFinite(index) && index >= 0 && index < text.length) {
    // charIndex can point into a word or its surrounding whitespace. Align
    // with the containing/next word rather than reading a partial word.
    const word = plan.words.find(candidate => candidate.end > index);
    if (word) elapsed = word.at / plan.weight * duration + (now - boundary);
  }
  if (elapsed >= duration) {
    // Browser voices (notably on mobile) can omit word events or speak more
    // slowly than the text estimate. Keep articulating until the real end
    // event. Text-only playback still ends at its known duration.
    if (!state.speechLive) return CLOSED;
    const overrun = elapsed - duration;
    const phase = overrun / 1000 * speed;
    const syllable = Math.pow(Math.max(0, Math.sin(phase * 16)), .8);
    const pause = Math.sin(phase * 2.9) < -.92 ? 0 : 1;
    const open = (.16 + .7 * syllable) * pause * smooth(overrun / 90);
    return {open, round: open ? .48 + .42 * Math.sin(phase * 5.3) : 0};
  }
  const position = elapsed / duration * plan.weight;
  const i = plan.units.findIndex(unit => position < unit.at + unit.weight);
  if (i < 0) return CLOSED;
  const current = plan.units[i];
  const progress = clamp((position - current.at) / current.weight, 0, 1);
  const previous = plan.units[i - 1] || CLOSED;
  const next = plan.units[i + 1] || CLOSED;
  // Continuous easing across cue boundaries leaves a held vowel/consonant
  // center, including a complete closure for p/b/m and punctuation.
  let mouth = current;
  if (progress < .25) mouth = mix(mix(previous, current, .5), current, smooth(progress / .25));
  else if (progress > .75) mouth = mix(current, mix(current, next, .5), smooth((progress - .75) / .25));
  const envelope = smooth(Math.min(elapsed / 55, (duration - elapsed) / 85));
  const open = clamp(mouth.open * envelope, 0, 1);
  return {open, round: open < .001 ? 0 : clamp(mouth.round, 0, 1)};
}
