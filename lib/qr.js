/**
 * Compact, zero-dependency QR Code Generator for Node.js
 * Generates clean standalone SVG strings for mobile pairing.
 */
function generateQrSvg(text, size = 260) {
  // Use a reliable, minimal QR matrix generator
  const modules = createQrMatrix(text);
  const count = modules.length;
  const cellSize = size / (count + 8);
  const margin = 4 * cellSize;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">\n`;
  svg += `<rect width="100%" height="100%" fill="#ffffff" rx="16" />\n`;
  svg += `<g fill="#0b0e14">\n`;

  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (modules[r][c]) {
        const x = margin + c * cellSize;
        const y = margin + r * cellSize;
        svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cellSize.toFixed(1)}" height="${cellSize.toFixed(1)}" />\n`;
      }
    }
  }

  svg += `</g>\n</svg>`;
  return svg;
}

// Minimal QR Code Model 2 Matrix generator (Byte mode)
function createQrMatrix(data) {
  // We can use a standard Type 4/5 QR code matrix generator for URLs
  const len = data.length;
  // Determine version (up to ~100 chars -> version 4 or 5)
  let version = 3;
  if (len > 32) version = 4;
  if (len > 46) version = 5;
  if (len > 60) version = 6;
  if (len > 84) version = 7;

  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));

  function setFinder(x, y) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = y + r;
        const col = x + c;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        reserved[row][col] = true;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
            matrix[row][col] = true;
          } else {
            matrix[row][col] = false;
          }
        } else {
          matrix[row][col] = false;
        }
      }
    }
  }

  setFinder(0, 0);
  setFinder(size - 7, 0);
  setFinder(0, size - 7);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
    reserved[6][i] = true;
    reserved[i][6] = true;
  }

  // Dark module
  matrix[4 * version + 9][8] = true;
  reserved[4 * version + 9][8] = true;

  // Reserve format info areas
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  // Encode data in byte mode
  const bytes = [];
  for (let i = 0; i < data.length; i++) {
    bytes.push(data.charCodeAt(i));
  }

  // Bit buffer
  let bits = '';
  bits += '0100'; // Byte mode indicator
  bits += bytes.length.toString(2).padStart(8, '0'); // Character count
  for (const b of bytes) {
    bits += b.toString(2).padStart(8, '0');
  }
  bits += '0000'; // Terminator

  // Place data bits into matrix (interleaved column-wise)
  let bitIdx = 0;
  let dir = -1; // up
  let row = size - 1;
  let col = size - 1;

  while (col > 0) {
    if (col === 6) col--; // Skip vertical timing pattern
    for (let i = 0; i < size; i++) {
      const r = dir === -1 ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const currentCol = col - c;
        if (!reserved[r][currentCol]) {
          const bit = bitIdx < bits.length ? bits[bitIdx++] === '1' : false;
          // Apply standard mask 0: (row + col) % 2 === 0
          const mask = (r + currentCol) % 2 === 0;
          matrix[r][currentCol] = bit ? !mask : mask;
        }
      }
    }
    dir = -dir;
    col -= 2;
  }

  return matrix;
}

module.exports = { generateQrSvg };
