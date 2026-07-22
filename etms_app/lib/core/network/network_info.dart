import 'package:connectivity_plus/connectivity_plus.dart';

/// Abstraction over connectivity so features and the sync engine can react to
/// online/offline transitions without depending on a plugin directly.
abstract interface class NetworkInfo {
  Future<bool> get isConnected;
  Stream<bool> get onStatusChange;
}

class NetworkInfoImpl implements NetworkInfo {
  NetworkInfoImpl(this._connectivity);
  final Connectivity _connectivity;

  bool _online(List<ConnectivityResult> r) =>
      r.isNotEmpty && !r.every((e) => e == ConnectivityResult.none);

  @override
  Future<bool> get isConnected async =>
      _online(await _connectivity.checkConnectivity());

  @override
  Stream<bool> get onStatusChange =>
      _connectivity.onConnectivityChanged.map(_online).distinct();
}
