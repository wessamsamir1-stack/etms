import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Per-tenant white-label branding resolved at runtime (maps to the DB
/// `tenant_branding.theme_json`). Drives the color scheme seed and app name so
/// each tenant sees the product as their own.
class TenantTheme {
  const TenantTheme({
    this.appName = 'ETMS',
    this.seedColor = AppColors.seed,
    this.logoUrl,
  });

  final String appName;
  final Color seedColor;
  final String? logoUrl;

  factory TenantTheme.fromJson(Map<String, dynamic> json) {
    Color parse(String? hex, Color fallback) {
      if (hex == null || !RegExp(r'^#[0-9A-Fa-f]{6}$').hasMatch(hex)) {
        return fallback;
      }
      return Color(int.parse('FF${hex.substring(1)}', radix: 16));
    }

    return TenantTheme(
      appName: json['app_name'] as String? ?? 'ETMS',
      seedColor: parse(json['primary_color'] as String?, AppColors.seed),
      logoUrl: json['logo_url'] as String?,
    );
  }

  static const fallback = TenantTheme();
}
