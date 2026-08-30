const IMAGE_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);
const MAX_DIMENSION = 2400;

export function isCompressibleImage(file) {
  return Boolean(file && IMAGE_TYPES.has(extensionOf(file.name)));
}

export async function compressImage(file) {
  const mime = IMAGE_TYPES.get(extensionOf(file.name));
  if (!mime) return file;

  let source;
  let objectUrl = "";
  try {
    if (typeof createImageBitmap === "function") {
      source = await createImageBitmap(file, { imageOrientation: "from-image" });
    } else {
      objectUrl = URL.createObjectURL(file);
      source = await loadImage(objectUrl);
    }

    const scale = Math.min(1, MAX_DIMENSION / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: mime !== "image/jpeg" });
    if (!context) return file;
    if (mime === "image/jpeg") {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(source, 0, 0, width, height);
    const blob = await canvasBlob(canvas, mime, mime === "image/png" ? undefined : 0.82);
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name, { type: mime, lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    if (typeof source?.close === "function") source.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
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
