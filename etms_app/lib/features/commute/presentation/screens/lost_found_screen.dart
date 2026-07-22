import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/commute_providers.dart';

/// Report an item left on the bus (docs/etms/17 §14). Linked to the trip (and
/// hence its driver) when a tripId is provided.
class LostFoundScreen extends ConsumerStatefulWidget {
  const LostFoundScreen({super.key, this.tripId});
  final String? tripId;

  @override
  ConsumerState<LostFoundScreen> createState() => _LostFoundScreenState();
}

class _LostFoundScreenState extends ConsumerState<LostFoundScreen> {
  final _desc = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _desc.dispose();
    super.dispose();
  }

  Future<void> _submit(bool ar) async {
    if (_desc.text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      await ref.read(commuteServiceProvider).reportLostItem(_desc.text.trim(), tripId: widget.tripId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ar ? 'تم إرسال البلاغ' : 'Report submitted')),
      );
      Navigator.of(context).maybePop();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ar ? 'تعذّر الإرسال' : 'Could not submit')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'المفقودات' : 'Lost & found')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            ar
                ? 'نسيت شيئًا داخل الباص؟ صِف المفقود وسيصل البلاغ للسائق والإدارة.'
                : 'Left something on the bus? Describe it and the report reaches the driver and ops.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _desc,
            minLines: 3,
            maxLines: 5,
            decoration: InputDecoration(
              labelText: ar ? 'وصف المفقود' : 'Item description',
              hintText: ar ? 'مثال: محفظة بنية' : 'e.g. a brown wallet',
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
            onPressed: _busy ? null : () => _submit(ar),
            icon: const Icon(Icons.report_gmailerrorred_outlined),
            label: Text(ar ? 'إرسال البلاغ' : 'Submit report'),
          ),
        ],
      ),
    );
  }
}
