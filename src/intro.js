function normalize(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[:\-_|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isIntroTitle(title) {
  const n = normalize(title);
  if (!n) return false;
  if (
    n === "op" ||
    n === "ncop" ||
    n === "intro" ||
    n === "introduction" ||
    n === "opening" ||
    n === "recap" ||
    n === "previously" ||
    n === "theme" ||
    n === "titles"
  ) {
    return true;
  }
  return /^(ncop|op|opening|intro|introduction|title sequence|main titles?|opening credits|opening theme|theme song|previously on)(\s*\d+)?(\b|$)/.test(
    n,
  );
}

function isEndingTitle(title) {
  const n = normalize(title);
  if (!n) return false;
  if (n === "ed" || n === "nced" || n === "ending" || n === "outro" || n === "credits") {
    return true;
  }
  return /^(nced|ed|ending|outro|ending theme|ending credits|credits)(\s*\d+)?(\b|$)/.test(n);
}

function normalizeChapters(chapters) {
  return (chapters || [])
    .map(function (chapter) {
      const start = chapter.start != null ? chapter.start : chapter.time;
      return {
        title: chapter.title || chapter.name || "",
        start: typeof start === "number" ? start : 0,
      };
    })
    .filter(function (chapter) {
      return !isNaN(chapter.start);
    });
}

function chapterRange(list, index, duration) {
  const chapter = list[index];
  const start = Math.max(0, chapter.start || 0);
  const next = list[index + 1];
  const end = next ? next.start : Math.min(duration || start + 90, start + 150);
  if (end - start >= 8 && end - start <= 210) {
    return { start: start, end: end };
  }
  return null;
}

function fromChapters(chapters, duration, useHeuristic) {
  const list = normalizeChapters(chapters);
  if (!list.length) return [];

  const segments = [];
  for (let i = 0; i < list.length; i++) {
    const range = chapterRange(list, i, duration);
    if (!range) continue;
    if (isIntroTitle(list[i].title)) {
      segments.push(Object.assign({ type: "intro", source: "chapter-title" }, range));
    } else if (isEndingTitle(list[i].title)) {
      const kind =
        range.start < 120 && normalize(list[i].title) === "credits" ? "intro" : "credits";
      segments.push(Object.assign({ type: kind, source: "chapter-title" }, range));
    }
  }
  if (segments.length) return segments;

  if (!useHeuristic) return [];
  const first = list[0];
  const second = list[1];
  if (!first || !second) return [];
  const start = first.start || 0;
  const end = second.start;
  const len = end - start;
  const rest = (duration || 0) - end;
  if (start <= 15 && len >= 20 && len <= 150 && rest > Math.max(240, len * 2)) {
    return [{ start: start, end: end, type: "intro", source: "chapter-heuristic" }];
  }
  return [];
}

function guessForEpisode(duration) {
  if (!duration || duration < 8 * 60) return null;
  let end = 90;
  if (duration < 25 * 60) end = 48;
  else if (duration < 45 * 60) end = 75;
  else end = 95;
  return { start: 3.5, end: end, source: "guess" };
}

function inRange(position, range, endBuffer) {
  if (!range) return false;
  const buffer = endBuffer == null ? 0.8 : endBuffer;
  return position >= range.start - 0.4 && position < range.end - buffer;
}

function findActive(segments, position, endBuffer) {
  if (!segments || !segments.length) return null;
  for (let i = 0; i < segments.length; i++) {
    if (inRange(position, segments[i], endBuffer)) return segments[i];
  }
  return null;
}

module.exports = {
  fromChapters,
  guessForEpisode,
  inRange,
  findActive,
  isIntroTitle,
  isEndingTitle,
};
