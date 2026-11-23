// Synchros planifiées (heure du serveur, UTC) : avis Google chaque nuit, photos Instagram chaque lundi.
import type { Ctx } from "./shared";
import { syncGoogle } from "./google";
import { syncInstagram } from "./instagram";

export default ({ schedule }: { schedule: (cron: string, fn: () => unknown) => void }, context: unknown) => {
  const ctx = context as unknown as Ctx;
  schedule("0 3 * * *", () => syncGoogle(ctx));
  schedule("0 4 * * 1", () => syncInstagram(ctx));
};
