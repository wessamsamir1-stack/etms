import 'package:flutter/material.dart';

/// Brand-neutral seed palette. Per-tenant white-label overrides replace the
/// seed at runtime via [TenantTheme] (see tenant_theme.dart).
abstract final class AppColors {
  static const seed = Color(0xFF1E5AA8);

  // Semantic status colors (shared/widgets/status_chip maps trip states to these)
  static const scheduled = Color(0xFF6B7280);
  static const assigned = Color(0xFF2563EB);
  static const inProgress = Color(0xFF0EA5E9);
  static const completed = Color(0xFF16A34A);
  static const warning = Color(0xFFD97706);
  static const danger = Color(0xFFDC2626);
}
