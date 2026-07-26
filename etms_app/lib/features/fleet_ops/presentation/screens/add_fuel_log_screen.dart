import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/fleet_ops_models.dart';
import '../providers/fleet_ops_providers.dart';

/// Record a fuel fill (POST /v1/fuel-logs). The driver is optional — a driver
/// user is resolved server-side from their linked driver row.
class AddFuelLogScreen extends ConsumerStatefulWidget {
  const AddFuelLogScreen({super.key});
  @override
  ConsumerState<AddFuelLogScreen> createState() => _AddFuelLogScreenState();
}

class _AddFuelLogScreenState extends ConsumerState<AddFuelLogScreen> {
  final _form = GlobalKey<FormState>();
  final _liters = TextEditingController();
  final _cost = TextEditingController();
  final _odometer = TextEditingController();
  final _station = TextEditingController();
  String? _vehicleId;
  String _fuelType = 'petrol_91';
  bool _saving = false;

  @override
  void dispose() {
    _liters.dispose();
    _cost.dispose();
    _odometer.dispose();
    _station.dispose();
    super.dispose();
  }

  Future<void> _save(bool ar) async {
    if (!_form.currentState!.validate() || _vehicleId == null) return;
    setState(() => _saving = true);
    try {
      await ref.read(fleetOpsServiceProvider).addFuelLog(
            vehicleId: _vehicleId!,
            liters: double.parse(_liters.text.trim()),
            costAmount: double.parse(_cost.text.trim()),
            fuelType: _fuelType,
            odometerKm: int.tryParse(_odometer.text.trim()),
            station: _station.text.trim(),
          );
      ref.invalidate(fuelLogsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(ar ? 'تم تسجيل التعبئة' : 'Fill recorded')));
        context.pop();
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(ar ? 'تعذّر الحفظ — حاول مرة أخرى' : 'Could not save — try again')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final vehicles = ref.watch(vehicleOptionsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'تعبئة بنزين' : 'Record fuel fill')),
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
                  for (final v in list)
                    DropdownMenuItem(value: v.id, child: Text(v.plateNo)),
                ],
                onChanged: (v) => setState(() => _vehicleId = v),
                validator: (v) => v == null ? (ar ? 'اختر المركبة' : 'Pick a vehicle') : null,
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _fuelType,
              decoration: InputDecoration(labelText: ar ? 'نوع الوقود' : 'Fuel type'),
              items: [
                DropdownMenuItem(value: 'petrol_91', child: Text(ar ? 'بنزين ٩١' : 'Petrol 91')),
                DropdownMenuItem(value: 'petrol_95', child: Text(ar ? 'بنزين ٩٥' : 'Petrol 95')),
                DropdownMenuItem(value: 'diesel', child: Text(ar ? 'ديزل' : 'Diesel')),
              ],
              onChanged: (v) => setState(() => _fuelType = v ?? 'petrol_91'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _liters,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: ar ? 'عدد اللترات' : 'Liters'),
              validator: (v) {
                final n = double.tryParse((v ?? '').trim());
                return (n == null || n <= 0) ? (ar ? 'أدخل عدد لترات صحيح' : 'Enter valid liters') : null;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _cost,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: ar ? 'التكلفة' : 'Cost'),
              validator: (v) {
                final n = double.tryParse((v ?? '').trim());
                return (n == null || n < 0) ? (ar ? 'أدخل تكلفة صحيحة' : 'Enter a valid cost') : null;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _odometer,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                  labelText: ar ? 'عداد الكيلومترات (اختياري)' : 'Odometer km (optional)'),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _station,
              decoration:
                  InputDecoration(labelText: ar ? 'المحطة (اختياري)' : 'Station (optional)'),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: _saving ? null : () => _save(ar),
              icon: _saving
                  ? const SizedBox(
                      width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.save_outlined),
              label: Text(ar ? 'حفظ' : 'Save'),
            ),
          ],
        ),
      ),
    );
  }
}
