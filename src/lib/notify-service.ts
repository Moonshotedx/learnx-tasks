import webpush from 'web-push';
import { Pool } from 'pg';
import { SendMailClient } from 'zeptomail';
import { generateEmailTemplate } from './email-template';

let webpushInitialized = false;
let zeptoClient: SendMailClient | null = null;

function initializeWebPush() {
  if (!webpushInitialized) {
    const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
    const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:tech@xcelerator.co.in';
    
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error('VAPID keys are required for push notifications');
    }
    
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    webpushInitialized = true;
  }
}

function getZeptoClient() {
  if (!zeptoClient) {
    const ZEPTO_URL = process.env.ZEPTO_URL || 'https://api.zeptomail.in/v1.1/email';
    const ZEPTO_TOKEN = process.env.ZEPTO_TOKEN;
    
    if (!ZEPTO_TOKEN) {
      console.error('❌ ZEPTO_TOKEN environment variable is not set!');
      throw new Error('ZEPTO_TOKEN is required for email notifications');
    }
    
    zeptoClient = new SendMailClient({ url: ZEPTO_URL, token: ZEPTO_TOKEN });
  }
  return zeptoClient;
}

interface EmailParams {
  to: string;
  subject: string;
  heading: string;
  subheading: string;
  body: string;
  ctaText?: string;
  ctaUrl?: string;
}

async function sendZeptoMail(params: EmailParams) {
  try {
    const client = getZeptoClient();
    const ZEPTO_FROM_ADDRESS = process.env.ZEPTO_FROM_ADDRESS || 'tech@xcelerator.co.in';
    const ZEPTO_FROM_NAME = process.env.ZEPTO_FROM_NAME || 'LearnX';
    
    const htmlTemplate = generateEmailTemplate({
      heading: params.heading,
      subheading: params.subheading,
      body: params.body,
      ctaText: params.ctaText,
      ctaUrl: params.ctaUrl
    });

    const plainTextBody = params.body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

    const result = await client.sendMail({
      from: {
        address: ZEPTO_FROM_ADDRESS,
        name: ZEPTO_FROM_NAME
      },
      to: [
        {
          email_address: {
            address: params.to,
            name: params.to
          }
        }
      ],
      subject: params.subject,
      textbody: plainTextBody,
      htmlbody: htmlTemplate
    });
    
    return result;
  } catch (error) {
    console.error(`❌ Zepto mail error for ${params.to}:`, error);
    throw new Error(`Failed to send email to ${params.to}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export class NotificationService {
  private pool: Pool;
  
  constructor(pool: Pool) {
    this.pool = pool;
  }

  async sendPushNotification(userId: string, payload: { title: string; body: string; data?: any }) {
    initializeWebPush(); 
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

  async sendEmailNotification(
    userId: string, 
    subject: string, 
    heading: string,
    subheading: string,
    body: string,
    ctaText?: string,
    ctaUrl?: string
  ) {
    try {
      const userRes = await this.pool.query(
        `SELECT email FROM users WHERE id = $1`, [userId]
      );
      const email = userRes.rows[0]?.email;
      
      if (!email) {
        console.warn(`No email found for userId: ${userId}`);
        return;
      }
      
      await sendZeptoMail({
        to: email,
        subject,
        heading,
        subheading,
        body,
        ctaText,
        ctaUrl
      });
    } catch (error) {
      console.error(`Failed to send email notification to userId: ${userId}`, error);
      throw error;
    }
  }
}