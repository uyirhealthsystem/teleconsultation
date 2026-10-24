
import "dotenv/config";
import axios from "axios";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

const accessKey = process.env.HMS_ACCESS_KEY;
const secret = process.env.HMS_SECRET;
const templateId = process.env.HMS_TEMPLATE_ID;

async function createTestRoom(): Promise<void> {
  if (!accessKey || !secret || !templateId) {
    throw new Error(
      "Missing HMS_ACCESS_KEY, HMS_SECRET, or HMS_TEMPLATE_ID in .env",
    );
  }

  // Generate the management JWT locally.
  const now = Math.floor(Date.now() / 1000);

  const managementToken = jwt.sign(
    {
      access_key: accessKey,
      type: "management",
      version: 2,
      jti: randomUUID(),
      iat: now,
      nbf: now,
    },
    secret,
    {
      algorithm: "HS256",
      expiresIn: "24h",
    },
  );

  console.log("Management token generated.");

  // Create a room using the 100ms REST API.
  try {
    const response = await axios.post(
      "https://api.100ms.live/v2/rooms",
      {
        name: `test-consultation-${Date.now()}`,
        description: "Dummy teleconsultation room",
        template_id: templateId,
      },
      {
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    console.log("Room created successfully!");
    console.log("Room ID:", response.data.id);
    console.log("Room name:", response.data.name);
    console.log("Room enabled:", response.data.enabled);
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error("Room creation failed.");
      console.error("HTTP status:", error.response?.status);
      console.error(
        "Response:",
        error.response?.data ?? error.message,
      );
      return;
    }

    throw error;
  }
}

createTestRoom().catch((error: unknown) => {
  console.error(
    "Unexpected error:",
    error instanceof Error ? error.message : error,
  );
});
