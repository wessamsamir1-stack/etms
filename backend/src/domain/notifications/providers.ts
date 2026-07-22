import { NotificationDispatcher, InMemoryProvider } from './channels';
import type { Channel } from './template';

const CHANNELS: Channel[] = ['push', 'sms', 'email', 'whatsapp'];

/**
 * Builds the channel dispatcher for the notification worker. Today every channel
 * uses the in-memory (record-only) provider — no external gateway is called, so
 * the worker is fully runnable without credentials. Wire a REAL gateway by
 * implementing `ChannelProvider` (e.g. an FCM push, a Twilio SMS/WhatsApp, an
 * SMTP email adapter) and registering it here in place of the in-memory one when
 * its keys are configured — nothing else in the pipeline changes.
 */
export function buildDispatcher(): NotificationDispatcher {
  const d = new NotificationDispatcher();
  for (const ch of CHANNELS) {
    // e.g. if (ch === 'push' && process.env.FCM_KEY) d.register(new FcmProvider(process.env.FCM_KEY));
    d.register(new InMemoryProvider(ch));
  }
  return d;
}
