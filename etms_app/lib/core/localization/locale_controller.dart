import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../constants/app_constants.dart';
import '../di/providers.dart';

/// Persists and exposes the active locale. Riverpod Notifier (non-codegen).
class LocaleController extends Notifier<Locale> {
  @override
  Locale build() {
    final saved = ref.read(keyValueStoreProvider).getString(AppConstants.kLocale);
    return Locale(saved ?? 'ar');
  }

  Future<void> setLocale(String code) async {
    if (!AppConstants.supportedLocales.contains(code)) return;
    await ref.read(keyValueStoreProvider).setString(AppConstants.kLocale, code);
    state = Locale(code);
  }

  void toggle() => setLocale(state.languageCode == 'ar' ? 'en' : 'ar');
}

final localeControllerProvider =
    NotifierProvider<LocaleController, Locale>(LocaleController.new);

/// Theme-mode controller (light/dark/system) persisted alongside locale.
class ThemeModeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    final saved =
        ref.read(keyValueStoreProvider).getString(AppConstants.kThemeMode);
    return switch (saved) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
  }

  Future<void> set(ThemeMode mode) async {
    await ref
        .read(keyValueStoreProvider)
        .setString(AppConstants.kThemeMode, mode.name);
    state = mode;
  }
}

final themeModeControllerProvider =
    NotifierProvider<ThemeModeController, ThemeMode>(ThemeModeController.new);
