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
      });

  // Lost & found.
  Future<void> reportLostItem(String description, {String? tripId}) =>
      _api.post<Map<String, dynamic>>('/lost-items', body: {
        'description': description,
        if (tripId != null) 'trip_id': tripId,
      });

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

/// The employee's own ride history (GET /v1/my/rides).
final myRidesProvider = FutureProvider<List<MyRide>>((ref) async {
  return ref.watch(commuteServiceProvider).myRides();
});
