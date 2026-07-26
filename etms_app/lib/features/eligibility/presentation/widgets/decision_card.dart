import 'package:flutter/material.dart';

import '../../../../shared/widgets/status_chip.dart';
import '../../domain/entities/eligibility_decision.dart';

/// One pending decision in the review queue with approve/reject actions.
class DecisionCard extends StatelessWidget {
  const DecisionCard({
    super.key,
    required this.decision,
    required this.onApprove,
    required this.onReject,
    this.busy = false,
  });

  final EligibilityDecision decision;
  final VoidCallback onApprove;
  final VoidCallback onReject;
  final bool busy;

  ({String status, String label}) get _band => switch (decision.band) {
        Band.green => (status: 'completed', label: 'GREEN'),
        Band.amber => (status: 'waitlisted', label: 'AMBER'),
        Band.red => (status: 'exception', label: 'RED'),
      };

  @override
  Widget build(BuildContext context) {
    final band = _band;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      StatusChip(status: band.status, label: band.label),
                      const SizedBox(width: 8),
                      Text('Risk ${decision.riskScore}',
                          style: Theme.of(context).textTheme.bodySmall,),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text('Employee ${decision.employeeId}',
                      maxLines: 1, overflow: TextOverflow.ellipsis,),
                ],
              ),
            ),
            if (busy)
              const SizedBox(
                height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2),)
            else ...[
              IconButton(
                tooltip: 'Reject',
                onPressed: onReject,
                icon: Icon(Icons.close, color: Theme.of(context).colorScheme.error),
              ),
              FilledButton(onPressed: onApprove, child: const Text('Approve')),
            ],
          ],
        ),
      ),
    );
  }
}
