import { ExternalLink, Mail, Sparkles, X } from "lucide-react";
import { draftFromTemplateAction, outreachEventAction, saveOutreachAction } from "@/app/actions/outreach";
import { CopyButton } from "@/components/radar/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { gmailOkAction } from "@/app/(app)/week/actions";
import { getPitch, warmMatches, type OutreachRow } from "@/db/queries/radar";
import { outreachMessages } from "@/db/queries/raise";
import { formatDay, todayString } from "@/lib/dates";
import { gmailComposeUrl, linkedinSearchUrl, missingPitch } from "@/lib/radar/drafts";
import { PURPOSES, type Purpose } from "@/lib/radar/types";

export const PURPOSE_LABELS: Record<Purpose, string> = {
  invest: "Investor",
  ambassador: "Ambassador / partner",
  buyer: "Retail buyer",
  press: "Press",
  intro: "Intro / connector",
};

const STAGE_LABELS: Record<string, string> = {
  prospect: "Needs a draft",
  drafted: "Draft ready",
  sent: "Sent",
  replied: "Replied",
  closed: "Not pursuing",
};

const MAX_TOUCHES = 3;

function Event({ item, back, event, label, variant = "outline" }: { item: string; back: string; event: string; label: string; variant?: "outline" | "ghost" | "default" }) {
  return (
    <form action={outreachEventAction}>
      <input type="hidden" name="item" value={item} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="event" value={event} />
      <Button type="submit" size="lg" variant={variant}>
        {event === "closed" ? <X aria-hidden /> : null}
        {label}
      </Button>
    </form>
  );
}

function Field({ label, name, value, rows, wide = true, maxLength }: { label: string; name: string; value: string | null; rows?: number; wide?: boolean; maxLength?: number }) {
  const id = `outreach-${name}`;
  return (
    <div className={wide ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <label htmlFor={id} className="text-sm text-muted-foreground">
        {label}
      </label>
      {rows ? (
        <Textarea id={id} name={name} rows={rows} maxLength={maxLength} defaultValue={value ?? ""} />
      ) : (
        <Input id={id} name={name} maxLength={maxLength} defaultValue={value ?? ""} />
      )}
    </div>
  );
}

/** Drafts, purpose and send tracking for one person, on their deal or contact page. Nothing is ever sent from here. */
export async function OutreachPanel({
  userId,
  outreach: o,
  back,
  error,
  showName = false,
}: {
  userId: string;
  outreach: OutreachRow;
  back: string;
  error?: string;
  showName?: boolean;
}) {
  const [pitch, warm, messages] = await Promise.all([getPitch(userId), warmMatches(userId, [o.radarItemId]), outreachMessages(userId, o.id)]);
  const inGmail = messages.filter((m) => m.status === "in_gmail");
  const today = todayString();
  const from = pitch["pitch.sender_email"] || null;
  const due = o.stage === "sent" && o.nextFollowupAt !== null && o.nextFollowupAt <= today && o.touches < MAX_TOUCHES;
  const followup = o.touches <= 1 ? o.followup1 : o.followup2;
  const missing = missingPitch(pitch);
  const editable = o.stage === "prospect" || o.stage === "drafted";
  const known = (warm.get(o.radarItemId) ?? []).filter((w) => w.kind === "same_company");

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{showName ? `Outreach · ${o.name}` : "Outreach"}</h2>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{PURPOSE_LABELS[o.purpose as Purpose] ?? o.purpose}</Badge>
          <Badge variant="outline">{due ? "Follow-up due" : (STAGE_LABELS[o.stage] ?? o.stage)}</Badge>
          {o.touches > 0 ? <Badge variant="outline">{o.touches}/{MAX_TOUCHES} touches</Badge> : null}
          {o.stage === "sent" && o.nextFollowupAt ? <Badge variant="outline">Next touch {formatDay(o.nextFollowupAt)}</Badge> : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}
      {missing.length && editable ? (
        <p className="rounded-xl bg-secondary/60 px-4 py-3 text-sm">
          Add your pitch facts ({missing.join(", ")}) in <a href="/settings#pitch" className="underline underline-offset-4">Settings</a> so drafts have no placeholders.
        </p>
      ) : null}

      {(o.warmPath || known.length) ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {o.warmPath ? (
            <>
              <dt className="text-muted-foreground">Warm path</dt>
              <dd>{o.warmPath}</dd>
            </>
          ) : null}
          {known.length ? (
            <>
              <dt className="text-muted-foreground">You know</dt>
              <dd>{known.map((w) => `${w.full_name}${w.position ? ` (${w.position})` : ""}`).join(", ")} at {known[0].company}</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {inGmail.length ? (
        <p className="rounded-xl bg-accent px-4 py-3 text-sm">
          In your Gmail Drafts: {inGmail.map((m) => m.subject || m.kind).join(", ")}. Review and send it from Gmail; it&apos;s tracked here automatically.
        </p>
      ) : o.gmailOk && o.stage === "drafted" ? (
        <p className="rounded-xl bg-accent px-4 py-3 text-sm">This draft goes to your Gmail Drafts tomorrow morning.</p>
      ) : o.stage === "drafted" && o.email ? (
        <form action={gmailOkAction} className="flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="item" value={o.radarItemId} />
          <input type="hidden" name="back" value={back} />
          <Button type="submit" size="lg" variant="outline">
            <Mail aria-hidden />
            Put this draft in Gmail
          </Button>
          <span className="text-muted-foreground">It lands in your Gmail Drafts tomorrow morning; nothing is sent.</span>
        </form>
      ) : null}

      {o.body && (o.stage === "drafted" || due) ? (
        <div className="space-y-1 rounded-xl bg-secondary/60 px-4 py-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {due ? `Follow-up ${o.touches}` : "Email draft"}
            {o.draftedBy ? ` · by ${o.draftedBy}` : ""}
          </p>
          {!due && o.subject ? <p className="font-medium">{o.subject}</p> : null}
          <p className="whitespace-pre-wrap">{due ? (followup ?? "") : o.body}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {o.stage === "prospect" ? (
          <form action={draftFromTemplateAction}>
            <input type="hidden" name="item" value={o.radarItemId} />
            <input type="hidden" name="back" value={back} />
            <Button type="submit" size="lg">
              <Sparkles aria-hidden />
              Draft from template
            </Button>
          </form>
        ) : null}
        {o.stage === "drafted" ? (
          <>
            <Button size="lg" render={<a href={gmailComposeUrl({ to: o.email, subject: o.subject, body: o.body, from })} target="_blank" rel="noopener noreferrer" />}>
              <Mail aria-hidden />
              Open in Gmail
            </Button>
            <Event item={o.radarItemId} back={back} event="sent" label="Mark sent" />
          </>
        ) : null}
        {due && followup ? (
          <>
            <Button size="lg" render={<a href={gmailComposeUrl({ to: o.email, subject: o.subject ? `Re: ${o.subject}` : null, body: followup, from })} target="_blank" rel="noopener noreferrer" />}>
              <Mail aria-hidden />
              Open follow-up
            </Button>
            <Event item={o.radarItemId} back={back} event="followup" label="Mark follow-up sent" />
          </>
        ) : null}
        {(o.stage === "drafted" || o.stage === "sent") && o.linkedinNote ? <CopyButton text={o.linkedinNote} label="Copy LinkedIn note" /> : null}
        {o.stage !== "closed" ? (
          <Button size="lg" variant="outline" render={<a href={o.linkedinUrl || linkedinSearchUrl(o.name, o.details.firm)} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLink aria-hidden />
            {o.linkedinUrl ? "LinkedIn" : "Find on LinkedIn"}
          </Button>
        ) : null}
        {o.introRequest && editable ? (
          <Button size="lg" variant="outline" render={<a href={gmailComposeUrl({ subject: `Intro to ${o.name}?`, body: o.introRequest, from })} target="_blank" rel="noopener noreferrer" />}>
            Ask for intro
          </Button>
        ) : null}
        {o.stage === "sent" ? <Event item={o.radarItemId} back={back} event="replied" label="They replied" /> : null}
        {o.stage !== "closed" && o.stage !== "replied" ? <Event item={o.radarItemId} back={back} event="closed" label="Not pursuing" variant="ghost" /> : null}
      </div>

      {editable ? (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2.5 text-muted-foreground">Edit purpose, contact and drafts</summary>
          <form action={saveOutreachAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="item" value={o.radarItemId} />
            <input type="hidden" name="back" value={back} />
            <div className="space-y-1.5">
              <label htmlFor="outreach-purpose" className="text-sm text-muted-foreground">
                Purpose (picks the template)
              </label>
              <select
                id="outreach-purpose"
                name="purpose"
                defaultValue={o.purpose}
                className="h-11 w-full rounded-xl border border-input bg-transparent px-3 text-sm"
              >
                {PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {PURPOSE_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <Field label="Email (verified, professional only)" name="email" value={o.email} wide={false} />
            <Field label="LinkedIn URL" name="linkedin_url" value={o.linkedinUrl} />
            <Field label="Warm path" name="warm_path" value={o.warmPath} />
            <>
                <Field label="Subject" name="subject" value={o.subject} maxLength={160} />
                <Field label="Email" name="body" value={o.body} rows={9} />
                <Field label="LinkedIn note (max 300)" name="linkedin_note" value={o.linkedinNote} rows={3} maxLength={300} />
                <Field label="Intro request (to a mutual)" name="intro_request" value={o.introRequest} rows={5} />
                <Field label="Follow-up 1 (day 5)" name="followup_1" value={o.followup1} rows={4} />
                <Field label="Follow-up 2 (day 12)" name="followup_2" value={o.followup2} rows={4} />
            </>
            <div className="sm:col-span-2">
              <Button type="submit" size="lg">
                Save
              </Button>
            </div>
          </form>
        </details>
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Send one-to-one from your own inbox and keep the first note relationship-first. Contacting people you don&apos;t know about an investment can
        count as general solicitation under SEC Reg D, so confirm your 506(b)/506(c) approach with counsel before a broad push. Never offer equity in a
        first note to a celebrity or creator. Paid ambassadors and creators must disclose the relationship (FTC endorsement rules), and NIL deals with
        college athletes must follow their school&apos;s NIL rules.
      </p>
    </Card>
  );
}
