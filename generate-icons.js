import sharp from 'sharp';
import { readFileSync } from 'fs';

const svg = readFileSync('./icons/icon.svg');
const sizes = [16, 48, 128];

for (const size of sizes) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(`./icons/icon-${size}.png`);
  console.log(`generated icons/icon-${size}.png`);
}
