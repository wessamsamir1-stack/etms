import '../../domain/entities/user.dart';

/// Data Transfer Object for `app_user`. Hand-written (de)serialization keeps the
/// skeleton codegen-free; swap for json_serializable later without changing the
/// mapping surface ([fromJson]/[toEntity]).
class UserDto {
  const UserDto({
    required this.id,
    required this.tenantId,
    required this.fullName,
    this.email,
    this.roles = const [],
  });

  final String id;
  final String tenantId;
  final String fullName;
  final String? email;
  final List<String> roles;

  factory UserDto.fromJson(Map<String, dynamic> json) => UserDto(
        id: json['id'] as String,
        tenantId: (json['tenant_id'] ?? json['tenantId']) as String,
        fullName: (json['full_name'] ?? json['fullName'] ?? '') as String,
        email: json['email'] as String?,
        roles: (json['roles'] as List?)?.map((e) => '$e').toList() ?? const [],
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'tenant_id': tenantId,
        'full_name': fullName,
        'email': email,
        'roles': roles,
      };

  User toEntity() => User(
        id: id,
        tenantId: tenantId,
        fullName: fullName,
        email: email,
        roles: roles,
      );
}
