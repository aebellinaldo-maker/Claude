/**
 * Trains the own model from the command line.
 *   npm run ml:train                 (collects charts first if the archive is small)
 *   npm run ml:train -- --collect    (always collect more charts first)
 *   npm run ml:train -- --no-collect (only use the charts already archived)
 */
import { trainModel, training } from "../src/ml/trainer.ts";

const collect = process.argv.includes("--collect") ? true : process.argv.includes("--no-collect") ? false : undefined;
await trainModel({ collect });
console.log(`Result: ${training.phase}${training.error ? ` — ${training.error}` : ""}`);
process.exit(training.phase === "done" ? 0 : 1);
