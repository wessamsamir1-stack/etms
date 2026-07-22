import 'bootstrap.dart';
import 'core/config/app_config.dart';
import 'core/config/flavor.dart';

Future<void> main() => bootstrap(AppConfig.resolve(Flavor.production));
