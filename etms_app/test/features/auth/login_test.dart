import 'package:etms_app/core/error/failures.dart';
import 'package:etms_app/features/auth/domain/entities/user.dart';
import 'package:etms_app/features/auth/domain/repositories/auth_repository.dart';
import 'package:etms_app/features/auth/domain/usecases/login.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fpdart/fpdart.dart';
import 'package:mocktail/mocktail.dart';

class _MockAuthRepository extends Mock implements AuthRepository {}

void main() {
  late _MockAuthRepository repo;
  late Login usecase;

  setUp(() {
    repo = _MockAuthRepository();
    usecase = Login(repo);
  });

  const user = User(id: 'u1', tenantId: 't1', fullName: 'Sara', roles: ['rider']);

  test('returns User on valid credentials', () async {
    when(() => repo.login(email: any(named: 'email'), password: any(named: 'password')))
        .thenAnswer((_) async => const Right(user));

    final result = await usecase(
      const LoginParams(email: 'sara@acme.com', password: 'secret'),
    );

    expect(result, const Right<Failure, User>(user));
    verify(() => repo.login(email: 'sara@acme.com', password: 'secret')).called(1);
  });

  test('short-circuits with ValidationFailure on empty input', () async {
    final result = await usecase(const LoginParams(email: '', password: ''));

    expect(result.isLeft(), isTrue);
    result.match(
      (f) => expect(f, isA<ValidationFailure>()),
      (_) => fail('expected a failure'),
    );
    verifyNever(() => repo.login(
        email: any(named: 'email'), password: any(named: 'password'),),);
  });
}
