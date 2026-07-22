import 'dart:async';

import 'package:dio/dio.dart';

import '../../constants/app_constants.dart';
import '../../storage/secure_storage.dart';

/// Attaches the bearer token + tenant context to every request, and performs a
/// single refresh-token retry on 401 (mirrors the API contract in
/// docs/etms/06-api-spec.md).
class AuthInterceptor extends QueuedInterceptorsWrapper {
  AuthInterceptor(this._storage, this._refresh);

  final SecureStorage _storage;
  /// Injected refresh callback: returns a fresh access token or null on failure.
  final Future<String?> Function() _refresh;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await _storage.read(AppConstants.kAccessToken);
    final tenant = await _storage.read(AppConstants.kTenantId);
    if (token != null) options.headers['Authorization'] = 'Bearer $token';
    if (tenant != null) options.headers[AppConstants.hTenant] = tenant;
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final alreadyRetried = err.requestOptions.extra['retried'] == true;
    if (err.response?.statusCode == 401 && !alreadyRetried) {
      final newToken = await _refresh();
      if (newToken != null) {
        final req = err.requestOptions
          ..extra['retried'] = true
          ..headers['Authorization'] = 'Bearer $newToken';
        try {
          final clone = await Dio().fetch<dynamic>(req);
          return handler.resolve(clone);
        } catch (_) {/* fall through to original error */}
      }
    }
    handler.next(err);
  }
}
