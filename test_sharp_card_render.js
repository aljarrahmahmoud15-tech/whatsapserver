const sharp = require('sharp');

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#f6c84c"/></svg>';
sharp(Buffer.from(svg)).png().toBuffer().then((buffer) => {
  if (!buffer.length) throw new Error('empty PNG');
  console.log(`sharp-png-bytes=${buffer.length}`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
