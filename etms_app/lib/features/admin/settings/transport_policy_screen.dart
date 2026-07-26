import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';

/// Admin: the daily-commute waiting timer + pre-arrival reminders
/// (docs/etms/17 §3–4). GET/PUT /v1/transport-policy.
final _policyProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final res = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/transport-policy');
  return (res['data'] as Map<String, dynamic>?) ?? const {};
});

class TransportPolicyScreen extends ConsumerWidget {
  const TransportPolicyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final async = ref.watch(_policyProvider);
    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'مؤقّت الانتظار' : 'Waiting timer')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(ar ? 'تعذّر التحميل' : 'Could not load')),
        data: (p) => _Form(initial: p, ar: ar),
      ),
    );
  }
}

class _Form extends ConsumerStatefulWidget {
  const _Form({required this.initial, required this.ar});
  final Map<String, dynamic> initial;
  final bool ar;
  @override
  ConsumerState<_Form> createState() => _FormState();
}

class _FormState extends ConsumerState<_Form> {
  // Common presets (seconds) matching the spec examples: 1 / 2 / 3 / 5 minutes.
  static const _presets = [60, 120, 180, 300];
  late int _wait;
  late TextEditingController _notify;
  late bool _skip;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _wait = (widget.initial['wait_seconds'] as num?)?.toInt() ?? 120;
    final list = (widget.initial['notify_before_min'] as List?)?.map((e) => '$e').join(', ') ?? '10, 3';
    _notify = TextEditingController(text: list);
    _skip = widget.initial['allow_driver_skip'] as bool? ?? true;
  }

  @override
  void dispose() {
    _notify.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final ar = widget.ar;
    setState(() => _busy = true);
    try {
      final notify = _notify.text
          .split(RegExp(r'[,\s]+'))
          .where((s) => s.isNotEmpty)
          .map(int.tryParse)
          .whereType<int>()
          .toList();
      await ref.read(apiClientProvider).put<Map<String, dynamic>>('/transport-policy', body: {
        'wait_seconds': _wait,
        'notify_before_min': notify,
        'allow_driver_skip': _skip,
      },);
      ref.invalidate(_policyProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ar ? 'تم الحفظ' : 'Saved')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ar ? 'تعذّر الحفظ' : 'Could not save')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ar = widget.ar;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(ar ? 'مدّة انتظار الباص عند نقطة التجمّع' : 'How long the bus waits at a stop',
                style: Theme.of(context).textTheme.titleMedium,),
            const SizedBox(height: 4),
            Text(ar ? 'ينطبق على كل الشركة (يمكن تجاوزه لكل مسار).' : 'Applies company-wide (a route can override it).',
                style: Theme.of(context).textTheme.bodySmall,),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                for (final s in _presets)
                  ChoiceChip(
                    label: Text(ar ? '${s ~/ 60} دقيقة' : '${s ~/ 60} min'),
                    selected: _wait == s,
                    onSelected: (_) => setState(() => _wait = s),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: Slider(
                  min: 0,
                  max: 600,
                  divisions: 20,
                  value: _wait.toDouble().clamp(0, 600),
                  label: '${_wait}s',
                  onChanged: (v) => setState(() => _wait = v.round()),
                ),
              ),
              SizedBox(width: 64, child: Text('${_wait}s', textAlign: TextAlign.end)),
            ],),
            const SizedBox(height: 16),
            TextField(
              controller: _notify,
              decoration: InputDecoration(
                labelText: ar ? 'تذكير قبل الوصول (دقائق، مفصولة بفاصلة)' : 'Pre-arrival reminders (minutes, comma-separated)',
                helperText: ar ? 'مثال: 10, 3' : 'e.g. 10, 3',
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              value: _skip,
              onChanged: (v) => setState(() => _skip = v),
              title: Text(ar ? 'السماح للسائق بزر «المحطة التالية»' : 'Allow the driver\'s "Next stop" button'),
            ),
            const SizedBox(height: 20),
            FilledButton(
              style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
              onPressed: _busy ? null : _save,
              child: _busy
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(ar ? 'حفظ' : 'Save'),
            ),
          ],
        ),
      ),
    );
  }
}
