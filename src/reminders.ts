import { renderEmailHtml, reminderEmail, sendEmail } from "./email";
import type { Env } from "./env";
import { doneLink, homeLink } from "./links";
import { RentecClient } from "./rentec";
import { dueReminders } from "./schedule";
import { activeTenants, listProperties } from "./store";

export interface ReminderRun {
  sent: number;
  failed: string[];
}

/** Sends every reminder due today that hasn't been sent yet. One failed email doesn't stop the rest. */
export async function sendDueReminders(env: Env, today: string, client = RentecClient.fromEnv(env)): Promise<ReminderRun> {
  const properties = new Map((await listProperties(env)).map((p) => [p.id, p]));
  const result: ReminderRun = { sent: 0, failed: [] };

  for (const tenant of await activeTenants(env)) {
    const property = properties.get(tenant.property_id);
    if (!property || !tenant.email) continue;

    for (const { kind, dueDate } of dueReminders(tenant, property.fields, today)) {
      const already = await env.DB.prepare("SELECT 1 FROM reminders_sent WHERE tenant_id = ? AND kind = ? AND due_date = ?")
        .bind(tenant.id, kind, dueDate)
        .first();
      if (already) continue;

      const email = reminderEmail(kind, tenant, property, dueDate);
      const home = await homeLink(env.APP_URL, env.LINK_SECRET, tenant.id);
      const html = renderEmailHtml(
        email,
        {
          home,
          done: email.done ? await doneLink(env.APP_URL, env.LINK_SECRET, tenant.id, kind, dueDate) : undefined,
          insurance: kind === "insurance" ? env.RESIDENT_CONNECT_URL : undefined,
        },
        env,
      );
      try {
        await sendEmail(env, tenant.email, email.subject, html);
        await env.DB.prepare("INSERT INTO reminders_sent (tenant_id, kind, due_date, sent_at) VALUES (?, ?, ?, ?)")
          .bind(tenant.id, kind, dueDate, new Date().toISOString())
          .run();
        result.sent++;
      } catch (err) {
        result.failed.push(`${tenant.id} ${kind}: ${String(err)}`);
        continue;
      }
      // Copy to the tenant's Rentec message history so the team sees it there. Nice to have, never blocking.
      await client
        .logMessage({ tenantId: tenant.id, subject: `Home Care reminder: ${email.subject}`, body: email.lines.join("\n") })
        .catch((err) => console.warn(`Rentec message log failed for ${tenant.id}: ${err}`));
    }
  }
  return result;
}
