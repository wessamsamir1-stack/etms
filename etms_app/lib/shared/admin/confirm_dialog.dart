import 'package:flutter/material.dart';

import '../../core/localization/l10n_extensions.dart';

/// Standard confirmation for destructive actions.
Future<bool> confirm(
  BuildContext context, {
  required String title,
  required String message,
  bool destructive = true,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (_) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: Text(context.l10n.commonCancel),
        ),
        FilledButton(
          style: destructive
              ? FilledButton.styleFrom(
                  backgroundColor: Theme.of(context).colorScheme.error,)
              : null,
          onPressed: () => Navigator.pop(context, true),
          child: Text(context.l10n.commonSave),
        ),
      ],
    ),
  );
  return ok ?? false;
}
