import { Composition } from "remotion";
import Slideshow from "./Slideshow";
import type { SlideshowProps } from "./Slideshow";
import { DIMENSIONS, FPS } from "../src/video/types";

/**
 * Remotion 根注册。尺寸/时长由 calculateMetadata 根据 inputProps 动态计算，
 * 支持 16:9 与 9:16 两种规格。
 */
const AnySlideshow = Slideshow as unknown as React.FC<Record<string, unknown>>;

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Slideshow"
    component={AnySlideshow}
    durationInFrames={300}
    fps={FPS}
    width={DIMENSIONS.landscape.width}
    height={DIMENSIONS.landscape.height}
    defaultProps={{
      title: "示例标题",
      tags: [],
      orientation: "landscape",
      scenes: [
        {
          heading: "示例",
          bullets: [],
          narration: "示例",
          audioFile: "",
          durationFrames: 300,
        },
      ],
    }}
    calculateMetadata={({ props }) => {
      const p = props as unknown as SlideshowProps;
      return {
        durationInFrames: Math.max(
          90,
          p.scenes.reduce((sum: number, s) => sum + s.durationFrames, 0)
        ),
        fps: FPS,
        width: DIMENSIONS[p.orientation].width,
        height: DIMENSIONS[p.orientation].height,
      };
    }}
  />
);
