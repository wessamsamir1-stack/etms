import 'package:equatable/equatable.dart';

/// Aggregate sync state surfaced in the UI (see shared/widgets/sync_status_chip).
class SyncState extends Equatable {
  const SyncState({
    this.pending = 0,
    this.failed = 0,
    this.syncing = false,
    this.online = true,
  });

  final int pending;
  final int failed;
  final bool syncing;
  final bool online;

  bool get isClean => pending == 0 && failed == 0;

  SyncState copyWith({int? pending, int? failed, bool? syncing, bool? online}) =>
      SyncState(
        pending: pending ?? this.pending,
        failed: failed ?? this.failed,
        syncing: syncing ?? this.syncing,
        online: online ?? this.online,
      );

  @override
  List<Object?> get props => [pending, failed, syncing, online];
}

/// Lifecycle of a single queued mutation.
enum OutboxStatus { pending, syncing, failed, done }
