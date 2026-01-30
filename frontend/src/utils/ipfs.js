/**
 * IPFS Utility for PrivyMarkets
 * Handles uploading and fetching market metadata
 */

const PINATA_API_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs"; // Public gateway or custom

// NOTE: In production, these should be environment variables
// For this hackathon/demo, we might ask the user to provide them or use a temporary key
const JWT = import.meta.env.VITE_PINATA_JWT;

/**
 * Uploads JSON metadata to IPFS via Pinata
 * @param {Object} metadata - The JSON object to upload
 * @returns {Promise<string>} - The IPFS CID
 */
export async function uploadToIPFS(metadata) {
  if (!JWT) {
    console.warn("Pinata JWT not found. Simulating upload.");
    // Simulate a CID for testing without API keys
    return `QmSimulated${Date.now()}`;
  }

  try {
    const response = await fetch(PINATA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JWT}`,
      },
      body: JSON.stringify({
        pinataContent: metadata,
        pinataMetadata: {
          name: `market-${Date.now()}`,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Pinata upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.IpfsHash;
  } catch (error) {
    console.error("Error uploading to IPFS:", error);
    throw error;
  }
}

/**
 * Uploads an image file to IPFS via Pinata
 * @param {File} imageFile - The image file to upload
 * @returns {Promise<string>} - The IPFS CID of the uploaded image
 */
export async function uploadImageToIPFS(imageFile) {
  if (!JWT) {
    console.warn("Pinata JWT not found. Cannot upload image.");
    return null;
  }

  try {
    const formData = new FormData();
    formData.append("file", imageFile);

    const metadata = JSON.stringify({
      name: `market-image-${Date.now()}-${imageFile.name}`,
    });
    formData.append("pinataMetadata", metadata);

    const response = await fetch(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${JWT}`,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      throw new Error(`Image upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.IpfsHash;
  } catch (error) {
    console.error("Error uploading image to IPFS:", error);
    throw error;
  }
}

/**
 * Fetches JSON metadata from IPFS
 * @param {string} cid - The IPFS CID
 * @returns {Promise<Object>} - The JSON metadata
 */
export async function fetchFromIPFS(cid) {
  if (cid.startsWith("QmSimulated")) {
    return {
      question: "Simulated Question?",
      description: "Simulated Description",
    };
  }

  try {
    const response = await fetch(`${PINATA_GATEWAY}/${cid}`);
    if (!response.ok) {
      throw new Error(`IPFS fetch failed: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching from IPFS:", error);
    return null;
  }
}
