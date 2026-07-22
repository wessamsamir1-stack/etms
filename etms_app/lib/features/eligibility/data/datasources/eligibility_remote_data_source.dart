import '../../../../core/network/api_client.dart';
import '../dtos/eligibility_dto.dart';

/// Talks to the backend eligibility REST API (see backend/openapi.yaml).
///
/// NOTE: this uses the ETMS REST API (Dio [ApiClient]) with the backend-issued
/// JWT — so the app must authenticate against the backend, not only Supabase.
/// Reconciling the two auth paths is the documented integration prerequisite.
abstract interface class EligibilityRemoteDataSource {
  Future<List<EligibilityDecisionDto>> reviewQueue({String? band});
  Future<EligibilityDecisionDto> decide(String employeeId);
  Future<void> overrideDecision(String decisionId, String outcome);
}

class EligibilityRemoteDataSourceImpl implements EligibilityRemoteDataSource {
  EligibilityRemoteDataSourceImpl(this._api);
  final ApiClient _api;

  @override
  Future<List<EligibilityDecisionDto>> reviewQueue({String? band}) async {
    final res = await _api.get<Map<String, dynamic>>(
      '/eligibility/queue',
      query: {if (band != null) 'band': band},
    );
    final list = (res['data'] as List? ?? const []);
    return list
        .map((e) => EligibilityDecisionDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<EligibilityDecisionDto> decide(String employeeId) async {
    // The decisions endpoint returns the row unwrapped.
    final res = await _api.post<Map<String, dynamic>>(
      '/eligibility/decisions',
      body: {'employeeId': employeeId},
    );
    return EligibilityDecisionDto.fromJson(res);
  }

  @override
  Future<void> overrideDecision(String decisionId, String outcome) async {
    await _api.post<Map<String, dynamic>>(
      '/eligibility/decisions/$decisionId/override',
      body: {'outcome': outcome},
    );
  }
}
