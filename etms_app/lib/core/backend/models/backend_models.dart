import 'package:equatable/equatable.dart';

/// Provider-agnostic authenticated session returned by [BackendClient].
class BackendSession extends Equatable {
  const BackendSession({
    required this.userId,
    required this.accessToken,
    this.refreshToken,
    this.tenantId,
    this.email,
  });

  final String userId;
  final String accessToken;
  final String? refreshToken;
  final String? tenantId;
  final String? email;

  @override
  List<Object?> get props => [userId, accessToken, refreshToken, tenantId];
}

/// A minimal, provider-agnostic query description used by [BackendClient.fetch]
/// and [BackendClient.watch]. Adapters translate this to Supabase filters or
/// Firestore queries.
class QuerySpec {
  const QuerySpec({
    this.equals = const {},
    this.orderBy,
    this.descending = false,
    this.limit,
  });

  final Map<String, Object?> equals;
  final String? orderBy;
  final bool descending;
  final int? limit;
}
