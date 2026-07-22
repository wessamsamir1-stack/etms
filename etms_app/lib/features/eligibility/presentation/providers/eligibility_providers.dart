import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/providers.dart';
import '../../data/datasources/eligibility_remote_data_source.dart';
import '../../data/repositories/eligibility_repository_impl.dart';
import '../../domain/entities/eligibility_decision.dart';
import '../../domain/repositories/eligibility_repository.dart';

final _eligibilityRemoteProvider = Provider<EligibilityRemoteDataSource>(
  (ref) => EligibilityRemoteDataSourceImpl(ref.watch(apiClientProvider)),
);

final eligibilityRepositoryProvider = Provider<EligibilityRepository>(
  (ref) => EligibilityRepositoryImpl(ref.watch(_eligibilityRemoteProvider)),
);

/// The human-review queue (pending decisions). Refresh by invalidating.
final reviewQueueProvider = FutureProvider.autoDispose<List<EligibilityDecision>>(
  (ref) async {
    final res = await ref.watch(eligibilityRepositoryProvider).reviewQueue();
    return res.fold((f) => throw f, (list) => list);
  },
);

/// Handles override actions; invalidates the queue on success.
class ApprovalsController extends AutoDisposeAsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<bool> overrideDecision(String decisionId, String outcome) async {
    state = const AsyncLoading();
    final res =
        await ref.read(eligibilityRepositoryProvider).overrideDecision(decisionId, outcome);
    return res.match(
      (f) {
        state = AsyncError(f.message, StackTrace.current);
        return false;
      },
      (_) {
        state = const AsyncData(null);
        ref.invalidate(reviewQueueProvider);
        return true;
      },
    );
  }
}

final approvalsControllerProvider =
    AutoDisposeAsyncNotifierProvider<ApprovalsController, void>(ApprovalsController.new);
