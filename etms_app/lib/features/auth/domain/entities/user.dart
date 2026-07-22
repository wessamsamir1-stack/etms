import 'package:equatable/equatable.dart';

/// Domain entity: the authenticated principal. Framework-free and immutable.
class User extends Equatable {
  const User({
    required this.id,
    required this.tenantId,
    required this.fullName,
    this.email,
    this.roles = const [],
    this.permissions = const [],
  });

  final String id;
  final String tenantId;
  final String fullName;
  final String? email;
  final List<String> roles;

  /// Effective permissions from the backend JWT (drives RBAC gating).
  final List<String> permissions;

  bool hasRole(String role) => roles.contains(role);
  bool has(String permission) => permissions.contains(permission);
  bool get isDriver => hasRole('driver');
  bool get isRider => hasRole('rider');

  @override
  List<Object?> get props => [id, tenantId, email, roles, permissions];
}
