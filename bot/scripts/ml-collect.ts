/**
 * Collects lots of chart history for training (slow: free API rate limits).
 *   npm run ml:collect -- [maxCoins=250] [pages=3] [topListPages=10]
 */
import { collectCharts } from "../src/ml/trainer.ts";
import { listArchives } from "../src/ml/candles.ts";

const [maxCoins = "250", pages = "3", topPages = "10"] = process.argv.slice(2);
const n = await collectCharts(Number(maxCoins), Number(pages), Number(topPages));
console.log(`Collected ${n} new coins; archive now has ${listArchives().length} coins.`);
process.exit(0);
