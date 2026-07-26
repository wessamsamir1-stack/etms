import 'package:flutter/material.dart';

import 'resource_config.dart';

typedef RowAction = void Function(Map<String, dynamic> row);

/// Responsive data grid: a DataTable on wide screens, stacked cards on compact.
/// Column definitions come from the resource's [ColumnSpec]s.
class DataTableView extends StatelessWidget {
  const DataTableView({
    super.key,
    required this.columns,
    required this.rows,
    this.onEdit,
    this.onDelete,
    this.canWrite = true,
  });

  final List<ColumnSpec> columns;
  final List<Map<String, dynamic>> rows;
  final RowAction? onEdit;
  final RowAction? onDelete;
  final bool canWrite;

  @override
  Widget build(BuildContext context) {
    final compact = MediaQuery.sizeOf(context).width < 720;
    return compact ? _cards(context) : _table(context);
  }

  Widget _actions(Map<String, dynamic> row) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (onEdit != null)
            IconButton(
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: canWrite ? () => onEdit!(row) : null,
              tooltip: 'Edit',
            ),
          if (onDelete != null)
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 20),
              onPressed: canWrite ? () => onDelete!(row) : null,
              tooltip: 'Delete',
            ),
        ],
      );

  Widget _table(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: ConstrainedBox(
        constraints:
            BoxConstraints(minWidth: MediaQuery.sizeOf(context).width - 280),
        child: DataTable(
          columns: [
            for (final c in columns) DataColumn(label: Text(c.label)),
            if (onEdit != null || onDelete != null)
              const DataColumn(label: Text('')),
          ],
          rows: [
            for (final row in rows)
              DataRow(cells: [
                for (final c in columns) DataCell(Text(c.value(row))),
                if (onEdit != null || onDelete != null)
                  DataCell(_actions(row)),
              ],),
          ],
        ),
      ),
    );
  }

  Widget _cards(BuildContext context) {
    return ListView.builder(
      itemCount: rows.length,
      itemBuilder: (_, i) {
        final row = rows[i];
        return Card(
          child: ListTile(
            title: Text(columns.first.value(row)),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final c in columns.skip(1))
                  Text('${c.label}: ${c.value(row)}'),
              ],
            ),
            trailing: _actions(row),
            isThreeLine: columns.length > 2,
          ),
        );
      },
    );
  }
}
