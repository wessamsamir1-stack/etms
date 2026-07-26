import 'package:dio/dio.dart';

import '../../../../core/config/app_config.dart';
import '../../../../core/error/exceptions.dart';

/// Result of a backend login/refresh — the JWT + refresh token + user profile.
class BackendAuthResult {
  const BackendAuthResult({
    required this.accessToken,
    required this.refreshToken,
    required this.userId,
    required this.tenantId,
    required this.fullName,
    required this.permissions,
  });

  final String accessToken;
  final String? refreshToken;
  final String userId;
  final String tenantId;
  final String fullName;
  final List<String> permissions;
}

/// Authenticates against the ETMS backend REST API (`/v1/auth/*`). Uses a bare
/// Dio (no auth interceptor) since these endpoints are unauthenticated and we
/// must avoid a refresh loop.
abstract interface class BackendAuthDataSource {
  Future<BackendAuthResult> login(String tenantSlug, String email, String password);
  Future<String> refresh(String refreshToken);
  Future<void> logout(String refreshToken);
}

class BackendAuthDataSourceImpl implements BackendAuthDataSource {
  BackendAuthDataSourceImpl(AppConfig config)
      : _dio = Dio(BaseOptions(
          baseUrl: config.apiBaseUrl,
          connectTimeout: config.requestTimeout,
          receiveTimeout: config.requestTimeout,
        ),);
  final Dio _dio;

  @override
  Future<BackendAuthResult> login(String tenantSlug, String email, String password) async {
    try {
      final res = await _dio.post<Map<String, dynamic>>('/auth/login', data: {
        'tenantSlug': tenantSlug,
        'email': email,
        'password': password,
      },);
      final data = res.data!;
      final user = data['user'] as Map<String, dynamic>;
      return BackendAuthResult(
        accessToken: data['access_token'] as String,
        refreshToken: data['refresh_token'] as String?,
        userId: user['id'] as String,
        tenantId: user['tenantId'] as String,
        fullName: (user['fullName'] ?? '') as String,
        permissions: (user['permissions'] as List?)?.map((e) => '$e').toList() ?? const [],
      );
    } on DioException catch (e) {
      final code = e.response?.statusCode;
      if (code == 401 || code == 403) throw AuthException('Invalid credentials', cause: e);
      if (code == 429) throw const AuthException('Too many attempts; try again later');
      throw ServerException('Login failed', statusCode: code, cause: e);
    }
  }

  @override
  Future<String> refresh(String refreshToken) async {
    final res = await _dio.post<Map<String, dynamic>>('/auth/refresh', data: {
      'refreshToken': refreshToken,
    },);
    return res.data!['access_token'] as String;
  }

  @override
  Future<void> logout(String refreshToken) async {
    try {
      await _dio.post<void>('/auth/logout', data: {'refreshToken': refreshToken});
    } catch (_) {
      // best-effort
    }
  }
}
