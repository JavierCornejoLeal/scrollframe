/**
 * Stretches `container` across the page whatever the width of the element it is in, and keeps it
 * there when the page changes: a window resize, a scrollbar that appears once the content grows,
 * or a parent that changes size. Returns a function that stops and restores the container's own
 * styles (only if the width is still the one set here: a framework may already have set the next).
 *
 * CSS alone cannot do it: 100vw counts the scrollbar, and the parent may be off-centre. Width and
 * margins add up to the parent's own width, so nothing depends on how it aligns its children
 * (moving it with `left` left its original box scrollable sideways in Firefox).
 */
export function spanPage(container: HTMLElement): () => void {
  const { style } = container;
  const own = { width: style.width, marginLeft: style.marginLeft, marginRight: style.marginRight };
  let applied = "";

  // An inline host (Angular's component tag) has no width of its own.
  const parentBox = (): HTMLElement | null => {
    let parent = container.parentElement;
    while (parent && ["inline", "contents"].includes(getComputedStyle(parent).display)) parent = parent.parentElement;
    return parent;
  };

  const apply = (): void => {
    const pageWidth = document.documentElement.clientWidth;
    if (!pageWidth) return;
    const parent = parentBox();
    let start = 0;
    let room = pageWidth;
    if (parent) {
      const { paddingLeft, paddingRight } = getComputedStyle(parent);
      const padding = parseFloat(paddingLeft) || 0;
      start = parent.getBoundingClientRect().left + (window.scrollX || 0) + (parent.clientLeft || 0) + padding;
      room = parent.clientWidth - padding - (parseFloat(paddingRight) || 0);
    }
    const place = (marginLeft: number): void => {
      style.marginLeft = `${-marginLeft}px`;
      style.marginRight = `${room - pageWidth + marginLeft}px`;
    };
    style.width = `${pageWidth}px`;
    applied = style.width;
    place(start);
    // What the parent's box does not explain, e.g. a later grid column.
    const off = container.getBoundingClientRect().left + (window.scrollX || 0);
    if (Math.abs(off) >= 0.5) place(start + off);
  };

  apply();
  window.addEventListener("resize", apply);
  // The page's own box narrows when a scrollbar appears; no resize event says so.
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => apply()) : null;
  observer?.observe(document.documentElement);
  const parent = parentBox();
  if (parent) observer?.observe(parent);

  return () => {
    window.removeEventListener("resize", apply);
    observer?.disconnect();
    if (applied && style.width === applied) Object.assign(style, own);
  };
}
