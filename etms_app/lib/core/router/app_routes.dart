/// Centralized route paths + names (avoids stringly-typed navigation).
abstract final class AppRoutes {
  static const login = '/login';
  static const home = '/';
  static const admin = '/admin';
  static const trips = '/trips';
  static const bookings = '/bookings';
  static const profile = '/profile';

  /// Daily-commute screens (docs/etms/17). Pass the trip id as a path param.
  static const driverTrip = '/driver/trip'; // /driver/trip/:tripId
  static const myTrip = '/my/trip'; // /my/trip/:tripId
  static const myRides = '/my/rides';
  static const rateTrip = '/trips'; // /trips/:tripId/rate
  static const lostFound = '/lost-found'; // optional ?tripId=
  /// Fleet ops: fuel log, traffic violations, and their reports (db V0029).
  static const fuelLogs = '/fleet/fuel';
  static const fuelAdd = '/fleet/fuel/add';
  static const violations = '/fleet/violations';
  static const violationAdd = '/fleet/violations/add';
  static const fleetReports = '/fleet/reports';

  /// The operational report pack (db V0033).
  static const opsReports = '/reports/ops';

  /// The driver's ride-request inbox, with the on-my-route filter (db V0032).
  static const rideRequests = '/ride-requests';

  static String driverTripFor(String tripId) => '$driverTrip/$tripId';
  static String myTripFor(String tripId) => '$myTrip/$tripId';
  static String rateTripFor(String tripId) => '$rateTrip/$tripId/rate';
  static String lostFoundFor(String? tripId) =>
      tripId == null ? lostFound : '$lostFound?tripId=$tripId';
}
