

import webpush from 'web-push';
import { Pool } from 'pg';
import { SendMailClient } from 'zeptomail';

const ZEPTO_URL = process.env.ZEPTO_URL || 'api.zeptomail.com/';
const ZEPTO_TOKEN = process.env.ZEPTO_TOKEN || '';
const ZEPTO_FROM_ADDRESS = process.env.ZEPTO_FROM_ADDRESS || 'noreply@example.com';
const ZEPTO_FROM_NAME = process.env.ZEPTO_FROM_NAME || 'LearnX';

const zeptoClient = new SendMailClient({ url: ZEPTO_URL, token: ZEPTO_TOKEN });

async function sendZeptoMail(to: string, subject: string, body: string) {
  const htmlTemplate = `
    <div style="font-family: 'Inter', Arial, sans-serif; background: #f8fafc; padding: 32px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
        <tr>
          <td style="padding: 32px 32px 16px 32px;">
            <div style="font-size: 24px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">${subject}</div>
            <div style="font-size: 16px; color: #64748b; margin-bottom: 24px;">This is a notification from LearnX</div>
            <div style="font-size: 15px; color: #334155; line-height: 1.7;">
              ${body}
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 32px 32px 32px;">
            <div style="margin-top: 32px; font-size: 13px; color: #94a3b8; text-align: center;">
              <strong>LearnX</strong> &bull; Atria University
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;
  return zeptoClient.sendMail({
    from: {
      address: ZEPTO_FROM_ADDRESS,
      name: ZEPTO_FROM_NAME
    },
    to: [
      {
        email_address: {
          address: to,
          name: to
        }
      }
    ],
    subject,
    textbody: body,
    htmlbody: htmlTemplate
  });
}

export class NotificationService {
  private pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }

  async sendPushNotification(userId: string, payload: { title: string; body: string; data?: any }) {
    const subsRes = await this.pool.query(
      `SELECT subscription FROM notification_records WHERE user_id = $1 AND is_active = 1`, [userId]
    );
    await Promise.all(
      subsRes.rows.map((subRow: any) =>
        webpush.sendNotification(
          subRow.subscription,
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            data: payload.data || {}
          })
        )
      )
    );
  }

  async sendEmailNotification(userId: string, subject: string, body: string) {
    // Fetch user email
    const userRes = await this.pool.query(
      `SELECT email FROM users WHERE id = $1`, [userId]
    );
    const email = userRes.rows[0]?.email;
    if (email) {
      await sendZeptoMail(email, subject, body);
    }
  }
}
