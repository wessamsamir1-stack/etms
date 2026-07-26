import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/di/providers.dart';
import '../../core/localization/l10n_extensions.dart';

/// Slim banner shown while offline. Wrap page bodies with it so field users
/// always know their work is being saved locally.
class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final online =
        ref.watch(syncStateProvider).valueOrNull?.online ?? true;
    final scheme = Theme.of(context).colorScheme;
    return Column(
      children: [
        if (!online)
          Material(
            color: scheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: Row(
                children: [
                  Icon(Icons.wifi_off, size: 16, color: scheme.onErrorContainer),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      context.l10n.offlineBanner,
                      style: TextStyle(
                          color: scheme.onErrorContainer, fontSize: 12,),
                    ),
                  ),
                ],
              ),
            ),
          ),
        Expanded(child: child),
      ],
    );
  }
}
