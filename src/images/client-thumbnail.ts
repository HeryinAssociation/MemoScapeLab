export interface ThumbnailGeometry {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
}

export interface WebpThumbnailOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  square?: boolean;
}

export function calculateThumbnailGeometry(
  width: number,
  height: number,
  { maxWidth = 1600, maxHeight = 900, square = false }: WebpThumbnailOptions = {},
): ThumbnailGeometry {
  if (!(width > 0) || !(height > 0)) throw new Error("图片尺寸无效。");
  if (square) {
    const side = Math.min(width, height);
    const target = Math.max(1, Math.round(Math.min(maxWidth, maxHeight, side)));
    return {
      sourceX: Math.round((width - side) / 2),
      sourceY: Math.round((height - side) / 2),
      sourceWidth: side,
      sourceHeight: side,
      targetWidth: target,
      targetHeight: target,
    };
  }
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    sourceX: 0,
    sourceY: 0,
    sourceWidth: width,
    sourceHeight: height,
    targetWidth: Math.max(1, Math.round(width * scale)),
    targetHeight: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== "image/webp") {
        reject(new Error("当前浏览器无法生成 WebP 缩略图。"));
        return;
      }
      resolve(blob);
    }, "image/webp", quality);
  });
}

export async function createWebpThumbnail(
  source: Blob,
  filename: string,
  options: WebpThumbnailOptions = {},
) {
  const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  try {
    const geometry = calculateThumbnailGeometry(bitmap.width, bitmap.height, options);
    const canvas = document.createElement("canvas");
    canvas.width = geometry.targetWidth;
    canvas.height = geometry.targetHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法建立图片压缩画布。");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      geometry.sourceX,
      geometry.sourceY,
      geometry.sourceWidth,
      geometry.sourceHeight,
      0,
      0,
      geometry.targetWidth,
      geometry.targetHeight,
    );
    const blob = await canvasToWebp(canvas, options.quality ?? 0.82);
    const basename = filename.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${basename}.thumbnail.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close();
  }
}
