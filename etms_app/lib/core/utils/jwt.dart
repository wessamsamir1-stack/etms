import 'dart:convert';

/// Decodes a JWT's payload claims (no verification — the server verifies; the
/// client only reads sub/tenant_id/permissions/exp to hydrate the session).
Map<String, dynamic> decodeJwtPayload(String token) {
  final parts = token.split('.');
  if (parts.length != 3) return const {};
  try {
    final decoded = utf8.decode(base64Url.decode(base64Url.normalize(parts[1])));
    final map = jsonDecode(decoded);
    return map is Map<String, dynamic> ? map : const {};
  } catch (_) {
    return const {};
  }
}

bool isJwtExpired(Map<String, dynamic> claims, {int skewSeconds = 30}) {
  final exp = claims['exp'];
  if (exp is! int) return false;
  final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
  return now + skewSeconds >= exp;
}
