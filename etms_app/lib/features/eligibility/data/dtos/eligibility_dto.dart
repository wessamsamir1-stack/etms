import '../../domain/entities/eligibility_decision.dart';

class EligibilityDecisionDto {
  const EligibilityDecisionDto({
    required this.id,
    required this.employeeId,
    required this.band,
    required this.outcome,
    required this.riskScore,
    this.createdAt,
  });

  final String id;
  final String employeeId;
  final String band;
  final String outcome;
  final int riskScore;
  final String? createdAt;

  factory EligibilityDecisionDto.fromJson(Map<String, dynamic> j) => EligibilityDecisionDto(
        id: j['id'] as String,
        employeeId: (j['employee_id'] ?? j['employeeId'] ?? '') as String,
        band: (j['band'] ?? 'green') as String,
        outcome: (j['outcome'] ?? 'needs_review') as String,
        riskScore: (j['risk_score'] as num?)?.toInt() ?? 0,
        createdAt: j['created_at'] as String?,
      );

  EligibilityDecision toEntity() => EligibilityDecision(
        id: id,
        employeeId: employeeId,
        band: Band.parse(band),
        outcome: outcome,
        riskScore: riskScore,
        createdAt: createdAt != null ? DateTime.tryParse(createdAt!) : null,
      );
}
