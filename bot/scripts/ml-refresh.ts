/**
 * Extends every archived chart with the candles since it was last updated (the days the
 * bot has been running = forward data, free of survivorship bias), then adds new coins.
 *   npm run ml:refresh -- [maxNewCoins=150]
 */
import { collectCharts } from "../src/ml/trainer.ts";
import { listArchives, loadArchive, updateArchive } from "../src/ml/candles.ts";

const maxNew = Number(process.argv[2] ?? "150");
const ids = listArchives();
let extended = 0;
let added = 0;
for (const id of ids) {
  const a = loadArchive(id);
  if (!a) continue;
  const before = a.candles.length;
  const after = (await updateArchive({ pool: a.pool, mint: a.mint, symbol: a.symbol, createdAt: a.createdAt }))?.candles.length ?? before;
  if (after > before) {
    extended++;
    added += after - before;
  }
}
console.log(`Extended ${extended}/${ids.length} charts with ${added} new candles.`);
const n = await collectCharts(maxNew, 3, 10);
console.log(`Collected ${n} new coins; archive now has ${listArchives().length} coins.`);
process.exit(0);
