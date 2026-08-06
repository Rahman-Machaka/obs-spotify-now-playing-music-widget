/** @jsxImportSource preact */
import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Preset } from "../../../../shared/schema";
import {
  getCompensatedSpotifyLogoWidth,
  getDesignDimensions,
  getLayoutScaleLimit,
} from "../../../../shared/layout-dimensions";

export function WidgetScaler({
  layout,
  showCover,
  children,
}: {
  layout: Preset["layout"];
  showCover: boolean;
  children: ComponentChildren;
}) {
  const safeAreaRef = useRef<HTMLDivElement>(null);
  const coverMode = showCover ? "square" : "none";
  const designSize = getDesignDimensions(layout, coverMode);
  const [frame, setFrame] = useState({ scale: 1, width: designSize.width });

  useLayoutEffect(() => {
    const safeArea = safeAreaRef.current;
    if (!safeArea) return;
    const updateScale = () => {
      if (layout === "minimal") {
        const scale = Math.max(
          0.01,
          Math.min(
            getLayoutScaleLimit(layout, coverMode),
            safeArea.clientHeight / designSize.height,
          ),
        );
        setFrame({ scale, width: safeArea.clientWidth / scale });
        return;
      }
      setFrame({
        scale: Math.min(
          safeArea.clientWidth / designSize.width,
          safeArea.clientHeight / designSize.height,
        ),
        width: designSize.width,
      });
    };
    const observer = new ResizeObserver(updateScale);
    observer.observe(safeArea);
    updateScale();
    return () => observer.disconnect();
  }, [coverMode, designSize.height, designSize.width, layout]);

  const scalerStyle: JSX.CSSProperties &
    Record<"--spotify-logo-width", string> = {
    width: frame.width,
    height: designSize.height,
    transform: `scale(${frame.scale})`,
    "--spotify-logo-width": `${getCompensatedSpotifyLogoWidth(frame.scale)}px`,
  };

  return (
    <div className="widget-safe-area" ref={safeAreaRef}>
      <div className="widget-scale" style={scalerStyle}>
        {children}
      </div>
    </div>
  );
}
