// Durable Object «Gate»: атомарные счётчики и блокировки (KV не атомарный и отстаёт между узлами до 60 с).
// Один экземпляр на имя: "runs:<день>", "global:<день>" — счётчики; "job:<id>", "ip:…", "dev:…" — блокировки.
import { DurableObject } from "cloudflare:workers";

const KEEP_MS = 2 * 86400 * 1000; // экземпляр без обращений чистит себя через 2 суток

export class Gate extends DurableObject {
  async touch() {
    await this.ctx.storage.setAlarm(Date.now() + KEEP_MS);
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }

  // +1, если не достигнут потолок. false — потолок.
  async take(cap) {
    const n = (await this.ctx.storage.get("n")) || 0;
    if (n >= cap) return false;
    await this.ctx.storage.put("n", n + 1);
    await this.touch();
    return true;
  }

  async give() {
    const n = (await this.ctx.storage.get("n")) || 0;
    await this.ctx.storage.put("n", Math.max(0, n - 1));
  }

  async value() {
    return (await this.ctx.storage.get("n")) || 0;
  }

  // Блокировка на ms. → номер версии (seq) или null, если занято.
  async lock(ms) {
    const now = Date.now();
    if (((await this.ctx.storage.get("until")) || 0) > now) return null;
    await this.ctx.storage.put("until", now + ms);
    await this.touch();
    return (await this.ctx.storage.get("seq")) || 0;
  }

  async unlock(seq) {
    await this.ctx.storage.put(seq == null ? { until: 0 } : { until: 0, seq });
  }
}

export const gate = (env, name) => env.GATE.get(env.GATE.idFromName(name));
