import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/commute_providers.dart';

/// Rate a completed trip (docs/etms/17 §13): driver, cleanliness, A-C, punctuality.
class RatingScreen extends ConsumerStatefulWidget {
  const RatingScreen({super.key, required this.tripId});
  final String tripId;

  @override
  ConsumerState<RatingScreen> createState() => _RatingScreenState();
}

class _RatingScreenState extends ConsumerState<RatingScreen> {
  int _driver = 0, _clean = 0, _ac = 0, _punct = 0;
  final _comment = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _submit(bool ar) async {
    setState(() => _busy = true);
    try {
      await ref.read(commuteServiceProvider).rateTrip(
            widget.tripId,
            driver: _driver == 0 ? null : _driver,
            cleanliness: _clean == 0 ? null : _clean,
            ac: _ac == 0 ? null : _ac,
            punctuality: _punct == 0 ? null : _punct,
            comment: _comment.text,
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ar ? 'شكرًا لتقييمك' : 'Thanks for your rating')),
      );
      unawaited(Navigator.of(context).maybePop());
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
      appBar: AppBar(title: Text(ar ? 'تقييم الرحلة' : 'Rate the trip')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _Stars(label: ar ? 'السائق' : 'Driver', value: _driver, onChanged: (v) => setState(() => _driver = v)),
          _Stars(label: ar ? 'نظافة الباص' : 'Cleanliness', value: _clean, onChanged: (v) => setState(() => _clean = v)),
          _Stars(label: ar ? 'التكييف' : 'Air-conditioning', value: _ac, onChanged: (v) => setState(() => _ac = v)),
          _Stars(label: ar ? 'الالتزام بالمواعيد' : 'Punctuality', value: _punct, onChanged: (v) => setState(() => _punct = v)),
          const SizedBox(height: 12),
          TextField(
            controller: _comment,
            minLines: 2,
            maxLines: 4,
            decoration: InputDecoration(
              labelText: ar ? 'ملاحظات (اختياري)' : 'Comment (optional)',
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton(
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
            onPressed: _busy ? null : () => _submit(ar),
            child: _busy
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : Text(ar ? 'إرسال التقييم' : 'Submit rating'),
          ),
        ],
      ),
    );
  }
}

class _Stars extends StatelessWidget {
  const _Stars({required this.label, required this.value, required this.onChanged});
  final String label;
  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(child: Text(label, style: Theme.of(context).textTheme.titleSmall)),
          for (var i = 1; i <= 5; i++)
            IconButton(
              visualDensity: VisualDensity.compact,
              onPressed: () => onChanged(i),
              icon: Icon(
                i <= value ? Icons.star : Icons.star_border,
                color: const Color(0xFFC9871A),
              ),
            ),
        ],
      ),
    );
  }
}
