# booking

Rider seat booking (request / confirm / waitlist / cancel, recurring bookings).

Scaffolded — implement by mirroring `features/trips`:
- **domain:** `Booking` entity, `BookingRepository`, use-cases `CreateBooking`,
  `CancelBooking`, `WatchMyBookings`.
- **data:** `BookingDto`, remote (`POST /bookings`, `/bookings/{id}:cancel`) + local
  cache, `BookingRepositoryImpl` (offline-capable via the outbox).
- **presentation:** providers, `BookingController`, booking + waitlist screens.
