import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../shared/widgets/state_views.dart';
import '../providers/eligibility_providers.dart';
import '../widgets/decision_card.dart';

/// Admin approvals queue (O-30 / docs/etms/11): pending eligibility decisions a
/// reviewer approves or rejects. GREEN cases appear here in shadow mode; AMBER
/// always. Auto-approved (live GREEN) decisions never enter the queue.
class ApprovalsScreen extends ConsumerWidget {
  const ApprovalsScreen({super.key});

  Future<void> _act(BuildContext context, WidgetRef ref, String id, String outcome) async {
    final ok = await ref.read(approvalsControllerProvider.notifier).overrideDecision(id, outcome);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ok ? 'Decision $outcome' : 'Action failed')),
      );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final queue = ref.watch(reviewQueueProvider);
    final busy = ref.watch(approvalsControllerProvider).isLoading;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Approvals'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(reviewQueueProvider),
          ),
        ],
      ),
      body: queue.when(
        loading: () => const LoadingIndicator(),
        error: (e, _) => ErrorView(
          message: e.toString(),
          onRetry: () => ref.invalidate(reviewQueueProvider),
        ),
        data: (list) => list.isEmpty
            ? const EmptyState(icon: Icons.verified_outlined, title: 'No pending approvals')
            : RefreshIndicator(
                onRefresh: () async => ref.invalidate(reviewQueueProvider),
                child: ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: list.length,
                  itemBuilder: (_, i) {
                    final d = list[i];
                    return DecisionCard(
                      decision: d,
                      busy: busy,
                      onApprove: () => _act(context, ref, d.id, 'approved'),
                      onReject: () => _act(context, ref, d.id, 'rejected'),
                    );
                  },
                ),
              ),
      ),
    );
  }
}
