import 'package:shared_preferences/shared_preferences.dart';

/// Non-sensitive local preferences (locale, theme mode, feature toggles).
abstract interface class KeyValueStore {
  String? getString(String key);
  Future<void> setString(String key, String value);
  Future<void> remove(String key);
}

class KeyValueStoreImpl implements KeyValueStore {
  KeyValueStoreImpl(this._prefs);
  final SharedPreferences _prefs;

  @override
  String? getString(String key) => _prefs.getString(key);

  @override
  Future<void> setString(String key, String value) =>
      _prefs.setString(key, value);

  @override
  Future<void> remove(String key) => _prefs.remove(key);
}
