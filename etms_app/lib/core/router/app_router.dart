import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/home_shell.dart';
import '../../features/admin/shell/admin_shell.dart';
import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/commute/presentation/screens/driver_trip_screen.dart';
import '../../features/commute/presentation/screens/employee_trip_screen.dart';
import '../../features/commute/presentation/screens/lost_found_screen.dart';
import '../../features/commute/presentation/screens/my_rides_screen.dart';
import '../../features/commute/presentation/screens/rating_screen.dart';
import '../../features/fleet_ops/presentation/screens/add_fuel_log_screen.dart';
import '../../features/fleet_ops/presentation/screens/add_violation_screen.dart';
import '../../features/fleet_ops/presentation/screens/fleet_reports_screen.dart';
import '../../features/fleet_ops/presentation/screens/fuel_logs_screen.dart';
import '../../features/fleet_ops/presentation/screens/ops_reports_screen.dart';
import '../../features/fleet_ops/presentation/screens/violations_screen.dart';
import '../../features/ride_requests/presentation/screens/driver_ride_requests_screen.dart';
import '../access/permissions.dart';
import 'app_routes.dart';

/// App router with an auth redirect guard. The router refreshes whenever auth
/// state changes, so sign-in/out navigates automatically.
final goRouterProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(authStateChangesProvider, (_, __) => refresh.value++);
  // Re-evaluate guards once permissions resolve (admin route gate).
  ref.listen(permissionsProvider, (_, __) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: AppRoutes.home,
    refreshListenable: refresh,
    redirect: (context, state) {
      final loggedIn = ref.read(currentUserProvider) != null;
      final loggingIn = state.matchedLocation == AppRoutes.login;
      if (!loggedIn) return loggingIn ? null : AppRoutes.login;
      if (loggingIn) return AppRoutes.home;
      // Guard the admin portal: only users with an admin permission may enter.
      if (state.matchedLocation.startsWith(AppRoutes.admin) &&
          !ref.read(isAdminUserProvider)) {
        return AppRoutes.home;
      }
      return null;
    },
    routes: [
      GoRoute(
        path: AppRoutes.login,
        name: 'login',
        builder: (_, __) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.home,
        name: 'home',
        builder: (_, __) => const HomeShell(),
      ),
      GoRoute(
        path: AppRoutes.admin,
        name: 'admin',
        builder: (_, __) => const AdminShell(),
      ),
      GoRoute(
        path: '${AppRoutes.driverTrip}/:tripId',
        name: 'driverTrip',
        builder: (_, state) => DriverTripScreen(tripId: state.pathParameters['tripId']!),
      ),
      GoRoute(
        path: '${AppRoutes.myTrip}/:tripId',
        name: 'myTrip',
        builder: (_, state) => EmployeeTripScreen(tripId: state.pathParameters['tripId']!),
      ),
      GoRoute(
        path: AppRoutes.myRides,
        name: 'myRides',
        builder: (_, __) => const MyRidesScreen(),
      ),
      GoRoute(
        path: '${AppRoutes.rateTrip}/:tripId/rate',
        name: 'rateTrip',
        builder: (_, state) => RatingScreen(tripId: state.pathParameters['tripId']!),
      ),
      GoRoute(
        path: AppRoutes.fuelLogs,
        name: 'fuelLogs',
        builder: (_, __) => const FuelLogsScreen(),
      ),
      GoRoute(
        path: AppRoutes.fuelAdd,
        name: 'fuelAdd',
        builder: (_, __) => const AddFuelLogScreen(),
      ),
      GoRoute(
        path: AppRoutes.violations,
        name: 'violations',
        builder: (_, __) => const ViolationsScreen(),
      ),
      GoRoute(
        path: AppRoutes.violationAdd,
        name: 'violationAdd',
        builder: (_, __) => const AddViolationScreen(),
      ),
      GoRoute(
        path: AppRoutes.fleetReports,
        name: 'fleetReports',
        builder: (_, __) => const FleetReportsScreen(),
      ),
      GoRoute(
        path: AppRoutes.opsReports,
        name: 'opsReports',
        builder: (_, __) => const OpsReportsScreen(),
      ),
      GoRoute(
        path: AppRoutes.rideRequests,
        name: 'rideRequests',
        builder: (_, __) => const DriverRideRequestsScreen(),
      ),
      GoRoute(
        path: AppRoutes.lostFound,
        name: 'lostFound',
        builder: (_, state) => LostFoundScreen(tripId: state.uri.queryParameters['tripId']),
      ),
    ],
  );
});
