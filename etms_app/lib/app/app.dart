import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/di/providers.dart';
import '../core/localization/locale_controller.dart';
import '../core/router/app_router.dart';
import '../core/theme/app_theme.dart';
import '../l10n/generated/app_localizations.dart';
import 'branding_loader.dart';

/// Root widget: wires router, localization, and white-label theming, all driven
/// by Riverpod so a locale/theme/tenant change rebuilds the whole app reactively.
class EtmsApp extends ConsumerWidget {
  const EtmsApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(goRouterProvider);
    ref.watch(brandingLoaderProvider); // fetch + apply white-label branding on sign-in
    final tenant = ref.watch(tenantThemeProvider);
    final locale = ref.watch(localeControllerProvider);
    final themeMode = ref.watch(themeModeControllerProvider);

    return MaterialApp.router(
      // White-label app name once branding loads; otherwise the localized title.
      onGenerateTitle: (ctx) =>
          tenant.appName == 'ETMS' ? AppLocalizations.of(ctx).appTitle : tenant.appName,
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: AppTheme.light(tenant),
      darkTheme: AppTheme.dark(tenant),
      themeMode: themeMode,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
    );
  }
}
