import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/access/permissions.dart';
import '../../../../core/router/app_routes.dart';
import '../../data/fleet_ops_models.dart';
import '../providers/fleet_ops_providers.dart';

/// Traffic-violation register (GET /v1/violations) with a status filter.
/// Managers (violation.manage) can change a violation's status and add new ones.
class ViolationsScreen extends ConsumerStatefulWidget {
  const ViolationsScreen({super.key});
  @override
  ConsumerState<ViolationsScreen> createState() => _ViolationsScreenState();
}

class _ViolationsScreenState extends ConsumerState<ViolationsScreen> {
  ViolationStatus? _filter;

  @override
  Widget build(BuildContext context) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final canManage = ref.can('violation.manage');
    final async = ref.watch(violationsProvider(_filter));
    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'المخالفات' : 'Violations')),
      floatingActionButton: canManage
          ? FloatingActionButton.extended(
              onPressed: () => context.push(AppRoutes.violationAdd),
              icon: const Icon(Icons.receipt_long),
              label: Text(ar ? 'مخالفة جديدة' : 'New violation'),
            )
          : null,
      body: Column(
        children: [
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                _filterChip(null, ar ? 'الكل' : 'All'),
                _filterChip(ViolationStatus.pending, ar ? 'قيد السداد' : 'Pending'),
                _filterChip(ViolationStatus.paid, ar ? 'مدفوعة' : 'Paid'),
                _filterChip(ViolationStatus.disputed, ar ? 'معترض عليها' : 'Disputed'),
                _filterChip(ViolationStatus.deducted, ar ? 'مخصومة' : 'Deducted'),
                _filterChip(ViolationStatus.waived, ar ? 'ملغاة' : 'Waived'),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async => ref.invalidate(violationsProvider(_filter)),
              child: async.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (e, _) => ListView(children: [
                  const SizedBox(height: 120),
                  Center(
                      child:
                          Text(ar ? 'تعذّر تحميل المخالفات' : 'Could not load violations')),
                ]),
                data: (items) => items.isEmpty
                    ? ListView(children: [
                        const SizedBox(height: 120),
                        Center(child: Text(ar ? 'لا مخالفات' : 'No violations')),
                      ])
                    : ListView(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
                        children: [
                          for (final v in items)
                            _ViolationTile(
                              violation: v,
                              ar: ar,
                              onTap: canManage ? () => _changeStatus(v, ar) : null,
                            ),
                        ],
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _filterChip(ViolationStatus? s, String label) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
        child: FilterChip(
          label: Text(label),
          selected: _filter == s,
          onSelected: (_) => setState(() => _filter = s),
        ),
      );

  Future<void> _changeStatus(Violation v, bool ar) async {
    final s = await showModalBottomSheet<ViolationStatus>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
                title: Text(
                    ar ? 'تغيير حالة المخالفة ${v.violationNo ?? ''}' : 'Change status ${v.violationNo ?? ''}',
                    style: const TextStyle(fontWeight: FontWeight.w700))),
            for (final opt in ViolationStatus.values.where((o) => o != ViolationStatus.unknown))
              ListTile(
                leading: Icon(Icons.circle, size: 12, color: statusColor(opt)),
                title: Text(statusLabel(opt, ar)),
                onTap: () => Navigator.pop(ctx, opt),
              ),
          ],
        ),
      ),
    );
    if (s == null || s == v.status) return;
    try {
      await ref.read(fleetOpsServiceProvider).setViolationStatus(v.id, s);
      ref.invalidate(violationsProvider);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(ar ? 'تعذّر تحديث الحالة' : 'Could not update status')));
      }
    }
  }
}

Color statusColor(ViolationStatus s) => switch (s) {
      ViolationStatus.paid => const Color(0xFF1E9E58),
      ViolationStatus.pending => const Color(0xFFE1554E),
      ViolationStatus.disputed => const Color(0xFFB07708),
      ViolationStatus.deducted => const Color(0xFF1E5AA8),
      _ => const Color(0xFF8494AC),
    };

String statusLabel(ViolationStatus s, bool ar) => switch (s) {
      ViolationStatus.pending => ar ? 'قيد السداد' : 'Pending',
      ViolationStatus.paid => ar ? 'مدفوعة' : 'Paid',
      ViolationStatus.disputed => ar ? 'معترض عليها' : 'Disputed',
      ViolationStatus.waived => ar ? 'ملغاة' : 'Waived',
      ViolationStatus.deducted => ar ? 'مخصومة' : 'Deducted',
      ViolationStatus.unknown => ar ? 'غير معروفة' : 'Unknown',
    };

String typeLabel(String t, bool ar) => switch (t) {
      'speeding' => ar ? 'سرعة زائدة' : 'Speeding',
      'parking' => ar ? 'وقوف خاطئ' : 'Parking',
      'red_light' => ar ? 'قطع إشارة' : 'Red light',
      'phone_use' => ar ? 'استخدام الهاتف' : 'Phone use',
      'seat_belt' => ar ? 'حزام الأمان' : 'Seat belt',
      'lane' => ar ? 'مخالفة مسار' : 'Lane',
      'overload' => ar ? 'حمولة زائدة' : 'Overload',
      'documents' => ar ? 'أوراق ناقصة' : 'Documents',
      _ => ar ? 'أخرى' : 'Other',
    };

class _ViolationTile extends StatelessWidget {
  const _ViolationTile({required this.violation, required this.ar, this.onTap});
  final Violation violation;
  final bool ar;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final v = violation;
    final d = v.occurredAt;
    final date = d == null
        ? ''
        : '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        onTap: onTap,
        leading: CircleAvatar(radius: 6, backgroundColor: statusColor(v.status)),
        title: Text('${v.plateNo} · ${typeLabel(v.type, ar)}'),
        subtitle: Text([
          date,
          if (v.driver != null) v.driver!,
          if (v.violationNo != null) '#${v.violationNo}',
          if (v.location != null && v.location!.isNotEmpty) v.location!,
        ].join(' · ')),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text('${v.amount.toStringAsFixed(2)} ${v.currency}',
                style: const TextStyle(fontWeight: FontWeight.w700)),
            Text(statusLabel(v.status, ar),
                style: TextStyle(color: statusColor(v.status), fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
