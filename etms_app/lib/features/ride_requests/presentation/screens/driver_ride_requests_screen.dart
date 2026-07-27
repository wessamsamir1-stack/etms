import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/ride_request_models.dart';
import '../providers/ride_request_providers.dart';

/// The driver's list of open ride requests (GET /v1/ride-requests?mine=driver).
/// Each row says whether the pickup is on the driver's own route for that day —
/// the zone match from db V0032 — and the filter narrows the list to those.
class DriverRideRequestsScreen extends ConsumerWidget {
  const DriverRideRequestsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ar = Localizations.localeOf(context).languageCode == 'ar';
    final onlyMyRoute = ref.watch(matchMyRouteProvider);
    final async = ref.watch(driverRideRequestsProvider);

    Future<void> claim(RideRequest r) async {
      final messenger = ScaffoldMessenger.of(context);
      try {
        final res = await ref.read(rideRequestServiceProvider).claim(r.id);
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              res.waitlisted
                  ? (ar
                      ? 'الباص ممتلئ — ${r.employeeName} في قائمة الانتظار برقم ${res.position}'
                      : 'Bus full — ${r.employeeName} is number ${res.position} on the waiting list')
                  : (ar
                      ? 'تم — ${r.employeeName} في قائمة ركّاب رحلتك'
                      : 'Done — ${r.employeeName} is on your manifest'),
            ),
          ),
        );
      } catch (_) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              ar ? 'تعذّر استلام الطلب (قد يكون حد سبقك)' : 'Could not claim it (someone may have beaten you to it)',
            ),
          ),
        );
      } finally {
        ref.invalidate(driverRideRequestsProvider);
      }
    }

    return Scaffold(
      appBar: AppBar(title: Text(ar ? 'طلبات التوصيل' : 'Ride requests')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                FilterChip(
                  selected: onlyMyRoute,
                  label: Text(ar ? 'على مساري بس' : 'On my route only'),
                  onSelected: (v) => ref.read(matchMyRouteProvider.notifier).state = v,
                ),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async => ref.invalidate(driverRideRequestsProvider),
              child: async.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (e, _) => _Retry(
                  ar: ar,
                  onRetry: () => ref.invalidate(driverRideRequestsProvider),
                ),
                data: (list) => list.isEmpty
                    ? ListView(
                        children: [
                          const SizedBox(height: 80),
                          Center(
                            child: Text(
                              onlyMyRoute
                                  ? (ar ? 'لا طلبات على مسارك دلوقتي' : 'No requests on your route right now')
                                  : (ar ? 'لا طلبات مفتوحة' : 'No open requests'),
                            ),
                          ),
                        ],
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: list.length,
                        itemBuilder: (_, i) => _RequestCard(
                          request: list[i],
                          ar: ar,
                          onClaim: () => claim(list[i]),
                        ),
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RequestCard extends StatelessWidget {
  const _RequestCard({required this.request, required this.ar, required this.onClaim});
  final RideRequest request;
  final bool ar;
  final VoidCallback onClaim;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final where = [
      if (request.pickupLabel != null && request.pickupLabel!.isNotEmpty) request.pickupLabel!,
      if (request.pickupAddress != null && request.pickupAddress!.isNotEmpty) request.pickupAddress!,
    ].join(' · ');
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    request.employeeName,
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                _MatchBadge(match: request.match, ar: ar),
              ],
            ),
            if (where.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(where, style: theme.textTheme.bodySmall),
              ),
            const SizedBox(height: 4),
            Text(
              [
                request.direction == 'inbound'
                    ? (ar ? 'ذهاب للعمل' : 'To work')
                    : (ar ? 'عودة' : 'Home'),
                if (request.requestedTime != null) request.requestedTime!,
                if (!request.hasPin) (ar ? 'بدون تحديد على الخريطة' : 'no map pin'),
              ].join(' · '),
              style: theme.textTheme.labelSmall,
            ),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: FilledButton(
                onPressed: onClaim,
                child: Text(ar ? 'استلام' : 'Claim'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// On-route / off-route / unknown. Unknown is its own state on purpose: without
/// an approved plan for the day there is nothing to match against, and showing
/// that as "off route" would be a lie.
class _MatchBadge extends StatelessWidget {
  const _MatchBadge({required this.match, required this.ar});
  final RouteMatch match;
  final bool ar;

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (match) {
      RouteMatch.onRoute => (const Color(0xFF1E9E58), ar ? 'على مسارك' : 'On your route'),
      RouteMatch.offRoute => (const Color(0xFFC9871A), ar ? 'خارج مسارك' : 'Off your route'),
      RouteMatch.unknown => (const Color(0xFF8494AC), ar ? 'مفيش خطة معتمدة' : 'No approved plan'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: color, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _Retry extends StatelessWidget {
  const _Retry({required this.ar, required this.onRetry});
  final bool ar;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(ar ? 'تعذّر تحميل الطلبات' : 'Could not load the requests'),
          const SizedBox(height: 8),
          FilledButton(onPressed: onRetry, child: Text(ar ? 'إعادة المحاولة' : 'Retry')),
        ],
      ),
    );
  }
}
