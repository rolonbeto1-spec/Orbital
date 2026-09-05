"use client";

import { useEffect, useRef, useState } from "react";

// Animates a number toward its new value with a cubic ease — used for the
// headline money figures so they roll in instead of popping.
export function CountUp({
  value,
  format,
  duration = 750,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const delta = value - from;
    if (Math.abs(delta) < 0.01) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + delta * eased);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration]);

  return <>{format(display)}</>;
}
