import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/fleet_ops_providers.dart';
import 'violations_screen.dart' show typeLabel;

const _violationTypes = [
  'speeding', 'parking', 'red_light', 'phone_use', 'seat_belt', 'lane', 'overload', 'documents', 'other',
];

/// Register a traffic violation (POST /v1/violations).
class AddViolationScreen extends ConsumerStatefulWidget {
  const AddViolationScreen({super.key});
  @override
  ConsumerState<AddViolationScreen> createState() => _AddViolationScreenState();
}

class _AddViolationScreenState extends ConsumerState<AddViolationScreen> {
  final _form = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _violationNo = TextEditingController();
  final _location = TextEditingController();
  final _notes = TextEditingController();
  String? _vehicleId;
  String? _driverId;
  String _type = 'other';
  bool _deduct = false;
  bool _saving = false;

  @override
  void dispose() {
    _amount.dispose();
    _violationNo.dispose();
    _location.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save(bool ar) async {
    if (!_form.currentState!.validate() || _vehicleId == null) return;
    setState(() => _saving = true);
    try {
      await ref.read(fleetOpsServiceProvider).addViolation(
            vehicleId: _vehicleId!,
            driverId: _driverId,
            violationType: _type,
            amount: double.parse(_amount.text.trim()),
            violationNo: _violationNo.text.trim(),
            location: _location.text.trim(),
            deductFromDriver: _deduct,
            notes: _notes.text.trim(),
          );
      ref.invalidate(violationsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(ar ? 'تم تسجيل المخالفة' : 'Violation registered')),);
        context.pop();
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(ar ? 'تعذّر الحفظ — حاول مرة أخرى' : 'Could not save — try again'),),);
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final vehicles = ref.watch(vehicleOptionsProvider);
    final drivers = ref.watch(driverOptionsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'تسجيل مخالفة' : 'Register violation')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            vehicles.when(
              loading: () => const LinearProgressIndicator(),
              error: (e, _) => Text(ar ? 'تعذّر تحميل المركبات' : 'Could not load vehicles'),
              data: (list) => DropdownButtonFormField<String>(
                value: _vehicleId,
                decoration: InputDecoration(labelText: ar ? 'المركبة' : 'Vehicle'),
                items: [
                  for (final v in list) DropdownMenuItem(value: v.id, child: Text(v.plateNo)),
                ],
                onChanged: (v) => setState(() => _vehicleId = v),
                validator: (v) => v == null ? (ar ? 'اختر المركبة' : 'Pick a vehicle') : null,
              ),
            ),
            const SizedBox(height: 12),
            drivers.when(
              loading: () => const SizedBox.shrink(),
              error: (e, _) => const SizedBox.shrink(), // driver stays optional
              data: (list) => DropdownButtonFormField<String>(
                value: _driverId,
                decoration:
                    InputDecoration(labelText: ar ? 'السائق (اختياري)' : 'Driver (optional)'),
                items: [
                  DropdownMenuItem(value: null, child: Text(ar ? 'بدون سائق' : 'No driver')),
                  for (final d in list) DropdownMenuItem(value: d.id, child: Text(d.fullName)),
                ],
                onChanged: (v) => setState(() => _driverId = v),
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _type,
              decoration: InputDecoration(labelText: ar ? 'نوع المخالفة' : 'Violation type'),
              items: [
                for (final t in _violationTypes)
                  DropdownMenuItem(value: t, child: Text(typeLabel(t, ar))),
              ],
              onChanged: (v) => setState(() => _type = v ?? 'other'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: ar ? 'قيمة المخالفة' : 'Fine amount'),
              validator: (v) {
                final n = double.tryParse((v ?? '').trim());
                return (n == null || n < 0) ? (ar ? 'أدخل قيمة صحيحة' : 'Enter a valid amount') : null;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _violationNo,
              decoration: InputDecoration(
                  labelText: ar ? 'رقم المخالفة (اختياري)' : 'Ticket number (optional)',),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _location,
              decoration:
                  InputDecoration(labelText: ar ? 'المكان (اختياري)' : 'Location (optional)'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _notes,
              maxLines: 2,
              decoration:
                  InputDecoration(labelText: ar ? 'ملاحظات (اختياري)' : 'Notes (optional)'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(ar ? 'خصم من السائق' : 'Deduct from driver'),
              value: _deduct,
              onChanged: (v) => setState(() => _deduct = v),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _saving ? null : () => _save(ar),
              icon: _saving
                  ? const SizedBox(
                      width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2),)
                  : const Icon(Icons.save_outlined),
              label: Text(ar ? 'حفظ' : 'Save'),
            ),
          ],
        ),
      ),
    );
  }
}
