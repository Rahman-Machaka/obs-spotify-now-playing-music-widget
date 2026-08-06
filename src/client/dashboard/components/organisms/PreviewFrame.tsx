import { useEffect, useRef, useState } from "react";

export function PreviewFrame({
  src,
  width,
  height,
  title,
}: {
  src: string;
  width: number;
  height: number;
  title: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateScale = () => {
      const availableWidth = Math.max(1, stage.clientWidth - 48);
      const availableHeight = Math.max(1, stage.clientHeight - 48);
      setScale(Math.min(1, availableWidth / width, availableHeight / height));
    };
    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    updateScale();
    return () => observer.disconnect();
  }, [width, height]);

  return (
    <div className="preview-stage" ref={stageRef}>
      <div
        className="preview-viewport"
        style={{ width: width * scale, height: height * scale }}
      >
        <iframe
          title={title}
          src={src}
          style={{ width, height, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}
