import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../error/exceptions.dart';

/// Thin wrapper over Dio for the ETMS REST API. Data sources depend on this,
/// not on Dio directly, so transport concerns stay in one place. It maps Dio
/// errors to typed [AppException]s per the API error model.
class ApiClient {
  ApiClient(this._dio);
  final Dio _dio;

  factory ApiClient.create(AppConfig config, List<Interceptor> interceptors) {
    final dio = Dio(
      BaseOptions(
        baseUrl: config.apiBaseUrl,
        connectTimeout: config.requestTimeout,
        receiveTimeout: config.requestTimeout,
        contentType: 'application/json',
        headers: {'Accept-Language': config.defaultLocale},
      ),
    )..interceptors.addAll(interceptors);
    return ApiClient(dio);
  }

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) =>
      _request(() => _dio.get<T>(path, queryParameters: query));

  Future<T> post<T>(String path, {Object? body, Map<String, dynamic>? query}) =>
      _request(() => _dio.post<T>(path, data: body, queryParameters: query));

  Future<T> put<T>(String path, {Object? body}) =>
      _request(() => _dio.put<T>(path, data: body));

  Future<T> patch<T>(String path, {Object? body}) =>
      _request(() => _dio.patch<T>(path, data: body));

  Future<T> delete<T>(String path) => _request(() => _dio.delete<T>(path));

  Future<T> _request<T>(Future<Response<T>> Function() run) async {
    try {
      final res = await run();
      return res.data as T;
    } on DioException catch (e) {
      throw _map(e);
    }
  }

  AppException _map(DioException e) {
    if (e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout) {
      return const NetworkException();
    }
    final status = e.response?.statusCode;
    final data = e.response?.data;
    final detail = data is Map && data['detail'] is String
        ? data['detail'] as String
        : e.message ?? 'Request failed';
    if (status == 401 || status == 403) return AuthException(detail, cause: e);
    if (status == 422 && data is Map) {
      final errs = <String, String>{};
      for (final it in (data['errors'] as List? ?? const [])) {
        if (it is Map) errs['${it['field']}'] = '${it['message']}';
      }
      return ValidationException(detail, fieldErrors: errs);
    }
    return ServerException(detail, statusCode: status, cause: e);
  }
}
