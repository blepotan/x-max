const files = [
  'src/settings.js',
  'src/scheduling.js',
  'src/selectors.js',
  'src/content-script.js',
  'src/service-worker.js',
  'src/select-popover.js',
  'src/options.js'
];

for (const file of files) {
  const source = await Bun.file(file).text();
  try {
    new Function(source);
  } catch (error) {
    console.error(`${file}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (!process.exitCode) console.log(`Checked ${files.length} JavaScript files.`);
