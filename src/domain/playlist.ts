import type { ContentItem, Layout } from './package';

export type PlaylistSlide = Layout['slides'][number];

export function currentSlideAt(
  instant: Date | string | number,
  layout: Layout,
  visibleItems: ContentItem[],
): PlaylistSlide {
  const fallback: PlaylistSlide = { id: 'schedule-fallback', kind: 'schedule', durationSec: 30 };
  const at = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  if (!Number.isFinite(at)) return fallback;
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  const eligible = layout.slides.filter(
    (slide) =>
      slide.durationSec > 0 &&
      (slide.kind !== 'content' && slide.kind !== 'media' && slide.kind !== 'qr'
        ? true
        : (slide.contentIds ?? []).some((id) => visibleIds.has(id))),
  );
  if (eligible.length === 0) return fallback;
  const cycleMs = eligible.reduce((total, slide) => total + slide.durationSec * 1000, 0);
  let position = ((at % cycleMs) + cycleMs) % cycleMs;
  for (const slide of eligible) {
    const duration = slide.durationSec * 1000;
    if (position < duration) return slide;
    position -= duration;
  }
  return eligible[0] ?? fallback;
}
