import { describe, expect, it } from "vitest";
import { TASKS } from "@/lib/radar/briefs";
import { DB, buildDigestRoutinePrompt, buildGmailRoutinePrompt, buildOutreachRoutinePrompt, buildResearchRoutinePrompt } from "@/lib/radar/routine";

const CONN = `project_id="little-lake-33520023", branch_id="br-spring-unit-b86mju41", database_name="neondb", role_name="radar_routine"`;

describe("routine prompts", () => {
  it("point at Rapport's production database as the restricted routine role", () => {
    expect(DB).toEqual({ project: "little-lake-33520023", branch: "br-spring-unit-b86mju41", database: "neondb", role: "radar_routine" });
    for (const p of [buildResearchRoutinePrompt(["sooz"]), buildOutreachRoutinePrompt({ apolloBudget: 5 }), buildDigestRoutinePrompt("boxuanzhao1128@gmail.com", "https://rapport-liard.vercel.app")]) {
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
    expect(p).toMatch(/People you submit go straight into the owner's CRM as To reach out/);
    expect(p).toContain("added_to_crm");
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

  it("outreach (Monday): builds the shortlist, drafts it, then updates and launch asks — and never touches Gmail", () => {
    const p = buildOutreachRoutinePrompt({ apolloBudget: 5 });
    for (const sql of [
      "select rr_shortlist_candidates() as c",
      "select rr_shortlist_set($oq$<JSON array>$oq$::jsonb) as n",
      "select rr_outreach_queue() as added",
      "select rr_outreach_todo(8) as todo",
      "select rr_outreach_save('<radar_item_id>', $oq$<JSON object>$oq$::jsonb) as r",
      "select rr_update_todo() as u",
      "select rr_launch_todo() as l",
      "select rr_message_save('<radar_item_id>', '<update|launch_ask|launch_followup>', '<period>', $oq$<subject>$oq$, $oq$<body>$oq$) as r",
    ]) expect(p).toContain(sql);
    expect(p).toContain("4 investors and 2 buyers");
    expect(p).toMatch(/never mention the round, the amount, the instrument, terms or the deck/);
    expect(p).not.toContain("rr_outreach_watch");
    expect(p).not.toMatch(/search_threads|create_draft/);
    expect(p).toContain("Do not use Gmail");
    for (const purpose of ["invest", "ambassador", "buyer", "press", "intro"]) expect(p).toContain(`- ${purpose} (`);
    expect(p).toContain("at most 5 lookups this run");
    expect(p).toContain('email_source="public"');
    expect(p).toMatch(/Never offer equity/);
    expect(p).toContain("You NEVER send anything.");
    expect(p).toContain("reveal_personal_emails=false, no phone, no waterfall");
    expect(p).toMatch(/employer matches/);
    expect(p).toMatch(/nextgen[^\n]*only a business or management contact/);
    // Try again: someone who went quiet gets a short note that circles back, not a cold introduction.
    expect(p).toMatch(/retry is true[^\n]*circling-back note/);
  });

  it("gmail (daily): only creates drafts and watches; never sends; checks the account", () => {
    const p = buildGmailRoutinePrompt();
    expect(p).toMatch(/^Scheduled daily run of the "Rapport" GMAIL DRAFTS job\./);
    expect(p).toContain(CONN);
    for (const sql of [
      "select rr_gmail_todo() as t",
      "select rr_gmail_record('<key>', '<draft id>', '<thread id>') as r",
      "select rr_gmail_watch() as w",
      "select rr_gmail_observe('<key>', '<sent|replied>', '<ISO timestamp>') as r",
    ]) expect(p).toContain(sql);
    expect(p).toContain("Never call Gmail send_message");
    expect(p).toContain("create_draft");
    expect(p).toMatch(/sender_email/);
    expect(p).not.toMatch(/apollo|WebSearch/i);
    // Watch first (so a reply stops a due follow-up), then push; look for an existing draft before creating one.
    expect(p.indexOf("select rr_gmail_watch() as w")).toBeLessThan(p.indexOf("create a Gmail draft"));
    expect(p).toMatch(/Before creating each draft, list_drafts/);
    expect(p).toContain("select rr_outreach_watch() as watch");
    expect(p).toContain("select rr_outreach_observe('<radar_item_id>', '<sent|replied>', '<ISO timestamp>') as r");
    expect(p).toMatch(/If you cannot determine the account, create nothing/);
    // Ghosted after the cadence ends; checked after watching for replies.
    expect(p).toContain("select rr_refresh_ghosted() as n");
    expect(p.indexOf("select rr_gmail_watch() as w")).toBeLessThan(p.lastIndexOf("rr_refresh_ghosted"));
  });

  it("digest: only to the owner, links into Rapport", () => {
    const p = buildDigestRoutinePrompt("boxuanzhao1128@gmail.com", "https://rapport-liard.vercel.app");
    expect(p).toMatch(/^Scheduled weekly run of the "Rapport" radar DIGEST job\./);
    expect(p).toContain("Send email ONLY to boxuanzhao1128@gmail.com");
    expect(p).toContain("select rr_digest_email(55, 'https://rapport-liard.vercel.app') as d");
    expect(p).toContain("select rr_mark_digested(array['<id>', ...]::uuid[])");
  });
});
