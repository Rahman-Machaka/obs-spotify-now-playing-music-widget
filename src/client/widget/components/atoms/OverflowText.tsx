/** @jsxImportSource preact */
import { useEffect, useRef, useState } from "preact/hooks";

export function OverflowText({
  text,
  kind,
}: {
  text: string;
  kind: "title" | "artist";
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const measure = () => {
      const viewport = viewportRef.current;
      const content = textRef.current;
      if (!viewport || !content) return;
      setDistance(
        Math.max(0, Math.ceil(content.scrollWidth - viewport.clientWidth)),
      );
    };
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (textRef.current) observer.observe(textRef.current);
    void document.fonts.ready.then(measure);
    measure();
    return () => observer.disconnect();
  }, [text]);

  useEffect(() => {
    const content = textRef.current;
    if (
      !content ||
      distance <= 0 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const scrollDuration = Math.max(3000, (distance / 24) * 1000);
    const totalDuration = 10_000 + scrollDuration + 5_000 + scrollDuration;
    const animation = content.animate(
      [
        { transform: "translateX(0)", offset: 0, easing: "linear" },
        {
          transform: "translateX(0)",
          offset: 10_000 / totalDuration,
          easing: "ease-in-out",
        },
        {
          transform: `translateX(-${distance}px)`,
          offset: (10_000 + scrollDuration) / totalDuration,
          easing: "linear",
        },
        {
          transform: `translateX(-${distance}px)`,
          offset: (15_000 + scrollDuration) / totalDuration,
          easing: "ease-in-out",
        },
        { transform: "translateX(0)", offset: 1 },
      ],
      { duration: totalDuration, iterations: Infinity },
    );
    return () => animation.cancel();
  }, [distance, text]);

  const content =
    kind === "title" ? (
      <strong ref={textRef}>{text}</strong>
    ) : (
      <span ref={textRef} className="artist">
        {text}
      </span>
    );

  return (
    <div ref={viewportRef} className={`scroll-viewport ${kind}`} title={text}>
      {content}
    </div>
  );
}
