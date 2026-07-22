import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/di/providers.dart';
import '../../core/localization/l10n_extensions.dart';
import '../../core/offline/sync_status.dart';

/// Global offline-sync indicator: Synced / N pending / Sync failed.
class SyncStatusChip extends ConsumerWidget {
  const SyncStatusChip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(syncStateProvider).valueOrNull ?? const SyncState();
    final scheme = Theme.of(context).colorScheme;

    late final Color color;
    late final IconData icon;
    late final String label;
    if (state.failed > 0) {
      color = scheme.error;
      icon = Icons.sync_problem;
      label = context.l10n.syncFailed;
    } else if (state.pending > 0 || state.syncing) {
      color = scheme.tertiary;
      icon = Icons.sync;
      label = context.l10n.syncPending(state.pending);
    } else {
      color = scheme.primary;
      icon = Icons.cloud_done_outlined;
      label = context.l10n.syncSynced;
    }

    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 12),
      child: Chip(
        avatar: Icon(icon, size: 16, color: color),
        label: Text(label, style: TextStyle(color: color, fontSize: 12)),
        visualDensity: VisualDensity.compact,
      ),
    );
  }
}
