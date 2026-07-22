/// Build flavors. Each `main_<flavor>.dart` entrypoint sets the active flavor
/// before bootstrapping, so configuration is resolved at startup with no I/O.
enum Flavor { development, staging, production }

extension FlavorX on Flavor {
  String get name => switch (this) {
        Flavor.development => 'development',
        Flavor.staging => 'staging',
        Flavor.production => 'production',
      };

  bool get isProduction => this == Flavor.production;
}
