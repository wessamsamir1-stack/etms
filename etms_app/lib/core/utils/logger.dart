import 'package:logger/logger.dart';

/// Shared app logger. In production, wire an output that ships to your
/// observability backend (and always scrub PII before logging).
final appLogger = Logger(
  printer: PrettyPrinter(methodCount: 0, errorMethodCount: 5, lineLength: 80),
);
