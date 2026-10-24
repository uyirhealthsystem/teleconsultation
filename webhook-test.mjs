
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import "dotenv/config";
//import { createHash } from "node:crypto";
const secret = process.env.PAYMENT_WEBHOOK_SECRET;
// console.log(
//   "Test secret fingerprint:",
//   createHash("sha256").update(secret).digest("hex").slice(0, 12),
// );

if (!secret) {
  throw new Error("PAYMENT_WEBHOOK_SECRET is not set in this terminal");
}

const body = readFileSync("./webhook-test.json");
const timestamp = Math.floor(Date.now() / 1000).toString();

const signature = createHmac("sha256", secret)
  .update(`${timestamp}.`)
  .update(body)
  .digest("hex");

const response = await fetch(
  "http://localhost:3000/api/v1/webhooks/payments",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Timestamp": timestamp,
      "X-Payment-Signature": signature,
    },
    body,
  },
);

console.log("HTTP status:", response.status);
console.log(await response.text());
