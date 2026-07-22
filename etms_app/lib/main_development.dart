import 'bootstrap.dart';
import 'core/config/app_config.dart';
import 'core/config/flavor.dart';

/// Development entrypoint:
/// flutter run --dart-define=API_BASE_URL=... --dart-define=SUPABASE_URL=... \
///   --dart-define=SUPABASE_ANON_KEY=... -t lib/main_development.dart
Future<void> main() => bootstrap(AppConfig.resolve(Flavor.development));
