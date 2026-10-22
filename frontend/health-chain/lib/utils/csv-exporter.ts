// CSVExporter - Generates and downloads CSV files from order data

import { Order } from '../types/orders';

export class CSVExporter {
  /**
   * Format orders to CSV string
   * Converts order data to CSV format with proper headers and formatting
   */
  static formatOrdersToCSV(orders: Order[]): string {
    // CSV headers
    const headers = [
      'Order ID',
      'Blood Type',
      'Quantity',
      'Blood Bank',
      'Status',
      'Rider',
      'Placed At',
      'Delivered At',
    ];

    // Create CSV rows
    const rows = orders.map((order) => {
      return [
        order.id,
        order.bloodType,
        order.quantity.toString(),
        order.bloodBank.name,
        order.status,
        order.rider ? order.rider.name : '',
        this.formatDateToISO(order.placedAt),
        order.deliveredAt ? this.formatDateToISO(order.deliveredAt) : '',
      ];
    });

    // Combine headers and rows
    const csvLines = [headers, ...rows];

    // Convert to CSV string
    return csvLines
      .map((row) =>
        row
          .map((cell) => {
            // Neutralize formula-injection triggers (CWE-1236) before escaping
            const sanitized = /^[=+\-@]/.test(cell) ? `'${cell}` : cell;

            // Escape cells containing commas, quotes, or newlines
            if (
              sanitized.includes(',') ||
              sanitized.includes('"') ||
              sanitized.includes('\n')
            ) {
              return `"${sanitized.replace(/"/g, '""')}"`;
            }
            return sanitized;
          })
          .join(',')
      )
      .join('\n');
  }

  /**
   * Format date to ISO 8601 format
   * Converts Date object to ISO 8601 string (YYYY-MM-DDTHH:mm:ss.sssZ)
   */
  private static formatDateToISO(date: Date): string {
    if (date instanceof Date) {
      return date.toISOString();
    }
    // Handle case where date might be a string already
    return new Date(date).toISOString();
  }

  /**
   * Trigger browser download of CSV file
   * Creates a blob and triggers download with specified filename
   */
  static downloadCSV(content: string, filename: string): void {
    // Create blob with CSV content
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });

    // Create download link
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up
    URL.revokeObjectURL(url);
  }

  /**
   * Export orders to CSV file
   * Main export method that generates CSV and triggers download
   */
  static export(orders: Order[]): void {
    // Generate filename with current date (orders_export_YYYY-MM-DD.csv)
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `orders_export_${dateStr}.csv`;

    // Format orders to CSV
    const csvContent = this.formatOrdersToCSV(orders);

    // Trigger download
    this.downloadCSV(csvContent, filename);
  }
}
