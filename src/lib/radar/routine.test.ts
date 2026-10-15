import { describe, expect, it } from "vitest";
import { TASKS } from "@/lib/radar/briefs";
import { DB, buildDigestRoutinePrompt, buildOutreachRoutinePrompt, buildResearchRoutinePrompt } from "@/lib/radar/routine";

const CONN = `project_id="little-lake-33520023", branch_id="br-spring-unit-b86mju41", database_name="neondb", role_name="radar_routine"`;

describe("routine prompts", () => {
  it("point at Rapport's production database as the restricted routine role", () => {
    expect(DB).toEqual({ project: "little-lake-33520023", branch: "br-spring-unit-b86mju41", database: "neondb", role: "radar_routine" });
    for (const p of [buildResearchRoutinePrompt(["sooz"]), buildOutreachRoutinePrompt({ apolloBudget: 5, minScore: 75 }), buildDigestRoutinePrompt("boxuanzhao1128@gmail.com", "https://rapport-liard.vercel.app")]) {
      expect(p).toContain(CONN);
      expect(p).not.toContain("green-hall-60323582");
      expect(p).not.toMatch(/\boq_/);
    }
  });

  it("research: Monday covers only Sooz tasks, through rr_known_titles and rr_ingest", () => {
    const p = buildResearchRoutinePrompt(["sooz"]);
    expect(p).toMatch(/^Scheduled weekly run of the "Rapport" radar RESEARCH job \(Sooz\)\. Run it now, fully autonomously/);
    for (const t of TASKS) {
      if (t.feed === "sooz") expect(p).toContain(`Task \`${t.id}\``);
      else expect(p).not.toContain(`Task \`${t.id}\``);
    }
    expect(p).toContain("select rr_known_titles('<feed>') as titles");
    expect(p).toContain("select rr_ingest('<feed>', '<task id>', array['<kind>', ...], <true|false>, $oq$<JSON array>$oq$::jsonb) as result");
    expect(p).toContain("The ONLY SQL you may run is these two shapes");
  });

  it("research: Thursday covers Personal and Career, with context for both", () => {
    const p = buildResearchRoutinePrompt(["personal", "career"]);
    expect(p).toContain("RESEARCH job (Personal & Career)");
    expect(p).toContain("Task `career-fellowships`");
    expect(p).toContain("Task `personal-events`");
    expect(p).not.toContain("Task `sooz-angels-rice`");
    expect(p).toContain("Feed `career`");
  });

  it("research: subagents only search; the routine alone ingests; same hard rules", () => {
    const p = buildResearchRoutinePrompt(["sooz"]);
    expect(p).toContain("at most 4 at a time");
    expect(p).toContain("Subagents never call `run_sql`; you make every rr_ingest call yourself.");
    expect(p).toContain("Never send email");
    expect(p).toContain("Adults only");
  });

  it("outreach: pre-drafts strong finds, watches approved people only, never sends", () => {
    const p = buildOutreachRoutinePrompt({ apolloBudget: 5, minScore: 75 });
    for (const sql of [
      "select rr_outreach_queue(75) as added",
      "select rr_outreach_todo(8) as todo",
      "select rr_outreach_save('<radar_item_id>', $oq$<JSON object>$oq$::jsonb) as r",
      "select rr_outreach_watch() as watch",
      "select rr_outreach_observe('<radar_item_id>', '<sent|replied>', '<ISO timestamp>') as r",
    ]) expect(p).toContain(sql);
    expect(p).toMatch(/not yet approved/);
    expect(p).toMatch(/only people the owner has approved/);
    for (const purpose of ["invest", "ambassador", "buyer", "press", "intro"]) expect(p).toContain(`- ${purpose} (`);
    expect(p).toContain("at most 5 lookups this run");
    expect(p).toContain('email_source="public"');
    expect(p).toMatch(/Never offer equity/);
    expect(p).toContain("FTC endorsement rules");
    expect(p).toContain("school's NIL rules");
    expect(p).toContain("You NEVER send anything.");
    expect(p).toContain("Never call Gmail send_message");
  });

  it("digest: only to the owner, links into Rapport", () => {
    const p = buildDigestRoutinePrompt("boxuanzhao1128@gmail.com", "https://rapport-liard.vercel.app");
    expect(p).toMatch(/^Scheduled weekly run of the "Rapport" radar DIGEST job\./);
    expect(p).toContain("Send email ONLY to boxuanzhao1128@gmail.com");
    expect(p).toContain("select rr_digest_email(55, 'https://rapport-liard.vercel.app') as d");
    expect(p).toContain("select rr_mark_digested(array['<id>', ...]::uuid[])");
  });
});
