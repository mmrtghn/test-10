const IMAGE_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);
const IMAGE_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"]
]);
const DIMENSIONS = [2400, 2048, 1800, 1600, 1400, 1200, 900];
const QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42];
const MAX_SOURCE_DIMENSION = 8000;
const MAX_SOURCE_PIXELS = 40_000_000;

export function isCompressibleImage(file) {
  return Boolean(file && IMAGE_TYPES.has(extensionOf(file.name)));
}

export async function compressImage(file, { maxBytes = 3_000_000, accepted = "" } = {}) {
  if (!isCompressibleImage(file) || file.size <= maxBytes) {
    return { file, processed: false, failed: false };
  }

  const acceptedExtensions = new Set(String(accepted).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
  const originalExtension = extensionOf(file.name);
  const originalMime = IMAGE_TYPES.get(originalExtension);
  let source;
  let objectUrl = "";
  try {
    if (typeof createImageBitmap === "function") {
      source = await createImageBitmap(file, { imageOrientation: "from-image" });
    } else {
      objectUrl = URL.createObjectURL(file);
      source = await loadImage(objectUrl);
    }

    const sourceWidth = Number(source.width);
    const sourceHeight = Number(source.height);
    if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight > MAX_SOURCE_PIXELS || Math.max(sourceWidth, sourceHeight) > MAX_SOURCE_DIMENSION) {
      return { file, processed: false, failed: true };
    }

    const hasTransparency = originalMime === "image/png" && detectTransparency(source, sourceWidth, sourceHeight);
    const outputTypes = outputTypesFor(originalMime, hasTransparency, acceptedExtensions);
    let smallest = null;

    for (const maxDimension of DIMENSIONS) {
      const dimensions = scaledDimensions(sourceWidth, sourceHeight, maxDimension);
      const canvas = document.createElement("canvas");
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext("2d", { alpha: hasTransparency });
      if (!context) continue;
      if (!hasTransparency && outputTypes.includes("image/jpeg")) {
        context.fillStyle = "#fff";
        context.fillRect(0, 0, dimensions.width, dimensions.height);
      }
      context.drawImage(source, 0, 0, dimensions.width, dimensions.height);

      for (const type of outputTypes) {
        const qualities = type === "image/png" ? [undefined] : QUALITIES;
        for (const quality of qualities) {
          const blob = await canvasBlob(canvas, type, quality);
          if (!blob) continue;
          const candidate = makeFile(blob, file, type, acceptedExtensions);
          if (!smallest || candidate.size < smallest.size) smallest = candidate;
          if (candidate.size <= maxBytes) return { file: candidate, processed: true, failed: false };
        }
      }
    }

    return { file: smallest || file, processed: Boolean(smallest), failed: true };
  } catch {
    return { file, processed: false, failed: true };
  } finally {
    if (typeof source?.close === "function") source.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function outputTypesFor(originalMime, hasTransparency, acceptedExtensions) {
  if (hasTransparency) return acceptedExtensions.has(".png") ? ["image/png"] : [];
  const types = [];
  if (acceptedExtensions.has(".png") && originalMime === "image/png") types.push("image/png");
  if (acceptedExtensions.has(".jpg") || acceptedExtensions.has(".jpeg")) types.push("image/jpeg");
  if (acceptedExtensions.has(".webp")) types.push("image/webp");
  if (!types.length && acceptedExtensions.has(extensionForMime(originalMime))) types.push(originalMime);
  return [...new Set(types)];
}

function detectTransparency(source, width, height) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1200 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) return true;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 255) return true;
  return false;
}

function scaledDimensions(width, height, maxDimension) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function makeFile(blob, original, type, acceptedExtensions) {
  const extension = type === "image/jpeg" && acceptedExtensions.has(".jpg")
    ? ".jpg"
    : type === "image/jpeg" && acceptedExtensions.has(".jpeg")
      ? ".jpeg"
      : IMAGE_EXTENSIONS.get(type);
  const name = replaceExtension(original.name, extension);
  return new File([blob], name, { type, lastModified: original.lastModified });
}

function extensionForMime(mime) {
  return IMAGE_EXTENSIONS.get(mime) || "";
}

function replaceExtension(name, extension) {
  const text = String(name || "image");
  const dot = text.lastIndexOf(".");
  return `${dot > 0 ? text.slice(0, dot) : text}${extension}`;
}

function extensionOf(name = "") {
  const dot = String(name).lastIndexOf(".");
  return dot < 0 ? "" : String(name).slice(dot).toLowerCase();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image decoding failed."));
    image.src = url;
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
