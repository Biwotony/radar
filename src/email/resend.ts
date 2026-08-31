import type { AlertEmail, EmailSender, EmailSendResult } from '../alerts.js';

type ResendResponse = {
  id?: string;
  message?: string;
};

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: AlertEmail, idempotencyKey: string): Promise<EmailSendResult> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });

    const body = (await response.json().catch(() => ({}))) as ResendResponse;
    if (!response.ok) {
      const error = new Error(body.message ?? `Resend request failed with status ${response.status}`);
      Object.assign(error, { status: response.status });
      throw error;
    }

    return { messageId: body.id ?? null };
  }
}
