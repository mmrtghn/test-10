const CONFIG_URL = "config/communities.json";

export async function loadCommunityConfiguration() {
  const communityId = new URLSearchParams(window.location.search).get("community");

  if (!communityId) {
    throw new Error("No community was selected. Add a community=... parameter to the URL.");
  }

  const response = await fetch(CONFIG_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error("The community configuration could not be loaded.");
  }

  const configuration = await response.json();
  const community = configuration.communities?.[communityId];
  if (!community) {
    throw new Error(`The community “${communityId}” does not exist.`);
  }

  return { id: communityId, ...community };
}

export function getUploadSettings(community, type) {
  return community.allowedUploads?.[type] ?? {
    accept: ".png,.jpg,.jpeg,.webp,.pdf",
    label: "supported file",
    maxBytes: 8_000_000
  };
}
