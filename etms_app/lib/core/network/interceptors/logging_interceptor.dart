import 'package:dio/dio.dart';

import '../../utils/logger.dart';

/// Lightweight request/response logger for non-production flavors.
class LoggingInterceptor extends InterceptorsWrapper {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    appLogger.d('→ ${options.method} ${options.uri}');
    handler.next(options);
  }

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    appLogger.d('← ${response.statusCode} ${response.requestOptions.uri}');
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    appLogger.w('✗ ${err.response?.statusCode} ${err.requestOptions.uri}',
        error: err.message);
    handler.next(err);
  }
}
