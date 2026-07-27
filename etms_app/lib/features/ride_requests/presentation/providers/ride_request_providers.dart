import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/providers.dart';
import '../../../../core/network/api_client.dart';
import '../../data/ride_request_models.dart';

/// Thin service over the ride-request endpoints (docs/etms/16, db V0032).
class RideRequestService {
  RideRequestService(this._api);
  final ApiClient _api;

  /// The open requests offered to the signed-in driver. With [matchMyRoute]
  /// only the ones whose pickup falls inside a zone on the driver's approved
  /// plan for that day come back.
  Future<List<RideRequest>> myOffers({
    DateTime? date,
    bool matchMyRoute = false,
  }) async {
    final res = await _api.get<Map<String, dynamic>>(
      '/ride-requests',
      query: {
        'mine': 'driver',
        if (date != null) 'date': _d(date),
        if (matchMyRoute) 'matchMyRoute': 'true',
      },
    );
    return [
      for (final r in (res['data'] as List? ?? const []))
        RideRequest.fromJson(r as Map<String, dynamic>),
    ];
  }

  /// First driver to claim wins; the rider is seated or queued (see ClaimResult).
  Future<ClaimResult> claim(String requestId) async {
    final res = await _api.post<Map<String, dynamic>>('/ride-requests/$requestId/claim');
    return ClaimResult.fromJson(res);
  }

  static String _d(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

final rideRequestServiceProvider =
    Provider<RideRequestService>((ref) => RideRequestService(ref.watch(apiClientProvider)));

/// Whether the driver's list is filtered to their own route.
final matchMyRouteProvider = StateProvider<bool>((ref) => false);

/// Open requests offered to this driver, honouring the route filter.
final driverRideRequestsProvider = FutureProvider<List<RideRequest>>((ref) {
  final matchMyRoute = ref.watch(matchMyRouteProvider);
  return ref.watch(rideRequestServiceProvider).myOffers(matchMyRoute: matchMyRoute);
});
