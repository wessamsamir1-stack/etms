import 'package:flutter/widgets.dart';

import '../../l10n/generated/app_localizations.dart';

/// `context.l10n.loginTitle` — terse access to the generated strings.
/// AppLocalizations is produced by `flutter gen-l10n` from lib/l10n/arb.
extension L10nX on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);
}
