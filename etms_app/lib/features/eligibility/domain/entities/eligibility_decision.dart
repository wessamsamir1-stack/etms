import 'package:equatable/equatable.dart';

/// Approval band from the backend eligibility engine (docs/etms/11).
enum Band {
  green,
  amber,
  red;

  static Band parse(String? raw) => switch (raw) {
        'amber' => Band.amber,
        'red' => Band.red,
        _ => Band.green,
      };
}

/// A persisted eligibility decision shown in the admin approvals queue.
class EligibilityDecision extends Equatable {
  const EligibilityDecision({
    required this.id,
    required this.employeeId,
    required this.band,
    required this.outcome,
    required this.riskScore,
    this.createdAt,
  });

  final String id;
  final String employeeId;
  final Band band;
  final String outcome; // approved | rejected | needs_review
  final int riskScore;
  final DateTime? createdAt;

  @override
  List<Object?> get props => [id, outcome, band, riskScore];
}
