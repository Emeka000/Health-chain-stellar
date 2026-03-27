import { Workbook } from 'exceljs';
import PDFDocument from 'pdfkit';
import { OrgStats } from './org-stats.service';

export async function exportToExcel(stats: OrgStats): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet('Dashboard');

  ws.columns = [
    { header: 'Metric', key: 'metric', width: 35 },
    { header: 'Value', key: 'value', width: 20 },
  ];

  const rows: [string, string | number][] = [
    ['Organization ID', stats.organizationId],
    ['Organization Type', stats.organizationType ?? 'N/A'],
    ['Delivery Success Rate (%)', stats.delivery_success_rate],
    ['Avg Response Time (s)', stats.avg_response_time],
    ['MoM Delivery Success Change (%)', stats.mom_delivery_success_rate_change],
    ['MoM Avg Response Time Change (%)', stats.mom_avg_response_time_change],
  ];

  if (stats.total_blood_units !== undefined) {
    rows.push(['Total Blood Units', stats.total_blood_units]);
    rows.push(['Inventory Turnover', stats.inventory_turnover ?? 0]);
  }
  if (stats.total_requests !== undefined) {
    rows.push(['Total Requests', stats.total_requests]);
    rows.push(['Request Fulfillment Rate (%)', stats.request_fulfillment_rate ?? 0]);
  }

  rows.forEach(([metric, value]) => ws.addRow({ metric, value }));

  const trendsWs = wb.addWorksheet('Monthly Trends');
  trendsWs.columns = [
    { header: 'Month (offset)', key: 'month', width: 20 },
    { header: 'Count', key: 'count', width: 15 },
  ];
  stats.monthly_trends.forEach((count, i) =>
    trendsWs.addRow({ month: `Month -${11 - i}`, count }),
  );

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function exportToPdf(stats: OrgStats): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('Organization Dashboard Summary', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Organization ID: ${stats.organizationId}`);
    doc.text(`Type: ${stats.organizationType ?? 'N/A'}`);
    doc.moveDown();

    doc.fontSize(14).text('Performance Metrics');
    doc.fontSize(11);
    doc.text(`Delivery Success Rate: ${stats.delivery_success_rate}%`);
    doc.text(`Avg Response Time: ${stats.avg_response_time}s`);
    doc.text(`MoM Delivery Change: ${stats.mom_delivery_success_rate_change}%`);
    doc.text(`MoM Response Time Change: ${stats.mom_avg_response_time_change}%`);

    if (stats.total_blood_units !== undefined) {
      doc.moveDown();
      doc.fontSize(14).text('Blood Bank Metrics');
      doc.fontSize(11);
      doc.text(`Total Blood Units: ${stats.total_blood_units}`);
      doc.text(`Inventory Turnover: ${stats.inventory_turnover}`);
    }

    if (stats.total_requests !== undefined) {
      doc.moveDown();
      doc.fontSize(14).text('Hospital Metrics');
      doc.fontSize(11);
      doc.text(`Total Requests: ${stats.total_requests}`);
      doc.text(`Fulfillment Rate: ${stats.request_fulfillment_rate}%`);
    }

    doc.moveDown();
    doc.fontSize(14).text('Monthly Trends (last 12 months)');
    doc.fontSize(11).text(stats.monthly_trends.join(', '));

    doc.end();
  });
}
