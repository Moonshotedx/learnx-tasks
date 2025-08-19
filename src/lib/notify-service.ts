

import webpush from 'web-push';
import { Pool } from 'pg';
import { SendMailClient } from 'zeptomail';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:tech@xcelerator.co.in';

const ZEPTO_URL = process.env.ZEPTO_URL || 'https://api.zeptomail.in/v1.1/email';
const ZEPTO_TOKEN = process.env.ZEPTO_TOKEN || '';
const ZEPTO_FROM_ADDRESS = process.env.ZEPTO_FROM_ADDRESS || 'tech@xcelerator.co.in';
const ZEPTO_FROM_NAME = process.env.ZEPTO_FROM_NAME || 'LearnX';

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const zeptoClient = new SendMailClient({ url: ZEPTO_URL, token: ZEPTO_TOKEN });

async function sendZeptoMail(to: string, subject: string, body: string) {
  const htmlTemplate = `
  <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: rgba(248, 250, 252, 0.6); padding: 24px; margin: 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 700px; margin: 0 auto;">
      <tr>
        <td>
          <div style="background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(10px); border-radius: 8px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08); border-left: 4px solid #3b82f6; overflow: hidden;">
            
            <div style="padding: 28px 40px 24px 40px;">
              <div style="display: flex; align-items: center; margin-bottom: 20px;">
                <img src="https://bucket.xcelerator.co.in/diamond-192.png" alt="LearnX" style="width: 28px; height: 28px; margin-right: 10px;" />
                <span style="font-size: 18px; font-weight: 600; color: #1e293b;">LearnX</span>
                <img src="https://assets.xcelerator.co.in/AUFull.png" alt="Atria University" style="height: 28px; margin-left: 16px;" />
              </div>
              
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; color: #1e293b; line-height: 1.4;">
                ${subject}
              </h1>
              
              <div style="font-size: 16px; color: #475569; line-height: 1.6; margin-bottom: 20px;">
                ${body}
              </div>

              <div style="margin: 24px 0;">
                <a href="https://learnx.atriauniversity.in" target="_blank" style="display: inline-block; padding: 10px 20px; background: #3b82f6; color: #ffffff; border-radius: 6px; font-size: 14px; font-weight: 500; text-decoration: none; transition: background-color 0.2s;">
                  Go to LearnX
                </a>
              </div>
            </div>
            
            <div style="padding: 20px 40px 28px 40px; border-top: 1px solid #e2e8f0;">
              <div style="font-size: 14px; color: #64748b; margin-bottom: 16px;">
                Having trouble? <a href="mailto:contact@xcelerator.co.in" style="color: #3b82f6; text-decoration: none;">Contact us</a>
              </div>
              
              <div style="font-size: 14px; color: #64748b;">
                Best regards,<br>
                Xcelerator Team
              </div>
            </div>
            
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
      subsRes.rows.map((subRow: any) => {
        let subscription: any = subRow.subscription;
        if (typeof subscription === 'string') {
          try {
            subscription = JSON.parse(subscription);
          } catch {
            console.warn('Invalid subscription JSON for user', userId);
            return;
          }
        }
        if (!subscription || typeof subscription !== 'object' || !subscription.endpoint) {
          console.warn('Skipping invalid subscription for user', userId, subscription);
          return;
        }
        return webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            data: payload.data || {}
          })
        );
      })
    );
  }

  async sendEmailNotification(userId: string, subject: string, body: string) {
    const userRes = await this.pool.query(
      `SELECT email FROM users WHERE id = $1`, [userId]
    );
    const email = userRes.rows[0]?.email;
    if (email) {
      await sendZeptoMail(email, subject, body);
    }
  }
}
