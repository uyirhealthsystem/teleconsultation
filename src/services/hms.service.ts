
import { SDK } from "@100mslive/server-sdk";

const accessKey = process.env.HMS_ACCESS_KEY;
const appSecret = process.env.HMS_SECRET;

if (!accessKey || !appSecret) {
  throw new Error(
    "Missing HMS_ACCESS_KEY or HMS_SECRET environment variable",
  );
}

export const hms = new SDK(accessKey, appSecret);
