/** @jsxImportSource preact */
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export function Visualizer({ playing }: { playing: boolean }) {
  const visualizerRef = useRef<HTMLSpanElement>(null);
  const [barCount, setBarCount] = useState(10);

  useEffect(() => {
    const visualizer = visualizerRef.current;
    if (!visualizer) return;
    const updateBarCount = () => {
      const visualizerStyle = getComputedStyle(visualizer);
      const firstBar = visualizer.querySelector("i");
      const barWidth = firstBar
        ? Number.parseFloat(getComputedStyle(firstBar).width)
        : 4;
      const gap = Number.parseFloat(visualizerStyle.columnGap) || 0;
      const availableBars = Math.floor(
        (visualizer.clientWidth + gap) / Math.max(1, barWidth + gap),
      );
      setBarCount(Math.max(5, Math.min(32, availableBars)));
    };
    const observer = new ResizeObserver(updateBarCount);
    observer.observe(visualizer);
    updateBarCount();
    return () => observer.disconnect();
  }, []);

  return (
    <span
      ref={visualizerRef}
      className={`visualizer ${playing ? "playing" : ""}`}
    >
      {Array.from({ length: barCount }, (_, bar) => (
        <i key={bar} style={{ "--bar-index": bar } as JSX.CSSProperties} />
      ))}
    </span>
  );
}
