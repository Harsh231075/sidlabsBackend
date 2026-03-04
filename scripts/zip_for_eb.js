const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// Save the zip in the server root
const outputDest = path.join(__dirname, '..', 'server-eb-deploy.zip');
const output = fs.createWriteStream(outputDest);
const archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level.
});

// Listen for all archive data to be written
output.on('close', function () {
    console.log('Successfully created deployment package!');
    console.log(archive.pointer() + ' total bytes');
    console.log('Archive saved to: ' + outputDest);
});

archive.on('warning', function (err) {
    if (err.code === 'ENOENT') {
        console.warn(err);
    } else {
        throw err;
    }
});

archive.on('error', function (err) {
    throw err;
});

// Pipe archive data to the file
archive.pipe(output);

// Glob pattern to include files. We exclude node_modules, uploads, test folders, and local env files.
archive.glob('**/*', {
    cwd: path.join(__dirname, '..'), // Important: target the server root!
    ignore: [
        'node_modules/**',
        'uploads/**',
        'tests/**',
        'k6-tests/**',
        '.env',
        '*.zip',
        'package-lock.json', // Allow EB to install freshly
        'scripts/resetAndSeedDemoData.js', // Exclude sensitive script if needed
        'test-moderation.js'
    ],
    dot: true // Include hidden files like .ebextensions and .env.example
});

archive.finalize();
