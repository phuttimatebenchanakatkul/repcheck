/** Every route of the API, in one table. A slice adds its module here. */
import { Router } from "../_shared/app.ts";
import { register as consent } from "./routes/consent.ts";
import { register as health } from "./routes/health.ts";

export function buildRouter(): Router {
  const router = new Router();
  for (const register of [health, consent]) register(router);
  return router;
}
