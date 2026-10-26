import { prettyDay } from "./dates";
import type { Env, Property, Tenant } from "./env";
import { filters } from "./fields";
import type { ReminderKind } from "./schedule";

export interface Email {
  subject: string;
  /** Plain sentences; each becomes a paragraph. */
  lines: string[];
  /** Whether the email offers a one-tap Done link. */
  done: boolean;
}

/** The words of each reminder. Kept plain so F.I.R.M. can reword them without touching anything else. */
export function reminderEmail(kind: ReminderKind, tenant: Tenant, property: Property, dueDate: string): Email {
  switch (kind) {
    case "welcome":
      return {
        subject: "Welcome home: your F.I.R.M. Home Care page",
        lines: [
          `Welcome to ${property.address}.`,
          "Your Home Care page has the emergency guide for your home, local info, and quick fixes to try before you submit a work order.",
          "We'll also email short reminders for the routine care in your lease, like air filters and detector batteries. Each takes a few minutes.",
          "Please return your Move-in Inspection Form within 10 days of move-in (lease section 1.9).",
        ],
        done: false,
      };
    case "filter": {
      const list = filters(property.fields);
      return {
        subject: list.length > 1 ? "Time to change your air filters" : "Time to change your air filter",
        lines: [
          list.length > 1
            ? `It's time to replace your ${list.length} air filters:`
            : "It's time to replace your air filter.",
          ...list.map((f) => `${f.size || "Filter"}${f.location ? `: ${f.location}` : ""}`),
          "Your lease (6.3) asks for a new filter at least every 60 days. A clean filter keeps your heating and cooling working and your power bill lower.",
        ],
        done: true,
      };
    }
    case "detector_test":
      return {
        subject: "Monthly smoke and CO detector test",
        lines: [
          "Please press and hold the test button on each smoke and CO detector until it beeps.",
          "If one doesn't beep, tell us right away (lease section 6.3) using the \"Something's wrong\" link.",
        ],
        done: true,
      };
    case "detector_battery":
      return {
        subject: "Yearly detector battery change",
        lines: [
          "Please replace the batteries in each smoke and CO detector. Sealed 10-year alarms don't need new batteries.",
          "Press the test button afterwards to make sure each one beeps.",
        ],
        done: true,
      };
    case "fall_checklist":
      return {
        subject: "Fall and winter home checklist",
        lines: [
          "Disconnect garden hoses from outside taps before the first freeze.",
          "In freezing weather keep the heat at 55°F or higher, even when you're away, and let faucets drip on the coldest nights. In extreme cold, open sink cabinets on outside walls.",
          "Rake and remove leaves. Gutter cleaning is the tenant's job under the lease; please hire a licensed professional rather than climbing a ladder.",
          "Tell us if leaves or limbs are building up on the roof.",
          "Going away for more than 7 days? Let us know in writing and leave the heat on.",
        ],
        done: true,
      };
    case "spring_checklist":
      return {
        subject: "Spring home checklist",
        lines: [
          "Switch the thermostat to Cool for a few minutes to make sure the AC runs before the heat arrives.",
          "Trim tree limbs that hang within six feet of the ground, and keep the lawn mowed and beds tidy.",
          "Clear downspouts at ground level, and have gutters cleaned by a licensed professional if needed.",
          "Report any leaks, water stains or signs of pests through the tenant portal within 24 hours.",
        ],
        done: true,
      };
    case "insurance":
      return {
        subject: "Your renters insurance renews soon",
        lines: [
          `Our records show your renters insurance expires on ${prettyDay(tenant.insurance_expires ?? dueDate)}.`,
          "Your lease (8.1) requires at least $100,000 of personal liability coverage, with First Investor Realty & Management, LLC listed as an additional insured or interested party.",
          "When you renew, please upload the new policy in your Rentec tenant portal instead of emailing it.",
        ],
        done: false,
      };
  }
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderEmailHtml(email: Email, links: { home: string; done?: string; insurance?: string }, env: Pick<Env, "EMERGENCY_PHONE">): string {
  const button = (href: string, label: string, primary: boolean) =>
    `<a href="${escape(href)}" style="display:inline-block;padding:12px 20px;margin:4px 8px 4px 0;border-radius:8px;text-decoration:none;font-weight:600;${
      primary ? "background:#1f5f8b;color:#fff" : "border:1px solid #1f5f8b;color:#1f5f8b"
    }">${label}</a>`;
  return `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#222;max-width:560px">
${email.lines.map((l) => `<p>${escape(l)}</p>`).join("\n")}
<p>${links.done ? button(links.done, "Done", true) : ""}${links.insurance ? button(links.insurance, "Upload my policy", true) : ""}${button(`${links.home}/help`, "Something's wrong", false)}${button(links.home, "My Home Care page", false)}</p>
<p style="font-size:13px;color:#666">Emergency? Call F.I.R.M. at ${escape(env.EMERGENCY_PHONE)}. For rent and repair requests, use Resident Connect.</p>
</div>`;
}

export async function sendEmail(env: Env, to: string, subject: string, html: string): Promise<void> {
  // Local preview: set RESEND_API_KEY=log to print emails instead of sending them.
  if (env.RESEND_API_KEY === "log") {
    console.log(`EMAIL to ${to}: ${subject}\n${html}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Email to ${to} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
