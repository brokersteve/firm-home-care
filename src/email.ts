import { prettyDay } from "./dates";
import type { Env, Property, Tenant } from "./env";
import type { ReminderKind } from "./schedule";

export interface Email {
  subject: string;
  /** Plain sentences; each becomes a paragraph. */
  lines: string[];
  /** Whether the email offers a one-tap Done link. */
  done: boolean;
}

function field(property: Property, name: string, fallback: string): string {
  return property.fields[name]?.trim() || fallback;
}

/** The words of each reminder. Kept plain so F.I.R.M. can reword them without touching anything else. */
export function reminderEmail(kind: ReminderKind, tenant: Tenant, property: Property, dueDate: string): Email {
  const count = Number.parseInt(field(property, "HC Filter Count", "1"), 10) || 1;
  const size = field(property, "HC Filter Size", "");
  switch (kind) {
    case "welcome":
      return {
        subject: "Welcome home: your F.I.R.M. Home Care page",
        lines: [
          `Welcome to ${property.address}.`,
          "Your Home Care page has the emergency guide for your home, local info, and quick troubleshooting for common problems.",
          "We'll also email short reminders for things like air filters and smoke detector tests. Each takes a few minutes.",
        ],
        done: false,
      };
    case "filter":
      return {
        subject: "Time to change your air filter",
        lines: [
          `It's time to replace the air ${count > 1 ? `filters (${count} of them)` : "filter"}${size ? `, size ${size}` : ""}.`,
          `You'll find ${count > 1 ? "them" : "it"} at: ${field(property, "HC Filter Location", "the return air vent")}.`,
          "A clean filter keeps your heating and cooling working and your bills lower.",
        ],
        done: true,
      };
    case "detector_test":
      return {
        subject: "Monthly smoke and CO detector test",
        lines: [
          "Please press and hold the test button on each smoke and CO detector until it beeps.",
          "If one doesn't beep, use the \"Something's wrong\" link and we'll take care of it.",
        ],
        done: true,
      };
    case "detector_battery":
      return {
        subject: "Yearly detector battery change",
        lines: [
          `Please replace the battery in each smoke and CO detector (${field(property, "HC Detector Battery", "9V")}).`,
          "Press the test button afterwards to make sure each one beeps.",
        ],
        done: true,
      };
    case "fall_checklist":
      return {
        subject: "Fall home checklist",
        lines: [
          "Disconnect garden hoses from outside taps so they don't freeze.",
          "Close any crawl space vents.",
          "Let us know about drafty windows or doors before it gets cold.",
        ],
        done: true,
      };
    case "spring_checklist":
      return {
        subject: "Spring home checklist",
        lines: [
          "Switch the thermostat to Cool for a few minutes to make sure the AC runs.",
          "Clear leaves from downspouts at ground level.",
          "Let us know about any leaks or water stains you've noticed.",
        ],
        done: true,
      };
    case "insurance":
      return {
        subject: "Your renters insurance renews soon",
        lines: [
          `Our records show your renters insurance expires on ${prettyDay(tenant.insurance_expires ?? dueDate)}.`,
          "When you renew, please upload the new policy in your Rentec tenant portal (Resident Connect) instead of emailing it.",
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
