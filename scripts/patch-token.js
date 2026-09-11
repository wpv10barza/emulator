import fs from 'fs';
const file = 'server.mjs';
if (fs.existsSync(file)) {
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes('X-3C-Device-Token')) {
    content = content.replace(
      "headers: { 'Content-Type': 'application/json' },",
      "headers: { 'Content-Type': 'application/json', 'X-3C-Device-Token': process.env.ESP32_API_TOKEN || 'dev-token-123' },"
    );
    fs.writeFileSync(file, content, 'utf8');
    console.log('✓ Parche de inyección de Token aplicado con éxito en server.mjs');
  }
}
