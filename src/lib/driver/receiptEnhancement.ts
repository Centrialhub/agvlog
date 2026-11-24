/** Correct uneven paper illumination without generating, sharpening or replacing marks. */
export function enhanceReceiptPixels(pixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  if (width < 1 || height < 1 || pixels.length !== width * height * 4) throw new Error('Imagem do canhoto inválida.');
  const tile = 64, columns = Math.ceil(width / tile), rows = Math.ceil(height / tile);
  const background = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const histogram = new Uint32Array(256); let count = 0;
    for (let y = row * tile; y < Math.min(height, (row + 1) * tile); y += 2) {
      for (let x = column * tile; x < Math.min(width, (column + 1) * tile); x += 2) {
        const offset = (y * width + x) * 4;
        histogram[Math.round(pixels[offset] * .299 + pixels[offset + 1] * .587 + pixels[offset + 2] * .114)]++; count++;
      }
    }
    let cumulative = 0, paper = 255;
    for (let value = 0; value < 256; value++) { cumulative += histogram[value]; if (cumulative >= count * .9) { paper = value; break; } }
    background[row * columns + column] = Math.max(100, paper);
  }
  const output = new Uint8ClampedArray(pixels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gx = Math.max(0, Math.min(columns - 1, x / tile - .5)), gy = Math.max(0, Math.min(rows - 1, y / tile - .5));
    const left = Math.floor(gx), top = Math.floor(gy), right = Math.min(columns - 1, left + 1), bottom = Math.min(rows - 1, top + 1);
    const fx = gx - left, fy = gy - top;
    const paper = (background[top * columns + left] * (1 - fx) + background[top * columns + right] * fx) * (1 - fy)
      + (background[bottom * columns + left] * (1 - fx) + background[bottom * columns + right] * fx) * fy;
    const gain = Math.max(1, Math.min(1.65, 242 / paper)), offset = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) output[offset + channel] = Math.min(255, pixels[offset + channel] * gain);
  }
  return output;
}
