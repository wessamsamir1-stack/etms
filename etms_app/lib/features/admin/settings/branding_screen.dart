import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';

/// Admin: white-label branding (docs/etms/17 §10) — app name, logo, colours,
/// splash. GET/PUT /v1/branding.
final _brandingProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final res = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/branding');
  return (res['data'] as Map<String, dynamic>?) ?? const {};
});

class BrandingScreen extends ConsumerWidget {
  const BrandingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final async = ref.watch(_brandingProvider);
    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'الهوية (White-label)' : 'Branding (White-label)')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(ar ? 'تعذّر التحميل' : 'Could not load')),
        data: (b) => _Form(initial: b, ar: ar),
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
  late TextEditingController _name, _logo, _primary, _secondary, _splash;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final b = widget.initial;
    final theme = (b['theme_json'] as Map?) ?? const {};
    _name = TextEditingController(text: '${b['app_name'] ?? ''}');
    _logo = TextEditingController(text: '${b['logo_url'] ?? ''}');
    _primary = TextEditingController(text: '${b['primary_color'] ?? ''}');
    _secondary = TextEditingController(text: '${b['secondary_color'] ?? ''}');
    _splash = TextEditingController(text: '${theme['splash_url'] ?? ''}');
  }

  @override
  void dispose() {
    for (final c in [_name, _logo, _primary, _secondary, _splash]) {
      c.dispose();
    }
    super.dispose();
  }

  Color? _parseHex(String s) {
    final m = RegExp(r'^#?([0-9A-Fa-f]{6})$').firstMatch(s.trim());
    if (m == null) return null;
    return Color(int.parse('FF${m.group(1)}', radix: 16));
  }

  Future<void> _save() async {
    final ar = widget.ar;
    final primary = _primary.text.trim();
    final secondary = _secondary.text.trim();
    if (primary.isNotEmpty && _parseHex(primary) == null) {
      _snack(ar ? 'اللون الأساسي غير صحيح (مثال #1E5AA8)' : 'Invalid primary colour (e.g. #1E5AA8)');
      return;
    }
    setState(() => _busy = true);
    try {
      String norm(String s) => s.isEmpty ? s : (s.startsWith('#') ? s : '#$s');
      await ref.read(apiClientProvider).put<Map<String, dynamic>>('/branding', body: {
        if (_name.text.trim().isNotEmpty) 'app_name': _name.text.trim(),
        if (_logo.text.trim().isNotEmpty) 'logo_url': _logo.text.trim(),
        if (primary.isNotEmpty) 'primary_color': norm(primary),
        if (secondary.isNotEmpty) 'secondary_color': norm(secondary),
        if (_splash.text.trim().isNotEmpty) 'splash_url': _splash.text.trim(),
      });
      ref.invalidate(_brandingProvider);
      _snack(ar ? 'تم الحفظ' : 'Saved');
    } catch (_) {
      _snack(ar ? 'تعذّر الحفظ' : 'Could not save');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String m) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  @override
  Widget build(BuildContext context) {
    final ar = widget.ar;
    final p = _parseHex(_primary.text) ?? Theme.of(context).colorScheme.primary;
    final s = _parseHex(_secondary.text) ?? Theme.of(context).colorScheme.secondary;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(ar ? 'اجعل التطبيق يبدو مملوكًا لشركتك.' : 'Make the app look owned by your company.',
                style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 16),
            _field(_name, ar ? 'اسم التطبيق' : 'App name'),
            _field(_logo, ar ? 'رابط الشعار (Logo URL)' : 'Logo URL'),
            Row(children: [
              Expanded(child: _field(_primary, ar ? 'اللون الأساسي' : 'Primary colour', hint: '#1E5AA8', onChange: () => setState(() {}))),
              const SizedBox(width: 10),
              _swatch(p),
            ]),
            Row(children: [
              Expanded(child: _field(_secondary, ar ? 'اللون الثانوي' : 'Secondary colour', hint: '#0E9E8E', onChange: () => setState(() {}))),
              const SizedBox(width: 10),
              _swatch(s),
            ]),
            _field(_splash, ar ? 'رابط شاشة البداية (Splash)' : 'Splash image URL'),
            const SizedBox(height: 20),
            FilledButton(
              style: FilledButton.styleFrom(
                  backgroundColor: p, padding: const EdgeInsets.symmetric(vertical: 16)),
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

  Widget _field(TextEditingController c, String label, {String? hint, VoidCallback? onChange}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: c,
        onChanged: onChange == null ? null : (_) => onChange(),
        decoration: InputDecoration(labelText: label, hintText: hint, border: const OutlineInputBorder()),
      ),
    );
  }

  Widget _swatch(Color c) => Container(
        width: 44,
        height: 44,
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: c,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Colors.black12),
        ),
      );
}
