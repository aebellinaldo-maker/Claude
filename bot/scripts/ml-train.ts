/**
 * Trains the own model from the command line.
 *   npm run ml:train              (collects charts first if the archive is small)
 *   npm run ml:train -- --collect (always collect more charts first)
 */
import { trainModel, training } from "../src/ml/trainer.ts";

await trainModel({ collect: process.argv.includes("--collect") });
console.log(`Result: ${training.phase}${training.error ? ` — ${training.error}` : ""}`);
process.exit(training.phase === "done" ? 0 : 1);
