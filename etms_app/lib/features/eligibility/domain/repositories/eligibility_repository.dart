import 'package:fpdart/fpdart.dart';

import '../../../../core/error/failures.dart';
import '../entities/eligibility_decision.dart';

/// Domain contract for the AI-assisted approvals workflow (backend eligibility API).
abstract interface class EligibilityRepository {
  /// Pending decisions awaiting human review (optionally filtered by band).
  Future<Either<Failure, List<EligibilityDecision>>> reviewQueue({String? band});

  /// Run + persist a decision for an employee (auto-approves GREEN when the
  /// tenant policy is `live`; otherwise records a recommendation).
  Future<Either<Failure, EligibilityDecision>> decide(String employeeId);

  /// Human override of a decision to approved/rejected.
  Future<Either<Failure, Unit>> overrideDecision(String decisionId, String outcome);
}
