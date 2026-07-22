import '../../../../core/network/api_client.dart';
import '../dtos/trip_dto.dart';

/// REST calls for trips (see docs/etms/06-api-spec.md). Read/refresh over the
/// ETMS API; realtime deltas come via BackendClient.watch in the repository.
abstract interface class TripRemoteDataSource {
  Future<List<TripDto>> fetchToday();

  /// Push a batch of trip events (offline-replay safe via client_event_id).
  Future<void> postEvents(String tripId, List<Map<String, dynamic>> events);
}

class TripRemoteDataSourceImpl implements TripRemoteDataSource {
  TripRemoteDataSourceImpl(this._api);
  final ApiClient _api;

  @override
  Future<List<TripDto>> fetchToday() async {
    final data = await _api.get<Map<String, dynamic>>(
      '/driver/trips',
      query: {'date': 'today'},
    );
    final list = (data['data'] as List? ?? const []);
    return list
        .map((e) => TripDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<void> postEvents(
      String tripId, List<Map<String, dynamic>> events) async {
    await _api.post<Map<String, dynamic>>(
      '/trips/$tripId/events',
      body: {'events': events},
    );
  }
}
