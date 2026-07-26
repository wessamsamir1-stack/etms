import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';

/// Maps a trip/booking status string to the shared status-color language.
class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.status, required this.label});
  final String status;
  final String label;

  Color get _color => switch (status) {
        'scheduled' => AppColors.scheduled,
        'assigned' => AppColors.assigned,
        'started' || 'in_progress' => AppColors.inProgress,
        'completed' => AppColors.completed,
        'waitlisted' => AppColors.warning,
        'cancelled' || 'exception' || 'no_show' => AppColors.danger,
        _ => AppColors.scheduled,
      };

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: _color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(color: _color, fontSize: 12, fontWeight: FontWeight.w600),
      ),
    );
  }
}
