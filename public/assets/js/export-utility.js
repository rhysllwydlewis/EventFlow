/**
 * EventFlow Export Utilities
 * Export data to PDF, CSV, and generate QR codes
 */

class ExportUtility {
  constructor() {
    this.pdfLibLoaded = false;
    this.qrCodeLibLoaded = false;
  }

  // Load jsPDF library dynamically
  loadPDFLib() {
    if (this.pdfLibLoaded || typeof jsPDF !== 'undefined') {
      this.pdfLibLoaded = true;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      script.addEventListener('load', () => {
        this.pdfLibLoaded = true;
        resolve();
      });
      script.addEventListener('error', reject);
      document.head.appendChild(script);
    });
  }

  // Load QRCode library dynamically
  loadQRCodeLib() {
    if (this.qrCodeLibLoaded || typeof QRCode !== 'undefined') {
      this.qrCodeLibLoaded = true;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      script.addEventListener('load', () => {
        this.qrCodeLibLoaded = true;
        resolve();
      });
      script.addEventListener('error', reject);
      document.head.appendChild(script);
    });
  }

  // Export data to CSV
  exportToCSV(data, filename = 'export.csv') {
    if (!data || data.length === 0) {
      throw new Error('No data to export');
    }

    // Get headers from first object
    const headers = Object.keys(data[0]);

    // Create CSV content
    let csv = `${headers.join(',')}\n`;

    data.forEach(row => {
      const values = headers.map(header => {
        let value = row[header] || '';

        // Escape quotes and wrap in quotes if contains comma
        if (typeof value === 'string') {
          value = value.replace(/"/g, '""');
          if (value.includes(',') || value.includes('\n') || value.includes('"')) {
            value = `"${value}"`;
          }
        }

        return value;
      });

      csv += `${values.join(',')}\n`;
    });

    // Create download link
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  // Export budget data to PDF
  async exportBudgetToPDF(budgetData, filename = 'budget.pdf') {
    await this.loadPDFLib();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Title
    doc.setFontSize(20);
    doc.text('Event Budget Report', 20, 20);

    // Date
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 30);

    // Budget Summary
    doc.setFontSize(14);
    doc.text('Budget Summary', 20, 45);

    doc.setFontSize(10);
    let y = 55;

    doc.text(`Total Budget: £${budgetData.totalBudget.toLocaleString()}`, 20, y);
    y += 8;
    doc.text(`Total Spent: £${budgetData.totalSpent.toLocaleString()}`, 20, y);
    y += 8;
    doc.text(`Remaining: £${budgetData.remaining.toLocaleString()}`, 20, y);
    y += 8;
    doc.text(`Percentage Used: ${budgetData.percentageUsed}%`, 20, y);

    // Expenses Table
    if (budgetData.expenses && budgetData.expenses.length > 0) {
      y += 15;
      doc.setFontSize(14);
      doc.text('Expenses', 20, y);

      y += 10;
      doc.setFontSize(9);

      // Table headers
      doc.text('Category', 20, y);
      doc.text('Description', 60, y);
      doc.text('Amount', 130, y);
      doc.text('Status', 160, y);

      y += 7;
      doc.line(20, y, 190, y);
      y += 5;

      // Table rows
      budgetData.expenses.forEach(expense => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }

        doc.text(expense.category || '', 20, y);
        doc.text(this.truncate(expense.description || '', 30), 60, y);
        doc.text(`£${expense.amount.toLocaleString()}`, 130, y);
        doc.text(expense.status || 'Pending', 160, y);

        y += 7;
      });
    }

    // Category Breakdown
    if (budgetData.categoryBreakdown && budgetData.categoryBreakdown.length > 0) {
      y += 15;
      if (y > 250) {
        doc.addPage();
        y = 20;
      }

      doc.setFontSize(14);
      doc.text('Category Breakdown', 20, y);

      y += 10;
      doc.setFontSize(9);

      budgetData.categoryBreakdown.forEach(item => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }

        doc.text(`${item.category}: £${item.amount.toLocaleString()} (${item.percentage}%)`, 20, y);
        y += 7;
      });
    }

    // Save PDF
    doc.save(filename);
  }

  // Export timeline to PDF
  async exportTimelineToPDF(events, filename = 'timeline.pdf') {
    await this.loadPDFLib();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Title
    doc.setFontSize(20);
    doc.text('Event Timeline', 20, 20);

    // Date
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 30);

    // Events
    let y = 45;
    doc.setFontSize(12);
    doc.text('Schedule', 20, y);

    y += 10;
    doc.setFontSize(9);

    // Sort events by time
    const sortedEvents = [...events].sort((a, b) => {
      const timeA = new Date(a.time || a.date).getTime();
      const timeB = new Date(b.time || b.date).getTime();
      return timeA - timeB;
    });

    sortedEvents.forEach(event => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }

      // Time
      const time = new Date(event.time).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
      doc.setFont(undefined, 'bold');
      doc.text(time, 20, y);

      // Title
      doc.setFont(undefined, 'normal');
      doc.text(event.title, 50, y);

      y += 7;

      // Details
      if (event.description) {
        doc.setFontSize(8);
        const lines = doc.splitTextToSize(event.description, 170);
        doc.text(lines, 50, y);
        y += lines.length * 5;
      }

      if (event.supplier) {
        doc.setFontSize(8);
        doc.text(`Supplier: ${event.supplier}`, 50, y);
        y += 5;
      }

      if (event.duration) {
        doc.setFontSize(8);
        doc.text(`Duration: ${event.duration}`, 50, y);
        y += 5;
      }

      y += 5;
      doc.setFontSize(9);
    });

    // Save PDF
    doc.save(filename);
  }

  // Generate QR code for a URL
  async generateQRCode(url, containerId) {
    await this.loadQRCodeLib();

    const container =
      typeof containerId === 'string' ? document.getElementById(containerId) : containerId;

    if (!container) {
      throw new Error('Container not found');
    }

    // Clear existing QR code
    container.innerHTML = '';

    // Generate QR code
    new QRCode(container, {
      text: url,
      width: 256,
      height: 256,
      colorDark: '#0B8073',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H,
    });
  }

  // Helper: truncate text
  truncate(text, maxLength) {
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.substring(0, maxLength - 3)}...`;
  }

  // Export guest list to CSV
  exportGuestListToCSV(guests, filename = 'guest-list.csv') {
    const guestData = guests.map(guest => ({
      Name: guest.name,
      Email: guest.email,
      Phone: guest.phone || '',
      'Plus One': guest.plusOne ? 'Yes' : 'No',
      RSVP: guest.rsvp || 'Pending',
      'Dietary Requirements': guest.dietary || '',
      Table: guest.table || '',
      Notes: guest.notes || '',
    }));

    this.exportToCSV(guestData, filename);
  }

  // Export supplier comparison to PDF
  async exportComparisonToPDF(suppliers, filename = 'supplier-comparison.pdf') {
    await this.loadPDFLib();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Title
    doc.setFontSize(20);
    doc.text('Supplier Comparison', 20, 20);

    // Date
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 30);

    // Suppliers
    let y = 45;

    suppliers.forEach((supplier, index) => {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }

      doc.setFontSize(14);
      doc.text(`${index + 1}. ${supplier.name}`, 20, y);

      y += 8;
      doc.setFontSize(10);

      doc.text(`Category: ${supplier.category || 'N/A'}`, 25, y);
      y += 6;
      doc.text(`Location: ${supplier.location || 'N/A'}`, 25, y);
      y += 6;
      doc.text(
        `Starting Price: £${supplier.startingPrice?.toLocaleString() || 'Contact for quote'}`,
        25,
        y
      );
      y += 6;
      doc.text(
        `Rating: ${supplier.rating?.toFixed(1) || 'N/A'} (${supplier.reviewCount || 0} reviews)`,
        25,
        y
      );
      y += 6;
      doc.text(
        `Capacity: ${supplier.minGuests || 0} - ${supplier.maxGuests || 'Unlimited'} guests`,
        25,
        y
      );
      y += 6;

      if (supplier.amenities && supplier.amenities.length > 0) {
        doc.text(`Amenities: ${supplier.amenities.slice(0, 5).join(', ')}`, 25, y);
        y += 6;
      }

      y += 8;
    });

    // Save PDF
    doc.save(filename);
  }
}

// Export singleton instance
// eslint-disable-next-line no-unused-vars
const exportUtility = new ExportUtility();

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExportUtility;
}
