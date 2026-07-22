/// Low-level exceptions thrown by data sources. The repository layer catches
/// these and maps them to [Failure]s (see error/failures.dart) so the domain
/// and presentation layers never deal with raw exceptions.
sealed class AppException implements Exception {
  const AppException(this.message, {this.cause});
  final String message;
  final Object? cause;

  @override
  String toString() => '$runtimeType: $message';
}

class ServerException extends AppException {
  const ServerException(super.message, {this.statusCode, super.cause});
  final int? statusCode;
}

class NetworkException extends AppException {
  const NetworkException([super.message = 'No internet connection']);
}

class AuthException extends AppException {
  const AuthException(super.message, {super.cause});
}

class CacheException extends AppException {
  const CacheException(super.message, {super.cause});
}

class ValidationException extends AppException {
  const ValidationException(super.message, {this.fieldErrors = const {}});
  final Map<String, String> fieldErrors;
}
