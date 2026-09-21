import { handleSnookerV1 } from "../src/server/snooker-v1.js";

export default async function handler(req, res) {
  return handleSnookerV1(req, res, req.query?.path || "");
}
