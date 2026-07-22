import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/di/providers.dart';
import '../core/theme/tenant_theme.dart';
import '../features/auth/presentation/providers/auth_providers.dart';

/// Applies the tenant's white-label branding at runtime (docs/etms/17 §10).
/// On sign-in it fetches `GET /v1/branding` and pushes the result into
/// [tenantThemeProvider] so the whole app re-themes (colours + app name) to the
/// company's identity; on sign-out it reverts to the neutral brand. Watch this
/// once in the app root to activate the listener.
final brandingLoaderProvider = Provider<void>((ref) {
  ref.listen(currentUserProvider, (previous, user) async {
    final notifier = ref.read(tenantThemeProvider.notifier);
    if (user == null) {
      notifier.state = TenantTheme.fallback;
      return;
    }
    try {
      final res = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/branding');
      final data = (res['data'] as Map<String, dynamic>?) ?? const {};
      notifier.state = TenantTheme.fromJson(data);
    } catch (_) {
      // Keep the current theme if branding can't be fetched.
    }
  }, fireImmediately: true);
});
