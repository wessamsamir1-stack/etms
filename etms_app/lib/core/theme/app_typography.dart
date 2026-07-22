import 'package:flutter/material.dart';

/// Typography ramp. Uses Cairo for Arabic-friendly rendering when bundled;
/// falls back to the platform default otherwise.
abstract final class AppTypography {
  static const fontFamily = 'Cairo';

  static TextTheme apply(TextTheme base) => base.apply(
        fontFamily: fontFamily,
      );
}
