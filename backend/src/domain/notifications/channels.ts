import { Channel } from './template';

/** A message ready to dispatch on one channel. */
export interface OutboundMessage {
  channel: Channel;
  to: string;
  subject?: string;
  body: string;
}

export interface DeliveryResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}

/** Provider port: SMS/WhatsApp/email/push gateways implement this. */
export interface ChannelProvider {
  readonly channel: Channel;
  send(msg: OutboundMessage): Promise<DeliveryResult>;
}

/**
 * Routes a message to the provider registered for its channel. The Notification
 * System composes: template render → build OutboundMessage → dispatch here.
 * Providers are pluggable per tenant (real SMS/WhatsApp gateways in production;
 * the in-memory provider below is used in tests).
 */
export class NotificationDispatcher {
  private readonly providers = new Map<Channel, ChannelProvider>();

  register(provider: ChannelProvider): this {
    this.providers.set(provider.channel, provider);
    return this;
  }

  async dispatch(msg: OutboundMessage): Promise<DeliveryResult> {
    const provider = this.providers.get(msg.channel);
    if (!provider) {
      return { ok: false, error: `no provider for channel ${msg.channel}` };
    }
    try {
      return await provider.send(msg);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

/** Records messages instead of sending — for tests and local dev. */
export class InMemoryProvider implements ChannelProvider {
  readonly sent: OutboundMessage[] = [];
  constructor(readonly channel: Channel) {}
  async send(msg: OutboundMessage): Promise<DeliveryResult> {
    this.sent.push(msg);
    return { ok: true, providerRef: `mem-${this.sent.length}` };
  }
}
