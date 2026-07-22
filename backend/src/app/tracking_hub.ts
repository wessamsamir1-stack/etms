import type { Client } from 'pg';
import type { Db } from './db/pool';

/** The Postgres NOTIFY channel the tracking write-path publishes positions on. */
export const TRACK_CHANNEL = 'etms_track';

/** A live position event, as published by the GPS-ingest endpoint. */
export interface PositionEvent {
  tenantId: string;
  vehicleId: string;
  tripId: string | null;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  recordedAt: string;
}

interface Subscriber {
  tenantId: string;
  tripId?: string;
  vehicleId?: string;
  send: (e: PositionEvent) => void;
}

/**
 * Fans out realtime vehicle positions to SSE subscribers. One dedicated Postgres
 * `LISTEN etms_track` connection per process receives every position NOTIFY; the
 * hub forwards each to the in-process subscribers whose **tenant matches** (and
 * whose optional trip/vehicle filter matches). Tenant filtering here is the
 * isolation boundary — NOTIFY itself is not RLS-scoped, so a subscriber only
 * ever sees its own company's vehicles.
 *
 * Horizontal scale: every server instance runs its own hub + LISTEN connection,
 * so a NOTIFY reaches all instances and each fans out to its own clients.
 */
export class TrackingHub {
  private client: Client | null = null;
  private starting: Promise<void> | null = null;
  private readonly subs = new Set<Subscriber>();

  constructor(private readonly db: Db) {}

  /** Lazily open the LISTEN connection (idempotent, first subscriber wins). */
  private async ensureStarted(): Promise<void> {
    if (this.client) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const client = await this.db.createListener();
      client.on('notification', (msg) => {
        if (msg.channel !== TRACK_CHANNEL || !msg.payload) return;
        let e: PositionEvent;
        try {
          e = JSON.parse(msg.payload) as PositionEvent;
        } catch {
          return;
        }
        for (const s of this.subs) {
          if (s.tenantId !== e.tenantId) continue;
          if (s.tripId && s.tripId !== e.tripId) continue;
          if (s.vehicleId && s.vehicleId !== e.vehicleId) continue;
          try {
            s.send(e);
          } catch {
            /* a broken pipe is cleaned up by the route's close handler */
          }
        }
      });
      // Auto-recover if the connection drops: discard the dead client and, while
      // subscribers remain, re-establish the LISTEN so existing SSE streams keep
      // getting positions instead of silently going dark.
      const onDrop = (): void => {
        if (this.client !== client) return; // already replaced
        this.client = null;
        this.starting = null;
        client.removeAllListeners();
        client.end().catch(() => {});
        if (this.subs.size > 0) {
          void this.ensureStarted().catch(() => {});
        }
      };
      client.on('error', onDrop);
      client.on('end', onDrop);
      await client.query(`LISTEN ${TRACK_CHANNEL}`);
      this.client = client;
    })();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  /** Register a subscriber; returns an unsubscribe function. */
  async subscribe(sub: Subscriber): Promise<() => void> {
    await this.ensureStarted();
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }

  get subscriberCount(): number {
    return this.subs.size;
  }

  async close(): Promise<void> {
    this.subs.clear();
    if (this.client) {
      const c = this.client;
      this.client = null;
      await c.end().catch(() => {});
    }
  }
}
