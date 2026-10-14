/**
 * Standards-Compliant Zero-Dependency QR Code Generator
 * Uses pure JS Reed-Solomon QR encoder for guaranteed mobile camera recognition.
 */
const qrcode = require('./qrcode-lib');

function generateQrSvg(text, size = 280) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const margin = 4;
  const totalCount = moduleCount + margin * 2;
  const cellSize = size / totalCount;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">\n`;
  svg += `<rect width="100%" height="100%" fill="#ffffff" rx="16" />\n`;
  svg += `<g fill="#000000">\n`;

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (qr.isDark(r, c)) {
        const x = (c + margin) * cellSize;
        const y = (r + margin) * cellSize;
        // slight overlap (+0.08) prevents subpixel rendering gaps on mobile screens
        svg += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cellSize + 0.08).toFixed(2)}" height="${(cellSize + 0.08).toFixed(2)}" />\n`;
      }
    }
  }

  svg += `</g>\n</svg>`;
  return svg;
}

module.exports = { generateQrSvg };
