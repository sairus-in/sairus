const { execSync } = require('child_process');
const fs = require('fs');

try {
  const result = execSync('npx tsc --noEmit', { stdio: 'pipe' });
  fs.writeFileSync('errors.txt', result.toString(), 'utf8');
  console.log('Success, wrote to errors.txt');
} catch (err) {
  fs.writeFileSync('errors.txt', err.stdout.toString(), 'utf8');
  console.log('Failed, wrote stdout to errors.txt');
}
