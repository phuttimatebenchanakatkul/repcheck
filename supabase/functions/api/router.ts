/** Every route of the API, in one table. A slice adds its module here. */
import { Router } from "../_shared/app.ts";
import { register as account } from "./routes/account.ts";
import { register as chat } from "./routes/chat.ts";
import { register as consent } from "./routes/consent.ts";
import { register as health } from "./routes/health.ts";
import { register as legacy } from "./routes/legacy.ts";
import { register as photos } from "./routes/photos.ts";
import { register as social } from "./routes/social.ts";

export function buildRouter(): Router {
  const router = new Router();
  for (const register of [health, account, consent, photos, legacy, social, chat]) register(router);
  return router;
}
