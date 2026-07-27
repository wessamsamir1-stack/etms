import type { PoolClient } from 'pg';
import { commuteMessages } from '../domain/commute/manifest';
import { enqueuePush } from './push_outbox';

/**
 * Trip waiting list (db V0031). The daily-commute model has no reserved seats,
 * but a bus does have a capacity: once the active manifest fills up, the next
 * employee joins a per-trip queue instead of being turned away. The moment a
 * seat frees — ops excuses someone, a rider cancels, the trip gets a bigger
 * vehicle — `promoteWaitlist` moves the head of the queue onto the manifest and
 * pushes them a notification.
 *
 * Capacity is resolved in SQL (app_trip_capacity: the trip override, else the
 * assigned vehicle) so the guard, the manifest read and the reports agree.
 */

/** Seat accounting for one trip; `remaining`/`capacity` are null when uncapped. */
export interface TripSeats {
  capacity: number | null;
  occupied: number;
  remaining: number | null;
  waiting: number;
}

export interface WaitlistEntry {
  id: string;
  position: number;
  status: string;
  employee_id: string;
}

export interface PromotedEntry {
  waitlistId: string;
  employeeId: string;
  fullName: string;
  tripPassengerId: string;
}

/**
 * Lock the trip row for the rest of the transaction. Capacity is a
 * check-then-insert, so without this two concurrent "add passenger" calls could
 * each see the last free seat. Returns false when the trip does not exist (or
 * belongs to another tenant, which RLS hides).
 */
export async function lockTrip(c: PoolClient, tripId: string): Promise<boolean> {
  const r = await c.query('SELECT id FROM trip WHERE id=$1 FOR UPDATE', [tripId]);
  return r.rowCount === 1;
}

export async function tripSeats(c: PoolClient, tripId: string): Promise<TripSeats> {
  const row = (
    await c.query(
      `SELECT app_trip_capacity($1)        AS capacity,
              app_trip_occupied($1)        AS occupied,
              app_trip_remaining_seats($1) AS remaining,
              (SELECT count(*)::int FROM trip_waitlist w
                WHERE w.trip_id=$1 AND w.status='waiting') AS waiting`,
      [tripId],
    )
  ).rows[0];
  return {
    capacity: row.capacity === null ? null : Number(row.capacity),
    occupied: Number(row.occupied ?? 0),
    remaining: row.remaining === null ? null : Number(row.remaining),
    waiting: Number(row.waiting ?? 0),
  };
}

/** Keep the trip's cached occupancy counter in step with the manifest. */
export async function syncSeatsTaken(c: PoolClient, tripId: string): Promise<number> {
  const n = (await c.query('SELECT app_trip_occupied($1) AS n', [tripId])).rows[0].n as number;
  await c.query('UPDATE trip SET seats_taken=$2 WHERE id=$1', [tripId, n]);
  return Number(n);
}

/**
 * Append an employee to a trip's queue (idempotent: an existing `waiting` entry
 * is returned as-is rather than duplicated) and notify them of their position.
 */
export async function joinWaitlist(
  c: PoolClient,
  args: {
    tripId: string;
    employeeId: string;
    tripStopId?: string | null;
    source?: 'manifest' | 'ride_request';
    rideRequestId?: string | null;
    note?: string | null;
    createdBy?: string | null;
  },
): Promise<WaitlistEntry & { alreadyWaiting: boolean }> {
  const inserted = (
    await c.query(
      `INSERT INTO trip_waitlist(tenant_id, trip_id, employee_id, trip_stop_id, position,
                                 source, ride_request_id, note, created_by)
       VALUES (app_current_tenant(), $1, $2, $3,
               (SELECT coalesce(max(position),0)+1 FROM trip_waitlist WHERE trip_id=$1),
               $4, $5, $6, $7)
       ON CONFLICT (trip_id, employee_id) WHERE status='waiting' DO NOTHING
       RETURNING id, position, status, employee_id`,
      [
        args.tripId,
        args.employeeId,
        args.tripStopId ?? null,
        args.source ?? 'manifest',
        args.rideRequestId ?? null,
        args.note ?? null,
        args.createdBy ?? null,
      ],
    )
  ).rows[0] as WaitlistEntry | undefined;

  if (!inserted) {
    const existing = (
      await c.query(
        `SELECT id, position, status, employee_id FROM trip_waitlist
         WHERE trip_id=$1 AND employee_id=$2 AND status='waiting'`,
        [args.tripId, args.employeeId],
      )
    ).rows[0] as WaitlistEntry;
    return { ...existing, alreadyWaiting: true };
  }

  const emp = (await c.query('SELECT user_id FROM employee WHERE id=$1', [args.employeeId])).rows;
  await enqueuePush(c, emp, 'waitlisted', args.tripId, {
    ar: commuteMessages.waitlisted(inserted.position, 'ar'),
    en: commuteMessages.waitlisted(inserted.position, 'en'),
  }, { position: inserted.position });

  return { ...inserted, alreadyWaiting: false };
}

/**
 * Promote as many waiting employees as there are free seats, in queue order.
 * Safe to call after ANY event that can free a seat — it is a no-op when the
 * bus is still full or nobody is waiting. Call inside the same transaction that
 * freed the seat so the two can never diverge.
 *
 * A trip with no known capacity (no override, no assigned vehicle) is uncapped:
 * everyone waiting is promoted.
 */
export async function promoteWaitlist(
  c: PoolClient,
  tripId: string,
  actorUserId: string | null,
): Promise<PromotedEntry[]> {
  if (!(await lockTrip(c, tripId))) return [];

  const remaining = (await c.query('SELECT app_trip_remaining_seats($1) AS n', [tripId])).rows[0]
    .n as number | null;
  if (remaining !== null && remaining <= 0) return [];

  const waiting = (
    await c.query(
      `SELECT w.id, w.employee_id, w.trip_stop_id, e.full_name, e.user_id
       FROM trip_waitlist w JOIN employee e ON e.id = w.employee_id
       WHERE w.trip_id=$1 AND w.status='waiting'
       ORDER BY w.position, w.created_at
       ${remaining === null ? '' : 'LIMIT $2'}`,
      remaining === null ? [tripId] : [tripId, remaining],
    )
  ).rows as Array<{
    id: string;
    employee_id: string;
    trip_stop_id: string | null;
    full_name: string;
    user_id: string | null;
  }>;
  if (waiting.length === 0) return [];

  const promoted: PromotedEntry[] = [];
  for (const w of waiting) {
    // A previously removed / no-showed passenger is reinstated rather than
    // duplicated (the manifest is unique per trip+employee).
    const pax = (
      await c.query(
        `INSERT INTO trip_passenger(tenant_id, trip_id, trip_stop_id, employee_id, status, updated_by)
         VALUES (app_current_tenant(),$1,$2,$3,'expected',$4)
         ON CONFLICT (trip_id, employee_id) DO UPDATE
           SET status = CASE WHEN trip_passenger.status IN ('no_show','excused','on_leave','removed')
                             THEN 'expected' ELSE trip_passenger.status END,
               trip_stop_id = coalesce(EXCLUDED.trip_stop_id, trip_passenger.trip_stop_id),
               updated_by = $4
         RETURNING id`,
        [tripId, w.trip_stop_id, w.employee_id, actorUserId],
      )
    ).rows[0] as { id: string };

    await c.query(
      `UPDATE trip_waitlist SET status='promoted', promoted_at=now(), trip_passenger_id=$2
       WHERE id=$1`,
      [w.id, pax.id],
    );
    promoted.push({
      waitlistId: w.id,
      employeeId: w.employee_id,
      fullName: w.full_name,
      tripPassengerId: pax.id,
    });
  }

  await syncSeatsTaken(c, tripId);
  await enqueuePush(c, waiting, 'waitlist_promoted', tripId, {
    ar: commuteMessages.promoted('ar'),
    en: commuteMessages.promoted('en'),
  });
  return promoted;
}
