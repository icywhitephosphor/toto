"use client";
// Minimal FLIP: when the order of keyed children changes, animate each element
// from its previous position to the new one (transform inversion + transition).
// Usage: const ref = useFlip(orderedKeys); items get data-flip-key attributes.
import { useLayoutEffect, useRef } from "react";

export function useFlip(orderKey: string): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = [...root.querySelectorAll<HTMLElement>("[data-flip-key]")];
    const next = new Map<string, number>();
    for (const el of els) next.set(el.dataset.flipKey!, el.getBoundingClientRect().top);

    for (const el of els) {
      const key = el.dataset.flipKey!;
      const before = prev.current.get(key);
      const after = next.get(key)!;
      if (before == null) continue;
      const dy = before - after;
      if (Math.abs(dy) < 2) continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      // Force a reflow so the inverted position paints before transitioning.
      void el.offsetHeight;
      el.style.transition = "transform 450ms cubic-bezier(.22,.9,.3,1)";
      el.style.transform = "";
      el.addEventListener(
        "transitionend",
        () => {
          el.style.transition = "";
        },
        { once: true },
      );
    }
    prev.current = next;
  }, [orderKey]);

  return ref;
}
