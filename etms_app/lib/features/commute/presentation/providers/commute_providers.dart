import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/providers.dart';
import '../../../../core/network/api_client.dart';
import '../../data/commute_models.dart';

/// Thin service over the daily-commute endpoints (docs/etms/17).
class CommuteService {
  CommuteService(this._api);
  final ApiClient _api;

  Future<TripManifest> manifest(String tripId) async {
    final res = await _api.get<Map<String, dynamic>>('/trips/$tripId/manifest');
    return TripManifest.fromJson(res);
  }

  // Driver actions.
  Future<void> arrive(String tripId, String stopId, {String by = 'driver'}) =>
      _api.post<Map<String, dynamic>>('/trips/$tripId/stops/$stopId/arrive', body: {'by': by});

  Future<void> board(String tripId, String passengerId) =>
      _api.post<Map<String, dynamic>>('/trips/$tripId/passengers/$passengerId/board');

  Future<void> depart(String tripId, String stopId) =>
      _api.post<Map<String, dynamic>>('/trips/$tripId/stops/$stopId/depart');

  // Employee action.
  Future<void> onTheWay(String tripId) =>
      _api.post<Map<String, dynamic>>('/trips/$tripId/on-the-way');

  // ---- Waiting list (db V0031) ------------------------------------------
  Future<TripWaitlist> waitlist(String tripId, {String? status}) async {
    final res = await _api.get<Map<String, dynamic>>(
      '/trips/$tripId/waitlist',
      query: {if (status != null) 'status': status},
    );
    return TripWaitlist.fromJson(res);
  }

  /// Queue an employee. The server promotes them straight away when a seat is
  /// already free, so the caller just refreshes afterwards.
  Future<void> joinWaitlist(String tripId, String employeeId, {String? note}) =>
      _api.post<Map<String, dynamic>>(
        '/trips/$tripId/waitlist',
        body: {
          'employee_id': employeeId,
          if (note != null && note.isNotEmpty) 'note': note,
        },
      );

  Future<void> cancelWaitlistEntry(String tripId, String entryId) =>
      _api.delete<Map<String, dynamic>>('/trips/$tripId/waitlist/$entryId');

  /// Run the promotion pass by hand (it also runs on every seat-freeing event).
  Future<void> promoteWaitlist(String tripId) =>
      _api.post<Map<String, dynamic>>('/trips/$tripId/waitlist/promote');

  // Rating (1..5 each, all optional).
  Future<void> rateTrip(
    String tripId, {
    int? driver,
    int? cleanliness,
    int? ac,
    int? punctuality,
    String? comment,
  }) =>
      _api.post<Map<String, dynamic>>('/trips/$tripId/rating', body: {
        if (driver != null) 'driver': driver,
        if (cleanliness != null) 'cleanliness': cleanliness,
        if (ac != null) 'ac': ac,
        if (punctuality != null) 'punctuality': punctuality,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
      },);

  // Lost & found.
  Future<void> reportLostItem(String description, {String? tripId}) =>
      _api.post<Map<String, dynamic>>('/lost-items', body: {
        'description': description,
        if (tripId != null) 'trip_id': tripId,
      },);

  // My ride history.
  Future<List<MyRide>> myRides() async {
    final res = await _api.get<Map<String, dynamic>>('/my/rides');
    final list = (res['data'] as List? ?? const []);
    return [for (final r in list) MyRide.fromJson(r as Map<String, dynamic>)];
  }
}

final commuteServiceProvider =
    Provider<CommuteService>((ref) => CommuteService(ref.watch(apiClientProvider)));

/// The manifest for a trip. Poll/refresh by invalidating this provider.
final tripManifestProvider =
    FutureProvider.family<TripManifest, String>((ref, tripId) async {
  return ref.watch(commuteServiceProvider).manifest(tripId);
});

/// The waiting list for a trip (GET /v1/trips/:id/waitlist).
final tripWaitlistProvider =
    FutureProvider.family<TripWaitlist, String>((ref, tripId) async {
  return ref.watch(commuteServiceProvider).waitlist(tripId);
});

/// The employee's own ride history (GET /v1/my/rides).
final myRidesProvider = FutureProvider<List<MyRide>>((ref) async {
  return ref.watch(commuteServiceProvider).myRides();
});
