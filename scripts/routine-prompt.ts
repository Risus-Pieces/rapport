// Prints a Radar routine prompt. Usage: npm run routine-prompt -- research [sooz|personal,career|...] | outreach | gmail | digest
// The desktop scheduled tasks read routines/*.md; regenerate them after editing src/lib/radar/{briefs,routine}.ts.
import { buildDigestRoutinePrompt, buildGmailRoutinePrompt, buildOutreachRoutinePrompt, buildResearchRoutinePrompt } from "../src/lib/radar/routine";
import { FEEDS, isFeed } from "../src/lib/radar/types";

const [which, arg] = process.argv.slice(2);
const home = process.env.HOME_BASE || "Houston, TX";
if (which === "research") {
  const feeds = (arg ? arg.split(",") : [...FEEDS]).map((x) => x.trim());
  const bad = feeds.filter((x) => !isFeed(x));
  if (bad.length) {
    console.error(`unknown feed(s): ${bad.join(", ")}`);
    process.exit(2);
  }
  console.log(buildResearchRoutinePrompt(feeds.filter(isFeed), home));
} else if (which === "digest") {
  console.log(
    buildDigestRoutinePrompt(
      process.env.DIGEST_TO || "boxuanzhao1128@gmail.com",
      process.env.DASHBOARD_URL || "https://rapport-liard.vercel.app",
    ),
  );
} else if (which === "outreach") {
  console.log(buildOutreachRoutinePrompt({ apolloBudget: Number(process.env.APOLLO_BUDGET ?? 5) }));
} else if (which === "gmail") {
  console.log(buildGmailRoutinePrompt());
} else {
  console.error("usage: routine-prompt research [feeds] | outreach | gmail | digest");
  process.exit(2);
}
