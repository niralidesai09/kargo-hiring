import "server-only";
import { Resend } from "resend";
import { MailerError, type Mailer, type SendConfig } from "./send";

export function createResendMailer(apiKey: string): Mailer {
  const resend = new Resend(apiKey);
  return {
    async send(msg) {
      let res;
      try {
        res = await resend.emails.send(
          { from: msg.from, to: [msg.to], replyTo: msg.replyTo, subject: msg.subject, text: msg.text, html: msg.html },
          { idempotencyKey: msg.idempotencyKey },
        );
      } catch (err) {
        throw new MailerError((err as Error)?.message ?? "network error", "network");
      }
      if (res.error) {
        const network = res.error.statusCode == null || /fetch|network|ECONN|ETIMEDOUT/i.test(res.error.message);
        throw new MailerError(res.error.message, network ? "network" : "resend", res.error.statusCode);
      }
      if (!res.data?.id) throw new MailerError("Resend returned no message id.", "resend");
      return { id: res.data.id };
    },
  };
}

export function sendConfigFromEnv(): SendConfig {
  const key = process.env.RESEND_API_KEY?.trim();
  return {
    mailer: key ? createResendMailer(key) : null,
    from: process.env.HIRING_FROM_EMAIL?.trim(),
    replyTo: process.env.HIRING_REPLY_TO?.trim() || undefined,
    testRecipient: process.env.RESEND_TEST_RECIPIENT?.trim() || undefined,
  };
}
