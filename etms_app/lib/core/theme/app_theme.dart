import 'package:flutter/material.dart';

import 'app_typography.dart';
import 'tenant_theme.dart';

/// Builds Material 3 light/dark themes from a [TenantTheme] seed so white-label
/// branding flows through the whole app from one source.
abstract final class AppTheme {
  static ThemeData light(TenantTheme tenant) => _build(tenant, Brightness.light);
  static ThemeData dark(TenantTheme tenant) => _build(tenant, Brightness.dark);

  static ThemeData _build(TenantTheme tenant, Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
      seedColor: tenant.seedColor,
      brightness: brightness,
    );
    final base = ThemeData(useMaterial3: true, colorScheme: scheme);
    return base.copyWith(
      textTheme: AppTypography.apply(base.textTheme),
      appBarTheme: const AppBarTheme(centerTitle: false),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        isDense: true,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
    );
  }
}
