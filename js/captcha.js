import { getUploadSettings } from "./config.js";
import { compressImage, isCompressibleImage } from "./image-compression.js";

const MAX_TOTAL_UPLOAD_BYTES = 4_000_000;
const MAX_UPLOAD_BYTES = 3_000_000;
const IMAGE_TOO_LARGE = "Image is too large";
const IMAGE_TOO_LARGE_DETAIL = "We couldn't compress this image enough. Please choose a smaller image.";

async function parseResponse(response) {
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload.message || "The server could not complete that request.");
    error.code = payload.code || (response.status === 413 ? "UPLOAD_TOTAL_TOO_LARGE" : "");
    error.fields = payload.fields || {};
    throw error;
  }
  return payload;
}

export async function submitApplication({ communityId, state, onPreparing }) {
  const files = await prepareUploads(state, onPreparing);
  const formData = new FormData();
  formData.append("communityId", communityId);
  formData.append("application", JSON.stringify({ applicant: state.applicant, communityCenter: state.communityCenter, application: state.application, agreements: state.agreements }));
  if (files.experience) formData.append("experience", files.experience, files.experience.name);
  for (const [animalId, file] of Object.entries(files.animals)) if (file) formData.append(`animal_${animalId}`, file, file.name);
  return parseResponse(await fetch("/api/application", { method: "POST", body: formData, headers: { Accept: "application/json" } }));
}

async function prepareUploads(state, onPreparing) {
  const fileEntries = [];
  if (state.uploads.experience) fileEntries.push({ key: "experience", file: state.uploads.experience, type: "application" });
  for (const [animalId, file] of Object.entries(state.uploads.animals)) if (file) fileEntries.push({ key: animalId, file, type: "animal" });

  let total = fileEntries.reduce((sum, entry) => sum + entry.file.size, 0);
  if (total > MAX_TOTAL_UPLOAD_BYTES) {
    onPreparing?.("Finalizing images…");
    const images = fileEntries.filter((entry) => isCompressibleImage(entry.file)).sort((a, b) => b.file.size - a.file.size);
    for (const entry of images) {
      if (total <= MAX_TOTAL_UPLOAD_BYTES) break;
      const settings = getUploadSettings(state.community, entry.type);
      const target = Math.max(250_000, Math.min(MAX_UPLOAD_BYTES, MAX_TOTAL_UPLOAD_BYTES - (total - entry.file.size)));
      const result = await compressImage(entry.file, { maxBytes: target, accepted: settings.accept });
      if (result.file !== entry.file && result.file.size < entry.file.size) {
        total += result.file.size - entry.file.size;
        entry.file = result.file;
      }
    }
  }

  if (total > MAX_TOTAL_UPLOAD_BYTES) {
    const error = new Error("The combined upload size is too large. Please choose smaller files.");
    error.code = "UPLOAD_TOTAL_TOO_LARGE";
    throw error;
  }
  for (const entry of fileEntries) {
    const settings = getUploadSettings(state.community, entry.type);
    if (entry.file.size > Math.min(MAX_UPLOAD_BYTES, settings.maxBytes)) {
      const error = isCompressibleImage(entry.file)
        ? new Error(`${IMAGE_TOO_LARGE}: ${IMAGE_TOO_LARGE_DETAIL}`)
        : new Error(`This file is too large. Choose a file under ${Math.round(Math.min(MAX_UPLOAD_BYTES, settings.maxBytes) / 1_000_000)} MB.`);
      error.code = "UPLOAD_FILE_TOO_LARGE";
      error.image = isCompressibleImage(entry.file);
      throw error;
    }
  }

  return {
    experience: fileEntries.find((entry) => entry.key === "experience")?.file || null,
    animals: Object.fromEntries(fileEntries.filter((entry) => entry.type === "animal").map((entry) => [entry.key, entry.file]))
  };
}

export { IMAGE_TOO_LARGE, IMAGE_TOO_LARGE_DETAIL, prepareUploads };
